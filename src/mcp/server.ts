import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HomeboxClient } from "../homebox/client.js";
import { runHomeboxTool, tenantSchema } from "./tools/common.js";
import { registerEntityTools } from "./tools/entities.js";

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

  registerEntityTools(server, { homeboxClient, onUnauthorized });

  return server;
}
