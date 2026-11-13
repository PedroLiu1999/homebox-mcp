import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  idSchema,
  runHomeboxTool,
  tenantSchema,
  type ToolRegistrationContext,
} from "./shared.js";

const maintenanceStatusSchema = z
  .enum(["scheduled", "completed", "both"])
  .optional()
  .describe("Optional filter for maintenance status");

const maintenanceBodyFields = {
  name: z.string().min(1).describe("Maintenance entry name"),
  description: z.string().optional().describe("Optional maintenance details"),
  scheduledDate: z
    .string()
    .optional()
    .describe("Optional scheduled date (YYYY-MM-DD or ISO-8601)"),
  completedDate: z
    .string()
    .optional()
    .describe("Optional completed date (YYYY-MM-DD or ISO-8601)"),
  cost: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Optional maintenance cost"),
};

/**
 * Registers MCP tools for Homebox maintenance logs (`/v1/maintenance`,
 * `/v1/entities/{id}/maintenance`).
 */
export function registerMaintenanceTools(
  server: McpServer,
  ctx: ToolRegistrationContext,
): void {
  const { homeboxClient, onUnauthorized } = ctx;

  server.registerTool(
    "list_maintenance",
    {
      description:
        "List maintenance entries across all items in the Homebox inventory.",
      inputSchema: {
        status: maintenanceStatusSchema,
        tenant: tenantSchema,
      },
    },
    async ({ status, tenant }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request("/api/v1/maintenance", {
            tenant,
            query: status ? { status } : undefined,
          }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "list_entity_maintenance",
    {
      description: "List maintenance entries for a specific Homebox item/entity.",
      inputSchema: {
        entityId: idSchema.describe("Homebox entity/item ID"),
        status: maintenanceStatusSchema,
        tenant: tenantSchema,
      },
    },
    async ({ entityId, status, tenant }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request(
            `/api/v1/entities/${encodeURIComponent(entityId)}/maintenance`,
            {
              tenant,
              query: status ? { status } : undefined,
            },
          ),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "create_entity_maintenance",
    {
      description: "Create a maintenance entry for a Homebox item/entity.",
      inputSchema: {
        entityId: idSchema.describe("Homebox entity/item ID"),
        ...maintenanceBodyFields,
        tenant: tenantSchema,
      },
    },
    async ({ entityId, tenant, ...body }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request(
            `/api/v1/entities/${encodeURIComponent(entityId)}/maintenance`,
            {
              method: "POST",
              tenant,
              body,
            },
          ),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "update_maintenance",
    {
      description: "Update an existing Homebox maintenance entry by ID.",
      inputSchema: {
        id: idSchema.describe("Maintenance entry ID"),
        ...maintenanceBodyFields,
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant, ...body }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request(
            `/api/v1/maintenance/${encodeURIComponent(id)}`,
            {
              method: "PUT",
              tenant,
              body,
            },
          ),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "delete_maintenance",
    {
      description: "Delete a Homebox maintenance entry by ID.",
      inputSchema: {
        id: idSchema.describe("Maintenance entry ID"),
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request(
            `/api/v1/maintenance/${encodeURIComponent(id)}`,
            {
              method: "DELETE",
              tenant,
            },
          ),
        onUnauthorized,
      ),
  );
}
