import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestHarness } from "./helpers/test-server.js";

function extractCookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) {
    throw new Error("Missing Set-Cookie header from GET /authorize");
  }
  return setCookieHeader.split(";")[0]!.trim();
}

function extractFormFields(html: string): {
  requestId: string;
  csrfToken: string;
} {
  const requestIdMatch = html.match(/name="request_id"\s+value="([^"]+)"/);
  const csrfTokenMatch = html.match(/name="csrf_token"\s+value="([^"]+)"/);
  if (!requestIdMatch || !csrfTokenMatch) {
    throw new Error("Missing request_id or csrf_token in authorize HTML");
  }
  return {
    requestId: requestIdMatch[1],
    csrfToken: csrfTokenMatch[1],
  };
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function registerTestClient(
  baseUrl: string,
  clientName = "Claude Desktop",
  redirectUri = "http://127.0.0.1:9999/callback",
): Promise<{ client_id: string; client_name: string; redirect_uris: string[] }> {
  const res = await fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as {
    client_id: string;
    client_name: string;
    redirect_uris: string[];
  };
}

describe("OAuth 2.1 username/password login with automatic API key minting", () => {
  let harness: TestHarness | undefined;

  afterEach(async () => {
    if (harness) {
      await harness.close();
      harness = undefined;
    }
  });

  it("GET /authorize renders login form accepting either username/password or direct hb_ API key", async () => {
    harness = await startTestServer();
    const { client_id } = await registerTestClient(harness.baseUrl);
    const { challenge } = createPkcePair();

    const authRes = await fetch(
      `${harness.baseUrl}/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=s1`,
    );
    expect(authRes.status).toBe(200);
    const setCookie = authRes.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/authorize");
    expect(setCookie).not.toContain("Secure");

    const html = await authRes.text();
    const form = extractFormFields(html);
    expect(setCookie).toContain(form.csrfToken);

    expect(html).toContain('action="/authorize/login"');
    expect(html).toContain('name="request_id"');
    expect(html).toContain('name="csrf_token"');
    expect(html).toContain('name="username"');
    expect(html).toContain('name="password"');
    expect(html).toContain('name="api_key"');
  });

  it("GET /authorize sets Secure on the CSRF cookie when mcpPublicUrl uses https://", async () => {
    harness = await startTestServer({
      mcpPublicUrl: "https://mcp.example.com",
    });
    const baseUrl = new URL(harness.baseUrl);
    const sendWithPublicHost = (
      method: "GET" | "POST",
      path: string,
      body?: string,
    ): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> =>
      new Promise((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: baseUrl.hostname,
            port: Number(baseUrl.port),
            path,
            method,
            headers: {
              host: "mcp.example.com",
              ...(body
                ? {
                    "content-type": "application/json",
                    "content-length": String(Buffer.byteLength(body)),
                  }
                : {}),
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers,
                body: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );
        req.on("error", reject);
        if (body) {
          req.write(body);
        }
        req.end();
      });

    const registerRes = await sendWithPublicHost(
      "POST",
      "/register",
      JSON.stringify({
        client_name: "Test MCP Client",
        redirect_uris: ["http://127.0.0.1:9999/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    );
    expect(registerRes.status).toBe(201);
    const { client_id } = JSON.parse(registerRes.body) as { client_id: string };
    const { challenge } = createPkcePair();

    const authRes = await sendWithPublicHost(
      "GET",
      `/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=s1`,
    );
    expect(authRes.status).toBe(200);
    const setCookieHeader = authRes.headers["set-cookie"];
    const setCookie = Array.isArray(setCookieHeader)
      ? setCookieHeader.join("; ")
      : setCookieHeader;
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/authorize");
    expect(setCookie).toContain("Secure");
  });

  it("POST /authorize/login with username/password logs into Homebox, mints an API key named after the MCP client, and completes PKCE token exchange without persisting password or session token", async () => {
    harness = await startTestServer();
    const redirectUri = "http://127.0.0.1:9999/callback";
    const { client_id } = await registerTestClient(
      harness.baseUrl,
      "Claude Desktop",
      redirectUri,
    );
    const { verifier, challenge } = createPkcePair();

    const homeboxCalls: Array<{
      method: string;
      url: string;
      auth?: string;
      body: Record<string, unknown>;
    }> = [];

    harness.setHomeboxHandler(async (req, res) => {
      const body = await readJsonBody(req);
      homeboxCalls.push({
        method: req.method ?? "",
        url: req.url ?? "",
        auth: req.headers.authorization,
        body,
      });

      if (req.url === "/api/v1/users/login" && req.method === "POST") {
        expect(body.username).toBe("alice@example.com");
        expect(body.password).toBe("super-secret-password-999");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            token: "Bearer hb_temp_session_tok_123",
            expiresAt: "2026-11-20T00:00:00Z",
            attachmentToken: "att_tok_123",
          }),
        );
        return;
      }

      if (req.url === "/api/v1/users/self/api-keys" && req.method === "POST") {
        expect(req.headers.authorization).toBe("Bearer hb_temp_session_tok_123");
        expect(String(body.name)).toContain("Claude Desktop");
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "key-1",
            name: body.name,
            key: "hb_minted_key_secret_456",
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    const authRes = await fetch(
      `${harness.baseUrl}/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=pw-state`,
    );
    expect(authRes.status).toBe(200);
    const cookie = extractCookiePair(authRes.headers.get("set-cookie"));
    const form = extractFormFields(await authRes.text());

    const loginRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie,
      },
      redirect: "manual",
      body: new URLSearchParams({
        request_id: form.requestId,
        csrf_token: form.csrfToken,
        username: "alice@example.com",
        password: "super-secret-password-999",
      }),
    });

    expect(loginRes.status).toBe(302);
    const location = new URL(loginRes.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(redirectUri);
    expect(location.searchParams.get("state")).toBe("pw-state");
    const code = location.searchParams.get("code")!;
    expect(code).toBeTruthy();

    expect(homeboxCalls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/v1/users/login",
      "POST /api/v1/users/self/api-keys",
    ]);

    const tokenRes = await fetch(`${harness.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as {
      access_token: string;
      token_type: string;
      refresh_token: string;
    };
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();

    const dbBytes = readFileSync(harness.databasePath);
    expect(dbBytes.includes("super-secret-password-999")).toBe(false);
    expect(dbBytes.includes("hb_temp_session_tok_123")).toBe(false);
    expect(dbBytes.includes("hb_minted_key_secret_456")).toBe(false);
  });

  it("POST /authorize/login surfaces a clear error on 401 invalid Homebox credentials without issuing a code, and allows retry", async () => {
    harness = await startTestServer();
    const redirectUri = "http://127.0.0.1:9999/callback";
    const { client_id } = await registerTestClient(
      harness.baseUrl,
      "Cursor",
      redirectUri,
    );
    const { challenge } = createPkcePair();

    let apiKeyMintCalled = false;
    harness.setHomeboxHandler(async (req, res) => {
      const body = await readJsonBody(req);
      if (req.url === "/api/v1/users/login" && req.method === "POST") {
        if (body.password === "correct-password") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ token: "Bearer hb_temp_session_ok" }));
          return;
        }
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid credentials" }));
        return;
      }
      if (req.url === "/api/v1/users/self/api-keys" && req.method === "POST") {
        apiKeyMintCalled = true;
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "k2", key: "hb_retry_minted_key" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const authRes = await fetch(
      `${harness.baseUrl}/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=retry-state`,
    );
    const cookie = extractCookiePair(authRes.headers.get("set-cookie"));
    const form1 = extractFormFields(await authRes.text());

    const invalidRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie,
      },
      redirect: "manual",
      body: new URLSearchParams({
        request_id: form1.requestId,
        csrf_token: form1.csrfToken,
        username: "alice@example.com",
        password: "wrong-password-111",
      }),
    });

    expect(invalidRes.status).toBe(401);
    expect(invalidRes.headers.get("location")).toBeNull();
    expect(invalidRes.headers.get("content-type")).toContain("text/html");
    expect(apiKeyMintCalled).toBe(false);

    const errHtml = await invalidRes.text();
    expect(errHtml).toContain("Invalid Homebox username or password");
    expect(errHtml).toContain('name="username"');
    expect(errHtml).toContain('name="password"');

    // Retry with valid credentials using the re-rendered form and original cookie
    const form2 = extractFormFields(errHtml);
    const retryRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie,
      },
      redirect: "manual",
      body: new URLSearchParams({
        request_id: form2.requestId,
        csrf_token: form2.csrfToken,
        username: "alice@example.com",
        password: "correct-password",
      }),
    });

    expect(retryRes.status).toBe(302);
    const location = new URL(retryRes.headers.get("location")!);
    expect(location.searchParams.get("code")).toBeTruthy();
    expect(location.searchParams.get("state")).toBe("retry-state");
    expect(apiKeyMintCalled).toBe(true);

    const dbBytes = readFileSync(harness.databasePath);
    expect(dbBytes.includes("wrong-password-111")).toBe(false);
    expect(dbBytes.includes("correct-password")).toBe(false);
    expect(dbBytes.includes("hb_temp_session_ok")).toBe(false);
    expect(dbBytes.includes("hb_retry_minted_key")).toBe(false);
  });

  it("POST /authorize/login handles missing credentials and failed API key minting without issuing a code", async () => {
    harness = await startTestServer();
    const redirectUri = "http://127.0.0.1:9999/callback";
    const { client_id } = await registerTestClient(
      harness.baseUrl,
      "Test Client",
      redirectUri,
    );
    const { challenge } = createPkcePair();

    harness.setHomeboxHandler(async (req, res) => {
      if (req.url === "/api/v1/users/login" && req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ token: "Bearer hb_temp_session_fail_mint" }));
        return;
      }
      if (req.url === "/api/v1/users/self/api-keys" && req.method === "POST") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const authRes = await fetch(
      `${harness.baseUrl}/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`,
    );
    const cookie = extractCookiePair(authRes.headers.get("set-cookie"));
    const form = extractFormFields(await authRes.text());

    // Empty submission -> 400 HTML error
    const emptyRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie,
      },
      redirect: "manual",
      body: new URLSearchParams({
        request_id: form.requestId,
        csrf_token: form.csrfToken,
      }),
    });
    expect(emptyRes.status).toBe(400);
    expect(emptyRes.headers.get("location")).toBeNull();
    const emptyHtml = await emptyRes.text();
    expect(emptyHtml).toContain('role="alert"');

    // Failed API key minting -> 502 HTML error, no redirect
    const form2 = extractFormFields(emptyHtml);
    const mintFailRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie,
      },
      redirect: "manual",
      body: new URLSearchParams({
        request_id: form2.requestId,
        csrf_token: form2.csrfToken,
        username: "alice",
        password: "valid-password",
      }),
    });
    expect(mintFailRes.status).toBe(502);
    expect(mintFailRes.headers.get("location")).toBeNull();
    const mintFailHtml = await mintFailRes.text();
    expect(mintFailHtml).toContain("failed to mint an API key");
  });

  it("POST /authorize/login rejects missing or mismatched CSRF cookie with 403 even when request_id and csrf_token match", async () => {
    harness = await startTestServer();
    const redirectUri = "http://127.0.0.1:9999/callback";
    const { client_id } = await registerTestClient(
      harness.baseUrl,
      "Test Client",
      redirectUri,
    );
    const { challenge } = createPkcePair();

    const authRes = await fetch(
      `${harness.baseUrl}/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`,
    );
    expect(authRes.status).toBe(200);
    const cookie = extractCookiePair(authRes.headers.get("set-cookie"));
    const cookieName = cookie.split("=")[0]!;
    const form = extractFormFields(await authRes.text());

    const missingCookieRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: new URLSearchParams({
        request_id: form.requestId,
        csrf_token: form.csrfToken,
        api_key: "hb_test_key",
      }),
    });
    expect(missingCookieRes.status).toBe(403);

    const mismatchedCookieRes = await fetch(
      `${harness.baseUrl}/authorize/login`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `${cookieName}=wrong-csrf-cookie-value`,
        },
        redirect: "manual",
        body: new URLSearchParams({
          request_id: form.requestId,
          csrf_token: form.csrfToken,
          api_key: "hb_test_key",
        }),
      },
    );
    expect(mismatchedCookieRes.status).toBe(403);
  });
});
