import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { HomeboxApiError, type HomeboxClient } from "../homebox/client.js";

export interface CreateHomeboxMcpServerOptions {
  homeboxClient: HomeboxClient;
  onUnauthorized?: () => void;
}

const tenantSchema = z
  .string()
  .min(1)
  .optional()
  .describe("Optional Homebox group/tenant ID sent via X-Tenant header");

async function runHomeboxTool(
  fn: () => Promise<unknown>,
  onUnauthorized?: () => void,
): Promise<CallToolResult> {
  try {
    const data = await fn();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  } catch (err) {
    if (err instanceof HomeboxApiError) {
      if (err.status === 401) {
        onUnauthorized?.();
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Homebox authentication failed (401 Unauthorized): your Homebox API key may have been revoked or expired. Please re-authenticate.",
            },
          ],
        };
      }
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: err.message,
          },
        ],
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Homebox request failed: ${message}`,
        },
      ],
    };
  }
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

  return server;
}
