import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestHarness } from "./helpers/test-server.js";

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
    const html = await authRes.text();

    expect(html).toContain('action="/authorize/login"');
    expect(html).toContain('name="request_id"');
    expect(html).toContain('name="csrf_token"');
    expect(html).toContain('name="username"');
    expect(html).toContain('name="password"');
    expect(html).toContain('name="api_key"');
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
    const form = extractFormFields(await authRes.text());

    const loginRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
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
    const form1 = extractFormFields(await authRes.text());

    const invalidRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
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

    // Retry with valid credentials using the re-rendered form
    const form2 = extractFormFields(errHtml);
    const retryRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
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
    const form = extractFormFields(await authRes.text());

    // Empty submission -> 400 HTML error
    const emptyRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
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
      headers: { "content-type": "application/x-www-form-urlencoded" },
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
});
