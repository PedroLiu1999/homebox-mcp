import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  idSchema,
  runHomeboxTool,
  tenantSchema,
  type ToolRegistrationContext,
} from "./shared.js";

interface HomeboxEntityWithAttachments {
  id?: string;
  name?: string;
  attachments?: unknown[];
}

/**
 * Registers MCP tools for Homebox reporting (`/v1/reporting/bill-of-materials`),
 * group statistics (`/v1/groups/statistics`), and entity attachment metadata.
 */
export function registerReportingTools(
  server: McpServer,
  ctx: ToolRegistrationContext,
): void {
  const { homeboxClient, onUnauthorized } = ctx;

  server.registerTool(
    "get_bill_of_materials",
    {
      description:
        "Retrieve the bill-of-materials report for the Homebox inventory.",
      inputSchema: {
        tenant: tenantSchema,
      },
    },
    async ({ tenant }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request("/api/v1/reporting/bill-of-materials", {
            tenant,
          }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "get_group_statistics",
    {
      description:
        "Get inventory summary statistics for the active Homebox group.",
      inputSchema: {
        tenant: tenantSchema,
      },
    },
    async ({ tenant }) =>
      runHomeboxTool(
        () => homeboxClient.request("/api/v1/groups/statistics", { tenant }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "list_entity_attachments",
    {
      description:
        "List attachment metadata (without downloading binary blobs) for a Homebox item/entity.",
      inputSchema: {
        entityId: idSchema.describe("Homebox entity/item ID"),
        tenant: tenantSchema,
      },
    },
    async ({ entityId, tenant }) =>
      runHomeboxTool(async () => {
        const entity =
          await homeboxClient.request<HomeboxEntityWithAttachments>(
            `/api/v1/entities/${encodeURIComponent(entityId)}`,
            { tenant },
          );
        return {
          entityId: entity.id ?? entityId,
          entityName: entity.name ?? null,
          attachments: Array.isArray(entity.attachments)
            ? entity.attachments
            : [],
        };
      }, onUnauthorized),
  );
}
