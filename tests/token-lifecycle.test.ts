import { createHash, randomBytes } from "node:crypto";
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

async function completeOAuthFlow(
  harness: TestHarness,
  apiKey = "hb_test_api_key_123",
): Promise<{
  clientId: string;
  accessToken: string;
  refreshToken: string;
}> {
  const redirectUri = "http://127.0.0.1:9999/callback";
  const regRes = await fetch(`${harness.baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Test MCP Client",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(regRes.status).toBe(201);
  const { client_id: clientId } = (await regRes.json()) as {
    client_id: string;
  };

  const { verifier, challenge } = createPkcePair();
  const authRes = await fetch(
    `${harness.baseUrl}/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=state1`,
  );
  expect(authRes.status).toBe(200);
  const { requestId, csrfToken } = extractFormFields(await authRes.text());

  const loginRes = await fetch(`${harness.baseUrl}/authorize/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    body: new URLSearchParams({
      request_id: requestId,
      csrf_token: csrfToken,
      api_key: apiKey,
    }),
  });
  expect(loginRes.status).toBe(302);
  const code = new URL(loginRes.headers.get("location")!).searchParams.get(
    "code",
  );
  expect(code).toBeTruthy();

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
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
  };

  return {
    clientId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  };
}

function mockHomeboxValidUser(harness: TestHarness, expectedKey: string): void {
  harness.setHomeboxHandler((req, res) => {
    if (
      req.url === "/api/v1/users/self" &&
      req.method === "GET" &&
      req.headers.authorization === `Bearer ${expectedKey}`
    ) {
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
  });
}

describe("OAuth 2.1 token lifecycle (refresh and revocation)", () => {
  let harness: TestHarness | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    if (harness) {
      await harness.close();
      harness = undefined;
    }
  });

  it("POST /token (grant_type=refresh_token) rotates refresh token, issues new access token, and rejects replay", async () => {
    harness = await startTestServer();
    mockHomeboxValidUser(harness, "hb_test_api_key_123");

    const { clientId, accessToken, refreshToken } =
      await completeOAuthFlow(harness);

    const refreshRes = await fetch(`${harness.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
      }),
    });
    expect(refreshRes.status).toBe(200);
    const rotated = (await refreshRes.json()) as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
    };
    expect(rotated.token_type.toLowerCase()).toBe("bearer");
    expect(rotated.access_token).toBeTruthy();
    expect(rotated.access_token).not.toBe(accessToken);
    expect(rotated.refresh_token).toBeTruthy();
    expect(rotated.refresh_token).not.toBe(refreshToken);

    // Replaying the previous refresh token must fail
    const replayRes = await fetch(`${harness.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
      }),
    });
    expect(replayRes.status).toBe(400);
    const replayBody = (await replayRes.json()) as { error: string };
    expect(replayBody.error).toBe("invalid_grant");

    // Unknown refresh token must fail
    const unknownRes = await fetch(`${harness.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: "non-existent-refresh-token",
      }),
    });
    expect(unknownRes.status).toBe(400);
  });

  it("POST /revoke (RFC 7009) revokes access and refresh tokens and is idempotent for unknown tokens", async () => {
    harness = await startTestServer();
    mockHomeboxValidUser(harness, "hb_test_api_key_123");

    const { clientId, accessToken, refreshToken } =
      await completeOAuthFlow(harness);

    // Revoke access token
    const revokeAccessRes = await fetch(`${harness.baseUrl}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        token: accessToken,
        token_type_hint: "access_token",
      }),
    });
    expect(revokeAccessRes.status).toBe(200);

    // Subsequent /mcp request with revoked access token fails with 401
    const mcpRes = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(mcpRes.status).toBe(401);
    expect(mcpRes.headers.get("www-authenticate")).toBeTruthy();

    // Revoke refresh token (without hint)
    const revokeRefreshRes = await fetch(`${harness.baseUrl}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        token: refreshToken,
      }),
    });
    expect(revokeRefreshRes.status).toBe(200);

    // Subsequent refresh attempt fails with 400 invalid_grant
    const refreshRes = await fetch(`${harness.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
      }),
    });
    expect(refreshRes.status).toBe(400);
    const refreshBody = (await refreshRes.json()) as { error: string };
    expect(refreshBody.error).toBe("invalid_grant");

    // Revoking unknown token returns 200 per RFC 7009
    const revokeUnknownRes = await fetch(`${harness.baseUrl}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        token: "already-gone-token",
      }),
    });
    expect(revokeUnknownRes.status).toBe(200);
  });

  it("rejects expired access tokens (401) and expired refresh tokens (400 invalid_grant)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    harness = await startTestServer();
    mockHomeboxValidUser(harness, "hb_test_api_key_123");

    const { clientId, accessToken, refreshToken } =
      await completeOAuthFlow(harness);

    // Advance 2 hours -> access token (1h TTL) is expired, refresh token (30d TTL) is still valid
    vi.setSystemTime(new Date("2026-01-01T02:00:00Z"));
    const expiredAccessRes = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(expiredAccessRes.status).toBe(401);

    // Advance 31 days -> refresh token is also expired
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    const expiredRefreshRes = await fetch(`${harness.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
      }),
    });
    expect(expiredRefreshRes.status).toBe(400);
    const body = (await expiredRefreshRes.json()) as { error: string };
    expect(body.error).toBe("invalid_grant");
  });
});
