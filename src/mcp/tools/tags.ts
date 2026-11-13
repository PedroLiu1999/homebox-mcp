import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  idSchema,
  runHomeboxTool,
  tenantSchema,
  type ToolRegistrationContext,
} from "./shared.js";

const tagBodyFields = {
  name: z.string().min(1).describe("Tag (label) name"),
  description: z.string().optional().describe("Optional tag description"),
  color: z.string().optional().describe("Optional hex color code"),
};

/**
 * Registers MCP tools for managing Homebox tags/labels (`/v1/tags`).
 */
export function registerTagTools(
  server: McpServer,
  ctx: ToolRegistrationContext,
): void {
  const { homeboxClient, onUnauthorized } = ctx;

  server.registerTool(
    "list_tags",
    {
      description: "List all tags (labels) in the Homebox inventory.",
      inputSchema: {
        tenant: tenantSchema,
      },
    },
    async ({ tenant }) =>
      runHomeboxTool(
        () => homeboxClient.request("/api/v1/tags", { tenant }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "get_tag",
    {
      description: "Get a single Homebox tag (label) by ID.",
      inputSchema: {
        id: idSchema,
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request(`/api/v1/tags/${encodeURIComponent(id)}`, {
            tenant,
          }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "create_tag",
    {
      description: "Create a new Homebox tag (label).",
      inputSchema: {
        ...tagBodyFields,
        tenant: tenantSchema,
      },
    },
    async ({ tenant, ...body }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request("/api/v1/tags", {
            method: "POST",
            tenant,
            body,
          }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "update_tag",
    {
      description: "Update an existing Homebox tag (label) by ID.",
      inputSchema: {
        id: idSchema,
        ...tagBodyFields,
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant, ...body }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request(`/api/v1/tags/${encodeURIComponent(id)}`, {
            method: "PUT",
            tenant,
            body,
          }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "delete_tag",
    {
      description: "Delete a Homebox tag (label) by ID.",
      inputSchema: {
        id: idSchema,
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request(`/api/v1/tags/${encodeURIComponent(id)}`, {
            method: "DELETE",
            tenant,
          }),
        onUnauthorized,
      ),
  );
}
