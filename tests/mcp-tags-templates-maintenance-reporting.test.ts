import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
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

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
}

async function completeOAuthFlow(
  harness: TestHarness,
  apiKey = "hb_tools_test_key",
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

describe("Homebox tags, templates, maintenance, and reporting MCP tools", () => {
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

  it("lists, gets, creates, updates, and deletes tags with optional X-Tenant forwarding", async () => {
    harness = await startTestServer();
    const seen: Array<{
      method: string | undefined;
      url: string | undefined;
      tenant: string | string[] | undefined;
      body: unknown;
    }> = [];

    harness.setHomeboxHandler(async (req, res) => {
      const body = await readJsonBody(req);
      seen.push({
        method: req.method,
        url: req.url,
        tenant: req.headers["x-tenant"],
        body,
      });

      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "u1", username: "alice" } }));
        return;
      }
      if (req.url === "/api/v1/tags" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ id: "tag-1", name: "Electronics" }]));
        return;
      }
      if (req.url === "/api/v1/tags/tag-1" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "tag-1", name: "Electronics" }));
        return;
      }
      if (req.url === "/api/v1/tags" && req.method === "POST") {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "tag-2", ...(body as object) }));
        return;
      }
      if (req.url === "/api/v1/tags/tag-2" && req.method === "PUT") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "tag-2", ...(body as object) }));
        return;
      }
      if (req.url === "/api/v1/tags/tag-2" && req.method === "DELETE") {
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    const { accessToken } = await completeOAuthFlow(harness);
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const listRes = await client.callTool({
      name: "list_tags",
      arguments: { tenant: "grp-a" },
    });
    expect(listRes.isError).toBeFalsy();
    expect(JSON.parse((listRes.content[0] as { text: string }).text)).toEqual([
      { id: "tag-1", name: "Electronics" },
    ]);

    const getRes = await client.callTool({
      name: "get_tag",
      arguments: { id: "tag-1" },
    });
    expect(getRes.isError).toBeFalsy();
    expect(JSON.parse((getRes.content[0] as { text: string }).text)).toEqual({
      id: "tag-1",
      name: "Electronics",
    });

    const createRes = await client.callTool({
      name: "create_tag",
      arguments: {
        name: "Tools",
        description: "Garage tools",
        color: "#ff0000",
        tenant: "grp-a",
      },
    });
    expect(createRes.isError).toBeFalsy();
    expect(JSON.parse((createRes.content[0] as { text: string }).text)).toEqual(
      {
        id: "tag-2",
        name: "Tools",
        description: "Garage tools",
        color: "#ff0000",
      },
    );

    const updateRes = await client.callTool({
      name: "update_tag",
      arguments: {
        id: "tag-2",
        name: "Power Tools",
        color: "#00ff00",
      },
    });
    expect(updateRes.isError).toBeFalsy();
    expect(JSON.parse((updateRes.content[0] as { text: string }).text)).toEqual(
      {
        id: "tag-2",
        name: "Power Tools",
        color: "#00ff00",
      },
    );

    const deleteRes = await client.callTool({
      name: "delete_tag",
      arguments: { id: "tag-2", tenant: "grp-a" },
    });
    expect(deleteRes.isError).toBeFalsy();

    // Verify upstream calls (index 0 was /api/v1/users/self during OAuth)
    const tagCalls = seen.slice(1);
    expect(tagCalls).toEqual([
      { method: "GET", url: "/api/v1/tags", tenant: "grp-a", body: undefined },
      {
        method: "GET",
        url: "/api/v1/tags/tag-1",
        tenant: undefined,
        body: undefined,
      },
      {
        method: "POST",
        url: "/api/v1/tags",
        tenant: "grp-a",
        body: { name: "Tools", description: "Garage tools", color: "#ff0000" },
      },
      {
        method: "PUT",
        url: "/api/v1/tags/tag-2",
        tenant: undefined,
        body: { name: "Power Tools", color: "#00ff00" },
      },
      {
        method: "DELETE",
        url: "/api/v1/tags/tag-2",
        tenant: "grp-a",
        body: undefined,
      },
    ]);
  });

  it("manages entity types and templates including creating an item from a template", async () => {
    harness = await startTestServer();
    const seen: Array<{
      method: string | undefined;
      url: string | undefined;
      tenant: string | string[] | undefined;
      body: unknown;
    }> = [];

    harness.setHomeboxHandler(async (req, res) => {
      const body = await readJsonBody(req);
      seen.push({
        method: req.method,
        url: req.url,
        tenant: req.headers["x-tenant"],
        body,
      });

      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "u1", username: "alice" } }));
        return;
      }
      if (req.url === "/api/v1/entity-types" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ id: "et-1", name: "Appliance" }]));
        return;
      }
      if (req.url === "/api/v1/entity-types" && req.method === "POST") {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "et-2", ...(body as object) }));
        return;
      }
      if (req.url === "/api/v1/entity-types/et-2" && req.method === "PUT") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "et-2", ...(body as object) }));
        return;
      }
      if (req.url === "/api/v1/entity-types/et-2" && req.method === "DELETE") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === "/api/v1/templates" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ id: "tpl-1", name: "Laptop Template" }]));
        return;
      }
      if (req.url === "/api/v1/templates/tpl-1" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "tpl-1", name: "Laptop Template" }));
        return;
      }
      if (req.url === "/api/v1/templates" && req.method === "POST") {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "tpl-2", ...(body as object) }));
        return;
      }
      if (req.url === "/api/v1/templates/tpl-2" && req.method === "PUT") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "tpl-2", ...(body as object) }));
        return;
      }
      if (
        req.url === "/api/v1/templates/tpl-2/create-item" &&
        req.method === "POST"
      ) {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "item-99", ...(body as object) }));
        return;
      }
      if (req.url === "/api/v1/templates/tpl-2" && req.method === "DELETE") {
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    const { accessToken } = await completeOAuthFlow(harness);
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const listEt = await client.callTool({
      name: "list_entity_types",
      arguments: { tenant: "grp-b" },
    });
    expect(listEt.isError).toBeFalsy();
    expect(JSON.parse((listEt.content[0] as { text: string }).text)).toEqual([
      { id: "et-1", name: "Appliance" },
    ]);

    const createEt = await client.callTool({
      name: "create_entity_type",
      arguments: { name: "Vehicle", icon: "car" },
    });
    expect(createEt.isError).toBeFalsy();

    const updateEt = await client.callTool({
      name: "update_entity_type",
      arguments: { id: "et-2", name: "Motor Vehicle", description: "Cars" },
    });
    expect(updateEt.isError).toBeFalsy();

    const deleteEt = await client.callTool({
      name: "delete_entity_type",
      arguments: { id: "et-2" },
    });
    expect(deleteEt.isError).toBeFalsy();

    const listTpl = await client.callTool({
      name: "list_templates",
      arguments: { tenant: "grp-b" },
    });
    expect(listTpl.isError).toBeFalsy();

    const getTpl = await client.callTool({
      name: "get_template",
      arguments: { id: "tpl-1" },
    });
    expect(getTpl.isError).toBeFalsy();

    const createTpl = await client.callTool({
      name: "create_template",
      arguments: {
        name: "Server Template",
        description: "Rack server",
        defaultLocationId: "loc-1",
        tenant: "grp-b",
      },
    });
    expect(createTpl.isError).toBeFalsy();

    const updateTpl = await client.callTool({
      name: "update_template",
      arguments: {
        id: "tpl-2",
        name: "Rack Server Template",
        manufacturer: "Dell",
      },
    });
    expect(updateTpl.isError).toBeFalsy();

    const createItem = await client.callTool({
      name: "create_item_from_template",
      arguments: {
        id: "tpl-2",
        name: "ProLiant DL380",
        quantity: 2,
        locationId: "loc-rack",
        tenant: "grp-b",
      },
    });
    expect(createItem.isError).toBeFalsy();
    expect(JSON.parse((createItem.content[0] as { text: string }).text)).toEqual(
      {
        id: "item-99",
        name: "ProLiant DL380",
        quantity: 2,
        locationId: "loc-rack",
      },
    );

    const deleteTpl = await client.callTool({
      name: "delete_template",
      arguments: { id: "tpl-2" },
    });
    expect(deleteTpl.isError).toBeFalsy();

    expect(seen.slice(1)).toEqual([
      {
        method: "GET",
        url: "/api/v1/entity-types",
        tenant: "grp-b",
        body: undefined,
      },
      {
        method: "POST",
        url: "/api/v1/entity-types",
        tenant: undefined,
        body: { name: "Vehicle", icon: "car" },
      },
      {
        method: "PUT",
        url: "/api/v1/entity-types/et-2",
        tenant: undefined,
        body: { name: "Motor Vehicle", description: "Cars" },
      },
      {
        method: "DELETE",
        url: "/api/v1/entity-types/et-2",
        tenant: undefined,
        body: undefined,
      },
      {
        method: "GET",
        url: "/api/v1/templates",
        tenant: "grp-b",
        body: undefined,
      },
      {
        method: "GET",
        url: "/api/v1/templates/tpl-1",
        tenant: undefined,
        body: undefined,
      },
      {
        method: "POST",
        url: "/api/v1/templates",
        tenant: "grp-b",
        body: {
          name: "Server Template",
          description: "Rack server",
          defaultLocationId: "loc-1",
        },
      },
      {
        method: "PUT",
        url: "/api/v1/templates/tpl-2",
        tenant: undefined,
        body: { name: "Rack Server Template", manufacturer: "Dell" },
      },
      {
        method: "POST",
        url: "/api/v1/templates/tpl-2/create-item",
        tenant: "grp-b",
        body: {
          name: "ProLiant DL380",
          quantity: 2,
          locationId: "loc-rack",
        },
      },
      {
        method: "DELETE",
        url: "/api/v1/templates/tpl-2",
        tenant: undefined,
        body: undefined,
      },
    ]);
  });

  it("lists, creates, updates, and deletes maintenance entries with optional status and X-Tenant", async () => {
    harness = await startTestServer();
    const seen: Array<{
      method: string | undefined;
      url: string | undefined;
      tenant: string | string[] | undefined;
      body: unknown;
    }> = [];

    harness.setHomeboxHandler(async (req, res) => {
      const body = await readJsonBody(req);
      seen.push({
        method: req.method,
        url: req.url,
        tenant: req.headers["x-tenant"],
        body,
      });

      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "u1", username: "alice" } }));
        return;
      }
      if (
        req.url === "/api/v1/maintenance?status=scheduled" &&
        req.method === "GET"
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ id: "m-1", name: "Filter change" }]));
        return;
      }
      if (
        req.url === "/api/v1/entities/item-1/maintenance" &&
        req.method === "GET"
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ id: "m-1", name: "Filter change" }]));
        return;
      }
      if (
        req.url === "/api/v1/entities/item-1/maintenance" &&
        req.method === "POST"
      ) {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "m-2", ...(body as object) }));
        return;
      }
      if (req.url === "/api/v1/maintenance/m-2" && req.method === "PUT") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "m-2", ...(body as object) }));
        return;
      }
      if (req.url === "/api/v1/maintenance/m-2" && req.method === "DELETE") {
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    const { accessToken } = await completeOAuthFlow(harness);
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const listAll = await client.callTool({
      name: "list_maintenance",
      arguments: { status: "scheduled", tenant: "grp-m" },
    });
    expect(listAll.isError).toBeFalsy();
    expect(JSON.parse((listAll.content[0] as { text: string }).text)).toEqual([
      { id: "m-1", name: "Filter change" },
    ]);

    const listEntity = await client.callTool({
      name: "list_entity_maintenance",
      arguments: { entityId: "item-1" },
    });
    expect(listEntity.isError).toBeFalsy();

    const createMaint = await client.callTool({
      name: "create_entity_maintenance",
      arguments: {
        entityId: "item-1",
        name: "Annual inspection",
        description: "Check seals",
        scheduledDate: "2026-12-01",
        cost: "45.00",
        tenant: "grp-m",
      },
    });
    expect(createMaint.isError).toBeFalsy();

    const updateMaint = await client.callTool({
      name: "update_maintenance",
      arguments: {
        id: "m-2",
        name: "Annual inspection",
        completedDate: "2026-12-02",
        cost: "50.00",
      },
    });
    expect(updateMaint.isError).toBeFalsy();

    const deleteMaint = await client.callTool({
      name: "delete_maintenance",
      arguments: { id: "m-2", tenant: "grp-m" },
    });
    expect(deleteMaint.isError).toBeFalsy();

    expect(seen.slice(1)).toEqual([
      {
        method: "GET",
        url: "/api/v1/maintenance?status=scheduled",
        tenant: "grp-m",
        body: undefined,
      },
      {
        method: "GET",
        url: "/api/v1/entities/item-1/maintenance",
        tenant: undefined,
        body: undefined,
      },
      {
        method: "POST",
        url: "/api/v1/entities/item-1/maintenance",
        tenant: "grp-m",
        body: {
          name: "Annual inspection",
          description: "Check seals",
          scheduledDate: "2026-12-01",
          cost: "45.00",
        },
      },
      {
        method: "PUT",
        url: "/api/v1/maintenance/m-2",
        tenant: undefined,
        body: {
          name: "Annual inspection",
          completedDate: "2026-12-02",
          cost: "50.00",
        },
      },
      {
        method: "DELETE",
        url: "/api/v1/maintenance/m-2",
        tenant: "grp-m",
        body: undefined,
      },
    ]);
  });

  it("reads bill-of-materials reporting, group statistics, and entity attachment metadata", async () => {
    harness = await startTestServer();
    const seen: Array<{
      method: string | undefined;
      url: string | undefined;
      tenant: string | string[] | undefined;
    }> = [];

    harness.setHomeboxHandler((req, res) => {
      seen.push({
        method: req.method,
        url: req.url,
        tenant: req.headers["x-tenant"],
      });

      if (req.url === "/api/v1/users/self" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ item: { id: "u1", username: "alice" } }));
        return;
      }
      if (
        req.url === "/api/v1/reporting/bill-of-materials" &&
        req.method === "GET"
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("id,name,quantity,purchasePrice\nitem-1,Drill,1,129.99\n");
        return;
      }
      if (req.url === "/api/v1/groups/statistics" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            totalItems: 42,
            totalLocations: 6,
            totalLabels: 8,
            totalUsers: 2,
            totalWithWarranty: 5,
            totalItemPrice: 3450.5,
          }),
        );
        return;
      }
      if (req.url === "/api/v1/entities/item-1" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "item-1",
            name: "Cordless Drill",
            attachments: [
              {
                id: "att-1",
                title: "manual.pdf",
                type: "manual",
                mimeType: "application/pdf",
                primary: false,
              },
              {
                id: "att-2",
                title: "photo.jpg",
                type: "photo",
                mimeType: "image/jpeg",
                primary: true,
              },
            ],
          }),
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    const { accessToken } = await completeOAuthFlow(harness);
    client = await connectMcpClient(harness.baseUrl, accessToken);

    const bomRes = await client.callTool({
      name: "get_bill_of_materials",
      arguments: { tenant: "grp-r" },
    });
    expect(bomRes.isError).toBeFalsy();
    expect(JSON.parse((bomRes.content[0] as { text: string }).text)).toContain(
      "item-1,Drill,1,129.99",
    );

    const statsRes = await client.callTool({
      name: "get_group_statistics",
      arguments: { tenant: "grp-r" },
    });
    expect(statsRes.isError).toBeFalsy();
    expect(JSON.parse((statsRes.content[0] as { text: string }).text)).toEqual({
      totalItems: 42,
      totalLocations: 6,
      totalLabels: 8,
      totalUsers: 2,
      totalWithWarranty: 5,
      totalItemPrice: 3450.5,
    });

    const attRes = await client.callTool({
      name: "list_entity_attachments",
      arguments: { entityId: "item-1", tenant: "grp-r" },
    });
    expect(attRes.isError).toBeFalsy();
    expect(JSON.parse((attRes.content[0] as { text: string }).text)).toEqual({
      entityId: "item-1",
      entityName: "Cordless Drill",
      attachments: [
        {
          id: "att-1",
          title: "manual.pdf",
          type: "manual",
          mimeType: "application/pdf",
          primary: false,
        },
        {
          id: "att-2",
          title: "photo.jpg",
          type: "photo",
          mimeType: "image/jpeg",
          primary: true,
        },
      ],
    });

    const missingRes = await client.callTool({
      name: "list_entity_attachments",
      arguments: { entityId: "item-missing" },
    });
    expect(missingRes.isError).toBe(true);
    expect((missingRes.content[0] as { text: string }).text).toContain("404");

    expect(seen.slice(1)).toEqual([
      {
        method: "GET",
        url: "/api/v1/reporting/bill-of-materials",
        tenant: "grp-r",
      },
      {
        method: "GET",
        url: "/api/v1/groups/statistics",
        tenant: "grp-r",
      },
      {
        method: "GET",
        url: "/api/v1/entities/item-1",
        tenant: "grp-r",
      },
      {
        method: "GET",
        url: "/api/v1/entities/item-missing",
        tenant: undefined,
      },
    ]);
  });
});
