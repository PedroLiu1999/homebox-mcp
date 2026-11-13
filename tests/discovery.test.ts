import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestHarness } from "./helpers/test-server.js";

describe("HTTP server and OAuth discovery", () => {
  let harness: TestHarness | undefined;

  afterEach(async () => {
    if (harness) {
      await harness.close();
      harness = undefined;
    }
  });

  it("GET /health returns 200 OK", async () => {
    harness = await startTestServer();
    const res = await fetch(`${harness.baseUrl}/health`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("GET /.well-known/oauth-protected-resource returns RFC 9728 metadata pointing to MCP_PUBLIC_URL", async () => {
    harness = await startTestServer();
    const res = await fetch(
      `${harness.baseUrl}/.well-known/oauth-protected-resource`,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(body.authorization_servers).toContain(
      new URL(harness.baseUrl).href,
    );
    expect(body.resource).toBe(new URL(harness.baseUrl).href);
  });

  it("GET /.well-known/oauth-authorization-server returns RFC 8414 metadata with required endpoints and S256 PKCE", async () => {
    harness = await startTestServer();
    const res = await fetch(
      `${harness.baseUrl}/.well-known/oauth-authorization-server`,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint: string;
      revocation_endpoint: string;
      code_challenge_methods_supported: string[];
    };

    expect(body.issuer).toBe(new URL(harness.baseUrl).href);
    expect(body.authorization_endpoint).toBe(`${harness.baseUrl}/authorize`);
    expect(body.token_endpoint).toBe(`${harness.baseUrl}/token`);
    expect(body.registration_endpoint).toBe(`${harness.baseUrl}/register`);
    expect(body.revocation_endpoint).toBe(`${harness.baseUrl}/revoke`);
    expect(body.code_challenge_methods_supported).toContain("S256");
  });

  it("unauthenticated requests to /mcp return 401 with WWW-Authenticate referencing protected resource metadata", async () => {
    harness = await startTestServer();
    const res = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });

    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate");
    expect(wwwAuth).toBeTruthy();
    expect(wwwAuth).toContain(
      `resource_metadata="${harness.baseUrl}/.well-known/oauth-protected-resource"`,
    );
  });
});
