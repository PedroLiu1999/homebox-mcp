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
  publicUrl?: string;
}

export function createHomeboxMcpServer(
  options: CreateHomeboxMcpServerOptions,
): McpServer {
  const { homeboxClient, onUnauthorized, publicUrl } = options;
  const origin = publicUrl?.replace(/\/+$/, "");

  const server = new McpServer({
    name: "homebox-mcp",
    title: "Homebox MCP",
    version: "0.1.0",
    ...(origin
      ? {
          icons: [
            {
              src: `${origin}/logo.svg`,
              mimeType: "image/svg+xml",
              sizes: ["any"],
            },
            {
              src: `${origin}/icon-192.png`,
              mimeType: "image/png",
              sizes: ["192x192"],
            },
            {
              src: `${origin}/icon-512.png`,
              mimeType: "image/png",
              sizes: ["512x512"],
            },
          ],
        }
      : {}),
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
