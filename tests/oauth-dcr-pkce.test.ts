import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTestServer, type TestHarness } from "./helpers/test-server.js";

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
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

async function registerTestClient(
  baseUrl: string,
  redirectUri = "http://127.0.0.1:9999/callback",
): Promise<{ client_id: string; redirect_uris: string[] }> {
  const res = await fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Test MCP Client",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { client_id: string; redirect_uris: string[] };
}

describe("OAuth 2.1 DCR, PKCE authorization, and API key login", () => {
  let harness: TestHarness | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    if (harness) {
      await harness.close();
      harness = undefined;
    }
  });

  it("POST /register validates redirect URIs, persists client metadata, and returns client_id", async () => {
    harness = await startTestServer();

    const invalidRes = await fetch(`${harness.baseUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Bad Client",
        redirect_uris: ["javascript:alert(1)"],
      }),
    });
    expect(invalidRes.status).toBe(400);

    const validRes = await fetch(`${harness.baseUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Test MCP Client",
        redirect_uris: ["http://127.0.0.1:9999/callback"],
        token_endpoint_auth_method: "none",
      }),
    });

    expect(validRes.status).toBe(201);
    const client = (await validRes.json()) as {
      client_id: string;
      client_name: string;
      redirect_uris: string[];
    };
    expect(client.client_id).toBeTruthy();
    expect(client.client_name).toBe("Test MCP Client");
    expect(client.redirect_uris).toEqual(["http://127.0.0.1:9999/callback"]);
  });

  it("POST /register allows https and loopback http redirect URIs and rejects non-loopback http or other schemes", async () => {
    harness = await startTestServer();

    for (const badUri of [
      "http://example.com/callback",
      "http://192.168.1.10:8080/callback",
      "http://localhost.evil.com/callback",
      "ftp://example.com/callback",
      "custom://callback",
    ]) {
      const res = await fetch(`${harness.baseUrl}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Bad Redirect Client",
          redirect_uris: [badUri],
        }),
      });
      expect(res.status, `Expected 400 for ${badUri}`).toBe(400);
    }

    for (const goodUri of [
      "https://claude.ai/api/mcp/auth_callback",
      "http://localhost/callback",
      "http://localhost:8080/callback",
      "http://127.0.0.1:9999/callback",
      "http://[::1]:3000/callback",
      "http://[::1]/callback",
    ]) {
      const res = await fetch(`${harness.baseUrl}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Good Redirect Client",
          redirect_uris: [goodUri],
          token_endpoint_auth_method: "none",
        }),
      });
      expect(res.status, `Expected 201 for ${goodUri}`).toBe(201);
    }
  });

  it("POST /register caps redirect_uris at 10 entries", async () => {
    harness = await startTestServer();

    const tenUris = Array.from(
      { length: 10 },
      (_, i) => `https://app.example.com/callback/${i}`,
    );
    const okRes = await fetch(`${harness.baseUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Ten URIs Client",
        redirect_uris: tenUris,
        token_endpoint_auth_method: "none",
      }),
    });
    expect(okRes.status).toBe(201);

    const elevenUris = [
      ...tenUris,
      "https://app.example.com/callback/10",
    ];
    const tooManyRes = await fetch(`${harness.baseUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Eleven URIs Client",
        redirect_uris: elevenUris,
        token_endpoint_auth_method: "none",
      }),
    });
    expect(tooManyRes.status).toBe(400);
  });

  it("POST /register caps client_name at 200 characters", async () => {
    harness = await startTestServer();

    const okRes = await fetch(`${harness.baseUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "a".repeat(200),
        redirect_uris: ["https://app.example.com/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(okRes.status).toBe(201);

    const tooLongRes = await fetch(`${harness.baseUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "a".repeat(201),
        redirect_uris: ["https://app.example.com/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(tooLongRes.status).toBe(400);
  });

  it("GET /authorize validates OAuth/PKCE params and renders a CSRF-protected login form", async () => {
    harness = await startTestServer();
    const { client_id } = await registerTestClient(harness.baseUrl);
    const { challenge } = createPkcePair();

    // Unknown client_id -> 400
    const badClientRes = await fetch(
      `${harness.baseUrl}/authorize?client_id=unknown&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`,
      { redirect: "manual" },
    );
    expect(badClientRes.status).toBe(400);

    // Non-S256 code_challenge_method -> redirect with error
    const badPkceRes = await fetch(
      `${harness.baseUrl}/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&response_type=code&code_challenge=${challenge}&code_challenge_method=plain&state=abc`,
      { redirect: "manual" },
    );
    expect(badPkceRes.status).toBe(302);
    const errLocation = new URL(badPkceRes.headers.get("location")!);
    expect(errLocation.searchParams.get("error")).toBe("invalid_request");

    // Valid request -> 200 HTML form with CSRF token and request_id
    const authRes = await fetch(
      `${harness.baseUrl}/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=xyz`,
    );
    expect(authRes.status).toBe(200);
    expect(authRes.headers.get("content-type")).toContain("text/html");
    const html = await authRes.text();
    expect(html).toContain('action="/authorize/login"');
    expect(html).toContain('name="csrf_token"');
    expect(html).toContain('name="request_id"');
    expect(html).toContain('name="api_key"');

    const requestIdMatch = html.match(/name="request_id"\s+value="([^"]+)"/);
    expect(requestIdMatch).toBeTruthy();

    // Missing/wrong CSRF token -> 403
    const badCsrfRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        request_id: requestIdMatch![1],
        csrf_token: "wrong-csrf-token",
        api_key: "hb_test_key",
      }),
    });
    expect(badCsrfRes.status).toBe(403);
  });

  it("POST /authorize/login rejects invalid hb_ key with form error and redirects with code on valid key (encrypted at rest)", async () => {
    harness = await startTestServer();
    const { client_id } = await registerTestClient(harness.baseUrl);
    const { challenge } = createPkcePair();

    const seenAuthHeaders: string[] = [];
    harness.setHomeboxHandler((req, res) => {
      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        const auth = req.headers.authorization ?? "";
        seenAuthHeaders.push(auth);
        if (auth === "Bearer hb_valid_secret_key_123") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              item: { id: "user-1", username: "alice", email: "alice@example.com" },
            }),
          );
          return;
        }
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const authRes = await fetch(
      `${harness.baseUrl}/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=state123`,
    );
    expect(authRes.status).toBe(200);
    const form1 = extractFormFields(await authRes.text());

    // Submit invalid key -> re-renders form with error message, no redirect
    const invalidKeyRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: new URLSearchParams({
        request_id: form1.requestId,
        csrf_token: form1.csrfToken,
        api_key: "hb_invalid_key",
      }),
    });
    expect(invalidKeyRes.status).toBe(401);
    expect(invalidKeyRes.headers.get("content-type")).toContain("text/html");
    const errHtml = await invalidKeyRes.text();
    expect(errHtml).toContain("Invalid Homebox API key");
    expect(errHtml).toContain('name="api_key"');

    // Submit valid key -> 302 redirect back to redirect_uri with code and state
    const form2 = extractFormFields(errHtml);
    const validKeyRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: new URLSearchParams({
        request_id: form2.requestId,
        csrf_token: form2.csrfToken,
        api_key: "hb_valid_secret_key_123",
      }),
    });
    expect(validKeyRes.status).toBe(302);
    const location = new URL(validKeyRes.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(
      "http://127.0.0.1:9999/callback",
    );
    expect(location.searchParams.get("code")).toBeTruthy();
    expect(location.searchParams.get("state")).toBe("state123");
    expect(seenAuthHeaders).toEqual([
      "Bearer hb_invalid_key",
      "Bearer hb_valid_secret_key_123",
    ]);

    // Verify stored Homebox API key is encrypted (not plaintext) in SQLite
    const dbBytes = readFileSync(harness.databasePath);
    expect(dbBytes.includes("hb_valid_secret_key_123")).toBe(false);
  });

  it("POST /token exchanges valid code + PKCE code_verifier for MCP tokens and rejects replay", async () => {
    harness = await startTestServer();
    const redirectUri = "http://127.0.0.1:9999/callback";
    const { client_id } = await registerTestClient(harness.baseUrl, redirectUri);
    const { verifier, challenge } = createPkcePair();

    harness.setHomeboxHandler((req, res) => {
      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "user-1", username: "alice" } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const authRes = await fetch(
      `${harness.baseUrl}/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=s1`,
    );
    const form = extractFormFields(await authRes.text());

    const loginRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: new URLSearchParams({
        request_id: form.requestId,
        csrf_token: form.csrfToken,
        api_key: "hb_token_exchange_key",
      }),
    });
    expect(loginRes.status).toBe(302);
    const code = new URL(loginRes.headers.get("location")!).searchParams.get(
      "code",
    )!;
    expect(code).toBeTruthy();

    // Exchange code for tokens
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
      expires_in: number;
      refresh_token: string;
    };
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.token_type.toLowerCase()).toBe("bearer");
    expect(tokens.expires_in).toBeGreaterThan(0);
    expect(tokens.refresh_token).toBeTruthy();

    // Replay same authorization code -> rejected
    const replayRes = await fetch(`${harness.baseUrl}/token`, {
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
    expect(replayRes.status).toBe(400);
    const replayErr = (await replayRes.json()) as { error: string };
    expect(replayErr.error).toBe("invalid_grant");

    // Verify Homebox API key is still never stored in plaintext in SQLite
    const dbBytes = readFileSync(harness.databasePath);
    expect(dbBytes.includes("hb_token_exchange_key")).toBe(false);
  });

  it("POST /token rejects wrong code_verifier, mismatched redirect_uri, mismatched client_id, and expired codes", async () => {
    harness = await startTestServer();
    const redirectUri = "http://127.0.0.1:9999/callback";
    const clientA = await registerTestClient(harness.baseUrl, redirectUri);
    const clientB = await registerTestClient(harness.baseUrl, redirectUri);
    const { verifier, challenge } = createPkcePair();

    harness.setHomeboxHandler((req, res) => {
      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "user-1", username: "alice" } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const issueCode = async (): Promise<string> => {
      const authRes = await fetch(
        `${harness.baseUrl}/authorize?client_id=${encodeURIComponent(clientA.client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`,
      );
      const form = extractFormFields(await authRes.text());
      const loginRes = await fetch(`${harness.baseUrl}/authorize/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        redirect: "manual",
        body: new URLSearchParams({
          request_id: form.requestId,
          csrf_token: form.csrfToken,
          api_key: "hb_validation_test_key",
        }),
      });
      return new URL(loginRes.headers.get("location")!).searchParams.get(
        "code",
      )!;
    };

    const code1 = await issueCode();

    // Wrong code_verifier
    const wrongVerifierRes = await fetch(`${harness.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientA.client_id,
        code: code1,
        code_verifier: "wrong-verifier-value-that-does-not-match-challenge",
        redirect_uri: redirectUri,
      }),
    });
    expect(wrongVerifierRes.status).toBe(400);
    expect(((await wrongVerifierRes.json()) as { error: string }).error).toBe(
      "invalid_grant",
    );

    // Mismatched client_id
    const wrongClientRes = await fetch(`${harness.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientB.client_id,
        code: code1,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
    });
    expect(wrongClientRes.status).toBe(400);
    expect(((await wrongClientRes.json()) as { error: string }).error).toBe(
      "invalid_grant",
    );

    // Mismatched redirect_uri
    const wrongRedirectRes = await fetch(`${harness.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientA.client_id,
        code: code1,
        code_verifier: verifier,
        redirect_uri: "http://127.0.0.1:9999/other-callback",
      }),
    });
    expect(wrongRedirectRes.status).toBe(400);
    expect(((await wrongRedirectRes.json()) as { error: string }).error).toBe(
      "invalid_grant",
    );

    // Expired code
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    const expiredRes = await fetch(`${harness.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientA.client_id,
        code: code1,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
    });
    expect(expiredRes.status).toBe(400);
    expect(((await expiredRes.json()) as { error: string }).error).toBe(
      "invalid_grant",
    );
  });
});
