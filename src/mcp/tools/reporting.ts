import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  idSchema,
  runHomeboxTool,
  tenantSchema,
  type ToolRegistrationContext,
} from "./shared.js";

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
        () => homeboxClient.getBillOfMaterials(tenant),
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
        () => homeboxClient.getGroupStatistics(tenant),
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
        const entity = await homeboxClient.getEntity(entityId, tenant);
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
