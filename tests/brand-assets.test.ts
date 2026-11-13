import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestHarness } from "./helpers/test-server.js";

async function registerAndAuthorize(harness: TestHarness): Promise<{
  authorizeHtml: string;
  accessToken: string;
}> {
  const redirectUri = "http://127.0.0.1:9999/callback";
  const regRes = await fetch(`${harness.baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Brand Asset Test Client",
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
  const cookie = authRes.headers.get("set-cookie")!.split(";")[0]!.trim();
  const authorizeHtml = await authRes.text();
  const requestId = authorizeHtml.match(
    /name="request_id"\s+value="([^"]+)"/,
  )?.[1];
  const csrfToken = authorizeHtml.match(
    /name="csrf_token"\s+value="([^"]+)"/,
  )?.[1];
  expect(requestId).toBeTruthy();
  expect(csrfToken).toBeTruthy();

  const loginRes = await fetch(`${harness.baseUrl}/authorize/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie,
    },
    redirect: "manual",
    body: new URLSearchParams({
      request_id: requestId!,
      csrf_token: csrfToken!,
      api_key: "hb_brand_test_key",
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
  return { authorizeHtml, accessToken: tokens.access_token };
}

describe("MCP logo, favicon, and webmanifest assets", () => {
  let harness: TestHarness | undefined;

  afterEach(async () => {
    if (harness) {
      await harness.close();
      harness = undefined;
    }
  });

  it("serves favicon, web icons, manifest, and logo routes", async () => {
    harness = await startTestServer();

    const expectedAssets: Array<[string, string]> = [
      ["/favicon.ico", "image/x-icon"],
      ["/favicon.svg", "image/svg+xml"],
      ["/apple-touch-icon.png", "image/png"],
      ["/icon-192.png", "image/png"],
      ["/icon-512.png", "image/png"],
      ["/maskable-512.png", "image/png"],
      ["/site.webmanifest", "application/manifest+json"],
      ["/logo.svg", "image/svg+xml"],
      ["/logo.png", "image/png"],
    ];

    for (const [route, expectedType] of expectedAssets) {
      const res = await fetch(`${harness.baseUrl}${route}`);
      expect(res.status, `status for ${route}`).toBe(200);
      expect(res.headers.get("content-type"), `type for ${route}`).toContain(
        expectedType,
      );
      expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
      expect(res.headers.get("cross-origin-resource-policy")).toBe(
        "cross-origin",
      );
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      const bytes = await res.arrayBuffer();
      expect(bytes.byteLength, `body for ${route}`).toBeGreaterThan(0);
    }

    const rootRes = await fetch(`${harness.baseUrl}/`);
    expect(rootRes.status).toBe(200);
    expect(rootRes.headers.get("content-type")).toContain("text/html");
    const rootHtml = await rootRes.text();
    expect(rootHtml).toContain('<link rel="icon" href="/favicon.ico"');
    expect(rootHtml).toContain('<link rel="icon" href="/favicon.svg"');
    expect(rootHtml).toContain(
      `<meta property="og:image" content="${harness.baseUrl}/logo.png"`,
    );
  });

  it("renders favicon links and logo on the OAuth authorize page and exposes MCP server icons", async () => {
    harness = await startTestServer();
    harness.setHomeboxHandler((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "user-1" }));
    });
    const { authorizeHtml, accessToken } = await registerAndAuthorize(harness);

    expect(authorizeHtml).toContain('<link rel="icon" href="/favicon.ico"');
    expect(authorizeHtml).toContain('<link rel="icon" href="/favicon.svg"');
    expect(authorizeHtml).toContain(
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png"',
    );
    expect(authorizeHtml).toContain(
      '<link rel="manifest" href="/site.webmanifest"',
    );
    expect(authorizeHtml).toContain('<meta name="theme-color" content="#1E2A23"');
    expect(authorizeHtml).toContain('<img src="/logo.svg" alt="Homebox MCP"');

    const transport = new StreamableHTTPClientTransport(
      new URL(`${harness.baseUrl}/mcp`),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      },
    );
    const client = new Client({
      name: "brand-test-client",
      version: "1.0.0",
    });

    await client.connect(transport);
    try {
      const serverInfo = client.getServerVersion();
      expect(serverInfo?.name).toBe("homebox-mcp");
      expect(serverInfo?.title).toBe("Homebox MCP");
      expect(serverInfo?.icons).toEqual([
        {
          src: `${harness.baseUrl}/logo.svg`,
          mimeType: "image/svg+xml",
          sizes: ["any"],
        },
        {
          src: `${harness.baseUrl}/icon-192.png`,
          mimeType: "image/png",
          sizes: ["192x192"],
        },
        {
          src: `${harness.baseUrl}/icon-512.png`,
          mimeType: "image/png",
          sizes: ["512x512"],
        },
      ]);
    } finally {
      await client.close();
      await transport.close();
    }
  });
});
