import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  idSchema,
  runHomeboxTool,
  tenantSchema,
  type ToolRegistrationContext,
} from "./shared.js";

const entityTypeBodyFields = {
  name: z.string().min(1).describe("Entity type name"),
  description: z.string().optional().describe("Optional entity type description"),
  icon: z.string().optional().describe("Optional icon name"),
};

const templateFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  textValue: z.string().optional(),
  numberValue: z.number().optional(),
  booleanValue: z.boolean().optional(),
  timeValue: z.string().optional(),
});

const templateBodyFields = {
  name: z.string().min(1).describe("Template name"),
  description: z.string().optional().describe("Optional template description"),
  notes: z.string().optional().describe("Optional template notes"),
  manufacturer: z.string().optional().describe("Default manufacturer"),
  modelNumber: z.string().optional().describe("Default model number"),
  defaultLocationId: z.string().optional().describe("Default location ID"),
  defaultLabelIds: z.array(z.string()).optional().describe("Default tag/label IDs"),
  fields: z.array(templateFieldSchema).optional().describe("Custom fields"),
  includePurchaseInformation: z
    .boolean()
    .optional()
    .describe("Include purchase fields when creating items"),
  includeWarrantyInformation: z
    .boolean()
    .optional()
    .describe("Include warranty fields when creating items"),
};

/**
 * Registers MCP tools for Homebox entity types (`/v1/entity-types`) and
 * item templates (`/v1/templates`).
 */
export function registerTemplateTools(
  server: McpServer,
  ctx: ToolRegistrationContext,
): void {
  const { homeboxClient, onUnauthorized } = ctx;

  server.registerTool(
    "list_entity_types",
    {
      description: "List all entity types in the Homebox inventory.",
      inputSchema: {
        tenant: tenantSchema,
      },
    },
    async ({ tenant }) =>
      runHomeboxTool(
        () => homeboxClient.request("/api/v1/entity-types", { tenant }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "create_entity_type",
    {
      description: "Create a new Homebox entity type.",
      inputSchema: {
        ...entityTypeBodyFields,
        tenant: tenantSchema,
      },
    },
    async ({ tenant, ...body }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request("/api/v1/entity-types", {
            method: "POST",
            tenant,
            body,
          }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "update_entity_type",
    {
      description: "Update an existing Homebox entity type by ID.",
      inputSchema: {
        id: idSchema,
        ...entityTypeBodyFields,
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant, ...body }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request(
            `/api/v1/entity-types/${encodeURIComponent(id)}`,
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
    "delete_entity_type",
    {
      description: "Delete a Homebox entity type by ID.",
      inputSchema: {
        id: idSchema,
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request(
            `/api/v1/entity-types/${encodeURIComponent(id)}`,
            {
              method: "DELETE",
              tenant,
            },
          ),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "list_templates",
    {
      description: "List all item templates in the Homebox inventory.",
      inputSchema: {
        tenant: tenantSchema,
      },
    },
    async ({ tenant }) =>
      runHomeboxTool(
        () => homeboxClient.request("/api/v1/templates", { tenant }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "get_template",
    {
      description: "Get a single Homebox item template by ID.",
      inputSchema: {
        id: idSchema,
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request(`/api/v1/templates/${encodeURIComponent(id)}`, {
            tenant,
          }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "create_template",
    {
      description: "Create a new Homebox item template.",
      inputSchema: {
        ...templateBodyFields,
        tenant: tenantSchema,
      },
    },
    async ({ tenant, ...body }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request("/api/v1/templates", {
            method: "POST",
            tenant,
            body,
          }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "update_template",
    {
      description: "Update an existing Homebox item template by ID.",
      inputSchema: {
        id: idSchema,
        ...templateBodyFields,
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant, ...body }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request(`/api/v1/templates/${encodeURIComponent(id)}`, {
            method: "PUT",
            tenant,
            body,
          }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "delete_template",
    {
      description: "Delete a Homebox item template by ID.",
      inputSchema: {
        id: idSchema,
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request(`/api/v1/templates/${encodeURIComponent(id)}`, {
            method: "DELETE",
            tenant,
          }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "create_item_from_template",
    {
      description:
        "Create a new Homebox item from an existing item template ID.",
      inputSchema: {
        id: idSchema.describe("Template ID to instantiate"),
        name: z.string().min(1).optional().describe("Override item name"),
        description: z
          .string()
          .optional()
          .describe("Override item description"),
        quantity: z.number().int().positive().optional().describe("Quantity"),
        locationId: z.string().optional().describe("Override location ID"),
        labelIds: z
          .array(z.string())
          .optional()
          .describe("Override tag/label IDs"),
        fields: z
          .array(templateFieldSchema)
          .optional()
          .describe("Override custom fields"),
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant, ...body }) =>
      runHomeboxTool(
        () =>
          homeboxClient.request(
            `/api/v1/templates/${encodeURIComponent(id)}/create-item`,
            {
              method: "POST",
              tenant,
              body,
            },
          ),
        onUnauthorized,
      ),
  );
}
