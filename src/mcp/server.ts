import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HomeboxClient } from "../homebox/client.js";
import { registerEntityTools } from "./tools/entities.js";
import { registerMaintenanceTools } from "./tools/maintenance.js";
import { registerReportingTools } from "./tools/reporting.js";
import { runHomeboxTool, tenantSchema } from "./tools/shared.js";
import { registerTagTools } from "./tools/tags.js";
import { registerTemplateTools } from "./tools/templates.js";

export interface CreateHomeboxMcpServerOptions {
  homeboxClient: HomeboxClient;
  onUnauthorized?: () => void;
}

export function createHomeboxMcpServer(
  options: CreateHomeboxMcpServerOptions,
): McpServer {
  const { homeboxClient, onUnauthorized } = options;

  const server = new McpServer({
    name: "homebox-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "get_homebox_status",
    {
      description:
        "Get Homebox server status and version information (GET /api/v1/status).",
      inputSchema: {
        tenant: tenantSchema,
      },
    },
    async ({ tenant }) =>
      runHomeboxTool(() => homeboxClient.getStatus(tenant), onUnauthorized),
  );

  server.registerTool(
    "get_current_user",
    {
      description:
        "Get the currently authenticated Homebox user profile and active group information.",
      inputSchema: {
        tenant: tenantSchema,
      },
    },
    async ({ tenant }) =>
      runHomeboxTool(() => homeboxClient.getCurrentUser(tenant), onUnauthorized),
  );

  server.registerTool(
    "list_groups",
    {
      description:
        "List all Homebox groups/inventories the authenticated user belongs to.",
      inputSchema: {
        tenant: tenantSchema,
      },
    },
    async ({ tenant }) =>
      runHomeboxTool(() => homeboxClient.listGroups(tenant), onUnauthorized),
  );

  const ctx = { homeboxClient, onUnauthorized };
  registerEntityTools(server, ctx);
  registerTagTools(server, ctx);
  registerTemplateTools(server, ctx);
  registerMaintenanceTools(server, ctx);
  registerReportingTools(server, ctx);

  return server;
}
