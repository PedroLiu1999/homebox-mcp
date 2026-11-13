import { createHash, randomBytes } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTestServer, type TestHarness } from "./helpers/test-server.js";

async function getAccessToken(harness: TestHarness): Promise<string> {
  harness.setHomeboxHandler((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "user-1" }));
  });

  const redirectUri = "http://127.0.0.1:9999/callback";
  const regRes = await fetch(`${harness.baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Hardening Test Client",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(regRes.status).toBe(201);
  const { client_id: clientId } = (await regRes.json()) as {
    client_id: string;
  };

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authRes = await fetch(
    `${harness.baseUrl}/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`,
  );
  expect(authRes.status).toBe(200);
  const html = await authRes.text();
  const requestId = html.match(/name="request_id"\s+value="([^"]+)"/)?.[1];
  const csrfToken = html.match(/name="csrf_token"\s+value="([^"]+)"/)?.[1];
  expect(requestId).toBeTruthy();
  expect(csrfToken).toBeTruthy();

  const loginRes = await fetch(`${harness.baseUrl}/authorize/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    body: new URLSearchParams({
      request_id: requestId!,
      csrf_token: csrfToken!,
      api_key: "hb_test_key_123",
    }),
  });
  expect(loginRes.status).toBe(302);
  const code = new URL(loginRes.headers.get("location")!).searchParams.get(
    "code",
  );

  const tokenRes = await fetch(`${harness.baseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: code!,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
  expect(tokenRes.status).toBe(200);
  const tokens = (await tokenRes.json()) as { access_token: string };
  return tokens.access_token;
}

describe("HTTP security headers, body limits, and error handling", () => {
  let harness: TestHarness | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (harness) {
      await harness.close();
      harness = undefined;
    }
  });

  it("applies helmet security headers, disables X-Powered-By, and sets CSP allowing inline styles and form-action without inline scripts", async () => {
    harness = await startTestServer();
    const res = await fetch(`${harness.baseUrl}/health`);

    expect(res.status).toBe(200);
    expect(res.headers.get("x-powered-by")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");

    const csp = res.headers.get("content-security-policy");
    expect(csp).toBeTruthy();
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toMatch(/style-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("form-action 'self'");
  });

  it("returns 413 when JSON or URL-encoded request bodies exceed configured limits", async () => {
    harness = await startTestServer();

    // > 100kb JSON body
    const oversizedJson = JSON.stringify({
      client_name: "test",
      redirect_uris: ["https://example.com/cb"],
      padding: "a".repeat(110 * 1024),
    });
    const jsonRes = await fetch(`${harness.baseUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversizedJson,
    });
    expect(jsonRes.status).toBe(413);

    // > 16kb URL-encoded body
    const oversizedForm = new URLSearchParams({
      request_id: "req-1",
      csrf_token: "csrf-1",
      username: "a".repeat(20 * 1024),
      password: "secret",
    }).toString();
    const formRes = await fetch(`${harness.baseUrl}/authorize/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: oversizedForm,
    });
    expect(formRes.status).toBe(413);
  });

  it("returns safe generic JSON errors without stack traces on malformed JSON", async () => {
    harness = await startTestServer();

    const res = await fetch(`${harness.baseUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-valid-json",
    });

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain("SyntaxError");
    expect(text).not.toContain("JSON.parse");
    expect(text).not.toContain("node_modules");
    expect(JSON.parse(text)).toEqual({ error: "bad_request" });
  });

  it("catches unhandled /mcp errors and returns a generic 500 JSON error without leaking details", async () => {
    harness = await startTestServer();
    const accessToken = await getAccessToken(harness);

    vi.spyOn(
      StreamableHTTPServerTransport.prototype,
      "handleRequest",
    ).mockRejectedValueOnce(new Error("sensitive internal failure"));

    const res = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("sensitive internal failure");
    expect(text).not.toContain("node_modules");
    expect(JSON.parse(text)).toEqual({ error: "internal_server_error" });
  });
});
