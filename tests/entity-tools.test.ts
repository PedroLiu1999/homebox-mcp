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
  apiKey = "hb_entity_test_key",
): Promise<{ accessToken: string }> {
  const redirectUri = "http://127.0.0.1:9999/callback";
  const regRes = await fetch(`${harness.baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Entity Test Client",
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
    name: "entity-test-client",
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

describe("Homebox entity, location tree, and search MCP tools", () => {
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

  it("lists and searches entities with query, label, location, pagination filters, and X-Tenant", async () => {
    harness = await startTestServer();
    let capturedUrl: string | undefined;
    let capturedTenant: string | string[] | undefined;

    harness.setHomeboxHandler((req, res) => {
      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "user-1", username: "alice" } }));
        return;
      }
      if (req.url?.startsWith("/api/v1/entities") && req.method === "GET") {
        capturedUrl = req.url;
        capturedTenant = req.headers["x-tenant"];
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            items: [
              { id: "ent-1", name: "Cordless Drill", quantity: 1 },
            ],
            page: 2,
            pageSize: 10,
            total: 1,
          }),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    const { accessToken } = await completeOAuthFlow(harness);
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const result = await client.callTool({
      name: "list_entities",
      arguments: {
        q: "drill",
        labels: ["lbl-tools", "lbl-power"],
        locations: ["loc-garage"],
        page: 2,
        pageSize: 10,
        tenant: "grp-workshop",
      },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content[0] as { type: string; text: string }).text,
    ) as { items: Array<{ id: string; name: string }>; total: number };
    expect(parsed.items).toEqual([
      { id: "ent-1", name: "Cordless Drill", quantity: 1 },
    ]);
    expect(parsed.total).toBe(1);

    const parsedUrl = new URL(capturedUrl!, "http://localhost");
    expect(parsedUrl.pathname).toBe("/api/v1/entities");
    expect(parsedUrl.searchParams.get("q")).toBe("drill");
    expect(parsedUrl.searchParams.getAll("labels")).toEqual([
      "lbl-tools",
      "lbl-power",
    ]);
    expect(parsedUrl.searchParams.getAll("locations")).toEqual(["loc-garage"]);
    expect(parsedUrl.searchParams.get("page")).toBe("2");
    expect(parsedUrl.searchParams.get("pageSize")).toBe("10");
    expect(capturedTenant).toBe("grp-workshop");
  });

  it("gets entity details by ID and forwards X-Tenant", async () => {
    harness = await startTestServer();
    let capturedTenant: string | string[] | undefined;

    harness.setHomeboxHandler((req, res) => {
      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "user-1", username: "alice" } }));
        return;
      }
      if (req.url === "/api/v1/entities/ent-42" && req.method === "GET") {
        capturedTenant = req.headers["x-tenant"];
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "ent-42",
            name: "Soldering Iron",
            description: "TS100",
            quantity: 1,
          }),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    const { accessToken } = await completeOAuthFlow(harness);
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const result = await client.callTool({
      name: "get_entity",
      arguments: { id: "ent-42", tenant: "grp-lab" },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content[0] as { text: string }).text,
    ) as { id: string; name: string; description: string };
    expect(parsed.id).toBe("ent-42");
    expect(parsed.name).toBe("Soldering Iron");
    expect(parsed.description).toBe("TS100");
    expect(capturedTenant).toBe("grp-lab");
  });

  it("creates an entity via POST /api/v1/entities and forwards X-Tenant", async () => {
    harness = await startTestServer();
    let capturedBody: Record<string, unknown> | undefined;
    let capturedTenant: string | string[] | undefined;

    harness.setHomeboxHandler(async (req, res) => {
      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "user-1", username: "alice" } }));
        return;
      }
      if (req.url === "/api/v1/entities" && req.method === "POST") {
        capturedTenant = req.headers["x-tenant"];
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.from(chunk));
        }
        capturedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
          string,
          unknown
        >;
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "ent-new",
            name: capturedBody.name,
            locationId: capturedBody.locationId,
          }),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    const { accessToken } = await completeOAuthFlow(harness);
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const result = await client.callTool({
      name: "create_entity",
      arguments: {
        name: "Oscilloscope",
        description: "Rigol DS1054Z",
        quantity: 1,
        locationId: "loc-bench",
        labelIds: ["lbl-electronics"],
        tenant: "grp-lab",
      },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(
      (result.content[0] as { text: string }).text,
    ) as { id: string; name: string; locationId: string };
    expect(parsed.id).toBe("ent-new");
    expect(parsed.name).toBe("Oscilloscope");
    expect(capturedBody).toEqual({
      name: "Oscilloscope",
      description: "Rigol DS1054Z",
      quantity: 1,
      locationId: "loc-bench",
      labelIds: ["lbl-electronics"],
    });
    expect(capturedTenant).toBe("grp-lab");
  });

  it("updates (PUT) and patches (PATCH) an entity by ID and forwards X-Tenant", async () => {
    harness = await startTestServer();
    const calls: Array<{
      method: string | undefined;
      url: string | undefined;
      tenant: string | string[] | undefined;
      body: Record<string, unknown>;
    }> = [];

    harness.setHomeboxHandler(async (req, res) => {
      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "user-1", username: "alice" } }));
        return;
      }
      if (
        req.url === "/api/v1/entities/ent-42" &&
        (req.method === "PUT" || req.method === "PATCH")
      ) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.from(chunk));
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
          string,
          unknown
        >;
        calls.push({
          method: req.method,
          url: req.url,
          tenant: req.headers["x-tenant"],
          body,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "ent-42", ...body }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    const { accessToken } = await completeOAuthFlow(harness);
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const putRes = await client.callTool({
      name: "update_entity",
      arguments: {
        id: "ent-42",
        name: "Updated Drill",
        quantity: 2,
        tenant: "grp-1",
      },
    });
    expect(putRes.isError).toBeFalsy();

    const patchRes = await client.callTool({
      name: "patch_entity",
      arguments: {
        id: "ent-42",
        quantity: 3,
        locationId: "loc-shelf-b",
        tenant: "grp-1",
      },
    });
    expect(patchRes.isError).toBeFalsy();

    expect(calls).toEqual([
      {
        method: "PUT",
        url: "/api/v1/entities/ent-42",
        tenant: "grp-1",
        body: { name: "Updated Drill", quantity: 2 },
      },
      {
        method: "PATCH",
        url: "/api/v1/entities/ent-42",
        tenant: "grp-1",
        body: { quantity: 3, locationId: "loc-shelf-b" },
      },
    ]);
  });

  it("deletes an entity by ID and forwards X-Tenant", async () => {
    harness = await startTestServer();
    let deletedUrl: string | undefined;
    let capturedTenant: string | string[] | undefined;

    harness.setHomeboxHandler((req, res) => {
      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "user-1", username: "alice" } }));
        return;
      }
      if (req.url === "/api/v1/entities/ent-99" && req.method === "DELETE") {
        deletedUrl = req.url;
        capturedTenant = req.headers["x-tenant"];
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    const { accessToken } = await completeOAuthFlow(harness);
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const result = await client.callTool({
      name: "delete_entity",
      arguments: { id: "ent-99", tenant: "grp-1" },
    });

    expect(result.isError).toBeFalsy();
    expect(deletedUrl).toBe("/api/v1/entities/ent-99");
    expect(capturedTenant).toBe("grp-1");
  });

  it("retrieves location tree (/v1/entities/tree) and entity breadcrumb path (/v1/entities/{id}/path)", async () => {
    harness = await startTestServer();
    const seenUrls: string[] = [];
    const seenTenants: Array<string | string[] | undefined> = [];

    harness.setHomeboxHandler((req, res) => {
      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "user-1", username: "alice" } }));
        return;
      }
      if (req.url?.startsWith("/api/v1/entities/tree") && req.method === "GET") {
        seenUrls.push(req.url);
        seenTenants.push(req.headers["x-tenant"]);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify([
            {
              id: "loc-home",
              name: "Home",
              children: [{ id: "loc-garage", name: "Garage", children: [] }],
            },
          ]),
        );
        return;
      }
      if (req.url === "/api/v1/entities/ent-42/path" && req.method === "GET") {
        seenUrls.push(req.url);
        seenTenants.push(req.headers["x-tenant"]);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify([
            { id: "loc-home", name: "Home" },
            { id: "loc-garage", name: "Garage" },
            { id: "ent-42", name: "Soldering Iron" },
          ]),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    const { accessToken } = await completeOAuthFlow(harness);
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const treeRes = await client.callTool({
      name: "get_entity_tree",
      arguments: { withItems: true, tenant: "grp-1" },
    });
    expect(treeRes.isError).toBeFalsy();
    const tree = JSON.parse(
      (treeRes.content[0] as { text: string }).text,
    ) as Array<{ id: string; children: Array<{ id: string }> }>;
    expect(tree[0].id).toBe("loc-home");
    expect(tree[0].children[0].id).toBe("loc-garage");

    const pathRes = await client.callTool({
      name: "get_entity_path",
      arguments: { id: "ent-42", tenant: "grp-1" },
    });
    expect(pathRes.isError).toBeFalsy();
    const path = JSON.parse(
      (pathRes.content[0] as { text: string }).text,
    ) as Array<{ id: string; name: string }>;
    expect(path.map((p) => p.id)).toEqual(["loc-home", "loc-garage", "ent-42"]);

    expect(seenUrls).toEqual([
      "/api/v1/entities/tree?withItems=true",
      "/api/v1/entities/ent-42/path",
    ]);
    expect(seenTenants).toEqual(["grp-1", "grp-1"]);
  });

  it("discovers entity custom fields (/v1/entities/fields) and field values (/v1/entities/fields/values)", async () => {
    harness = await startTestServer();
    const seenUrls: string[] = [];
    const seenTenants: Array<string | string[] | undefined> = [];

    harness.setHomeboxHandler((req, res) => {
      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "user-1", username: "alice" } }));
        return;
      }
      if (req.url === "/api/v1/entities/fields" && req.method === "GET") {
        seenUrls.push(req.url);
        seenTenants.push(req.headers["x-tenant"]);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(["Voltage", "Condition"]));
        return;
      }
      if (
        req.url?.startsWith("/api/v1/entities/fields/values") &&
        req.method === "GET"
      ) {
        seenUrls.push(req.url);
        seenTenants.push(req.headers["x-tenant"]);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(["12V", "24V", "120V"]));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    const { accessToken } = await completeOAuthFlow(harness);
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const fieldsRes = await client.callTool({
      name: "get_entity_fields",
      arguments: { tenant: "grp-1" },
    });
    expect(fieldsRes.isError).toBeFalsy();
    expect(
      JSON.parse((fieldsRes.content[0] as { text: string }).text),
    ).toEqual(["Voltage", "Condition"]);

    const valuesRes = await client.callTool({
      name: "get_entity_field_values",
      arguments: { field: "Voltage", tenant: "grp-1" },
    });
    expect(valuesRes.isError).toBeFalsy();
    expect(
      JSON.parse((valuesRes.content[0] as { text: string }).text),
    ).toEqual(["12V", "24V", "120V"]);

    expect(seenUrls).toEqual([
      "/api/v1/entities/fields",
      "/api/v1/entities/fields/values?field=Voltage",
    ]);
    expect(seenTenants).toEqual(["grp-1", "grp-1"]);
  });

  it("validates tool schemas/descriptions and surfaces Homebox 4xx/5xx errors as structured MCP tool errors", async () => {
    harness = await startTestServer();

    harness.setHomeboxHandler((req, res) => {
      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "user-1", username: "alice" } }));
        return;
      }
      if (req.url === "/api/v1/entities/missing-id" && req.method === "GET") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Entity not found" }));
        return;
      }
      if (req.url === "/api/v1/entities" && req.method === "POST") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Database unavailable" }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    const { accessToken } = await completeOAuthFlow(harness);
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const { tools } = await client.listTools();
    const expectedTools = [
      "list_entities",
      "get_entity",
      "create_entity",
      "update_entity",
      "patch_entity",
      "delete_entity",
      "get_entity_tree",
      "get_entity_path",
      "get_entity_fields",
      "get_entity_field_values",
    ];
    for (const name of expectedTools) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, `Expected tool ${name} to be registered`).toBeDefined();
      expect(tool!.description?.length).toBeGreaterThan(10);
    }

    const notFoundRes = await client.callTool({
      name: "get_entity",
      arguments: { id: "missing-id" },
    });
    expect(notFoundRes.isError).toBe(true);
    const notFoundText = (notFoundRes.content[0] as { text: string }).text;
    expect(notFoundText).toContain("404");
    expect(notFoundText).toContain("Entity not found");

    const serverErrRes = await client.callTool({
      name: "create_entity",
      arguments: { name: "Broken Item" },
    });
    expect(serverErrRes.isError).toBe(true);
    const serverErrText = (serverErrRes.content[0] as { text: string }).text;
    expect(serverErrText).toContain("500");
    expect(serverErrText).toContain("Database unavailable");

    const invalidInputRes = await client.callTool({
      name: "get_entity",
      arguments: { id: "" },
    });
    expect(invalidInputRes.isError).toBe(true);
  });
});
