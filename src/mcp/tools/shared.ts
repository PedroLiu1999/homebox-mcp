import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { HomeboxApiError, type HomeboxClient } from "../../homebox/client.js";

export interface ToolRegistrationContext {
  homeboxClient: HomeboxClient;
  onUnauthorized?: () => void;
}

export const tenantSchema = z
  .string()
  .min(1)
  .optional()
  .describe("Optional Homebox group/tenant ID sent via X-Tenant header");

export const idSchema = z
  .string()
  .min(1)
  .describe("Homebox resource identifier");

export async function runHomeboxTool(
  fn: () => Promise<unknown>,
  onUnauthorized?: () => void,
): Promise<CallToolResult> {
  try {
    const data = await fn();
    const text =
      data === undefined
        ? JSON.stringify({ ok: true })
        : JSON.stringify(data, null, 2);
    return {
      content: [
        {
          type: "text",
          text,
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
