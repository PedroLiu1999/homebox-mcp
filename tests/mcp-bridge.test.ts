import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
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
  apiKey = "hb_mcp_bridge_key_123",
): Promise<{ accessToken: string }> {
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
    `${harness.baseUrl}/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`,
  );
  expect(authRes.status).toBe(200);
  const cookie = authRes.headers.get("set-cookie")!.split(";")[0]!.trim();
  const { requestId, csrfToken } = extractFormFields(await authRes.text());

  const loginRes = await fetch(`${harness.baseUrl}/authorize/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie,
    },
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
  return { accessToken: tokens.access_token };
}

async function connectMcpClient(
  baseUrl: string,
  accessToken: string,
): Promise<Client> {
  const client = new Client({
    name: "test-mcp-client",
    version: "1.0.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp`),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    },
  );
  await client.connect(transport);
  return client;
}

describe("Authenticated MCP bridge and initial Homebox tools", () => {
  let harness: TestHarness | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = undefined;
    }
    if (harness) {
      await harness.close();
      harness = undefined;
    }
  });

  it("executes get_current_user over Streamable HTTP MCP with decrypted hb_ key and optional X-Tenant", async () => {
    harness = await startTestServer();
    const seenRequests: Array<{
      url: string | undefined;
      auth: string | undefined;
      tenant: string | string[] | undefined;
    }> = [];

    harness.setHomeboxHandler((req, res) => {
      seenRequests.push({
        url: req.url,
        auth: req.headers.authorization,
        tenant: req.headers["x-tenant"],
      });
      if (
        req.url === "/api/v1/users/self" &&
        req.method === "GET" &&
        req.headers.authorization === "Bearer hb_mcp_bridge_key_123"
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            item: {
              id: "user-1",
              name: "Alice",
              email: "alice@example.com",
              groupId: req.headers["x-tenant"] ?? "group-default",
            },
          }),
        );
        return;
      }
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
    });

    const { accessToken } = await completeOAuthFlow(
      harness,
      "hb_mcp_bridge_key_123",
    );
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const toolsList = await client.listTools();
    const toolNames = toolsList.tools.map((t) => t.name);
    expect(toolNames).toContain("get_current_user");

    const result = await client.callTool({
      name: "get_current_user",
      arguments: { tenant: "group-secondary" },
    });
    expect(result.isError).toBeFalsy();
    const textContent = result.content[0] as { type: string; text: string };
    expect(textContent.type).toBe("text");
    const parsed = JSON.parse(textContent.text) as {
      item: { id: string; groupId: string };
    };
    expect(parsed.item.id).toBe("user-1");
    expect(parsed.item.groupId).toBe("group-secondary");

    // First request was during OAuth login verification, second was the MCP tool call
    const mcpUpstreamCall = seenRequests[seenRequests.length - 1];
    expect(mcpUpstreamCall.url).toBe("/api/v1/users/self");
    expect(mcpUpstreamCall.auth).toBe("Bearer hb_mcp_bridge_key_123");
    expect(mcpUpstreamCall.tenant).toBe("group-secondary");
  });

  it("executes list_groups over Streamable HTTP MCP with optional X-Tenant forwarding", async () => {
    harness = await startTestServer();
    const seenGroupRequests: Array<{
      auth: string | undefined;
      tenant: string | string[] | undefined;
    }> = [];

    harness.setHomeboxHandler((req, res) => {
      if (
        req.url === "/api/v1/users/self" &&
        req.method === "GET" &&
        req.headers.authorization === "Bearer hb_groups_key_456"
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "user-2", username: "bob" } }));
        return;
      }
      if (
        req.url === "/api/v1/groups/all" &&
        req.method === "GET" &&
        req.headers.authorization === "Bearer hb_groups_key_456"
      ) {
        seenGroupRequests.push({
          auth: req.headers.authorization,
          tenant: req.headers["x-tenant"],
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            items: [
              { id: "grp-1", name: "Home" },
              { id: "grp-2", name: "Workshop" },
            ],
          }),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    const { accessToken } = await completeOAuthFlow(
      harness,
      "hb_groups_key_456",
    );
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const toolsList = await client.listTools();
    expect(toolsList.tools.map((t) => t.name)).toContain("list_groups");

    const noTenantRes = await client.callTool({
      name: "list_groups",
      arguments: {},
    });
    expect(noTenantRes.isError).toBeFalsy();
    const parsed = JSON.parse(
      (noTenantRes.content[0] as { text: string }).text,
    ) as { items: Array<{ id: string; name: string }> };
    expect(parsed.items).toHaveLength(2);
    expect(seenGroupRequests[0].tenant).toBeUndefined();

    const withTenantRes = await client.callTool({
      name: "list_groups",
      arguments: { tenant: "grp-2" },
    });
    expect(withTenantRes.isError).toBeFalsy();
    expect(seenGroupRequests[1].tenant).toBe("grp-2");
    expect(seenGroupRequests[1].auth).toBe("Bearer hb_groups_key_456");
  });

  it("returns a clear authentication error and invalidates the grant when Homebox returns 401", async () => {
    harness = await startTestServer();
    let keyRevokedInHomebox = false;

    harness.setHomeboxHandler((req, res) => {
      if (
        req.url === "/api/v1/users/self" &&
        req.method === "GET" &&
        req.headers.authorization === "Bearer hb_revokable_key_789" &&
        !keyRevokedInHomebox
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "user-3", username: "carol" } }));
        return;
      }
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "API key revoked" }));
    });

    const { accessToken } = await completeOAuthFlow(
      harness,
      "hb_revokable_key_789",
    );
    client = await connectMcpClient(harness.baseUrl, accessToken);

    // Revoke the key in Homebox after OAuth authorization succeeded
    keyRevokedInHomebox = true;

    const toolRes = await client.callTool({
      name: "get_current_user",
      arguments: {},
    });
    expect(toolRes.isError).toBe(true);
    const errText = (toolRes.content[0] as { type: string; text: string }).text;
    expect(errText).toContain("401");
    expect(errText.toLowerCase()).toContain("re-authenticate");

    // Grant was invalidated, so subsequent /mcp HTTP requests fail with 401
    const nextHttpRes = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(nextHttpRes.status).toBe(401);
  });

  it("executes get_homebox_status over Streamable HTTP MCP against GET /api/v1/status", async () => {
    harness = await startTestServer();
    const seenStatusRequests: Array<{
      url: string | undefined;
      method: string | undefined;
      auth: string | undefined;
      tenant: string | string[] | undefined;
    }> = [];

    harness.setHomeboxHandler((req, res) => {
      if (
        req.url === "/api/v1/users/self" &&
        req.method === "GET" &&
        req.headers.authorization === "Bearer hb_status_key_123"
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "user-4", username: "dave" } }));
        return;
      }
      if (
        req.url === "/api/v1/status" &&
        req.method === "GET" &&
        req.headers.authorization === "Bearer hb_status_key_123"
      ) {
        seenStatusRequests.push({
          url: req.url,
          method: req.method,
          auth: req.headers.authorization,
          tenant: req.headers["x-tenant"],
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            version: "v0.18.0",
            health: true,
            title: "Homebox",
          }),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    const { accessToken } = await completeOAuthFlow(
      harness,
      "hb_status_key_123",
    );
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const toolsList = await client.listTools();
    expect(toolsList.tools.map((t) => t.name)).toContain("get_homebox_status");

    const statusRes = await client.callTool({
      name: "get_homebox_status",
      arguments: { tenant: "grp-status" },
    });
    expect(statusRes.isError).toBeFalsy();
    const parsed = JSON.parse(
      (statusRes.content[0] as { text: string }).text,
    ) as { version: string; health: boolean; title: string };
    expect(parsed.version).toBe("v0.18.0");
    expect(parsed.health).toBe(true);
    expect(seenStatusRequests).toHaveLength(1);
    expect(seenStatusRequests[0]).toEqual({
      url: "/api/v1/status",
      method: "GET",
      auth: "Bearer hb_status_key_123",
      tenant: "grp-status",
    });
  });
});
