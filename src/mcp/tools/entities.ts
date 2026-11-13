import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  customFieldSchema,
  idSchema,
  runHomeboxTool,
  tenantSchema,
  type ToolRegistrationContext,
} from "./shared.js";

const entityMutableFieldsSchema = {
  description: z.string().optional().describe("Entity description"),
  quantity: z.number().int().min(0).optional().describe("Item quantity"),
  locationId: z.string().min(1).optional().describe("Location ID"),
  parentId: z.string().min(1).optional().describe("Parent entity ID"),
  labelIds: z
    .array(z.string().min(1))
    .optional()
    .describe("Associated label/tag IDs"),
  entityType: z
    .string()
    .min(1)
    .optional()
    .describe("Entity type (e.g. item or location)"),
  assetId: z.string().min(1).optional().describe("Asset ID"),
  manufacturer: z.string().optional().describe("Manufacturer name"),
  modelNumber: z.string().optional().describe("Model number"),
  serialNumber: z.string().optional().describe("Serial number"),
  purchasePrice: z.number().optional().describe("Purchase price"),
  purchaseFrom: z.string().optional().describe("Vendor / purchased from"),
  purchaseTime: z.string().optional().describe("Purchase timestamp (ISO 8601)"),
  warrantyExpires: z
    .string()
    .optional()
    .describe("Warranty expiration timestamp (ISO 8601)"),
  warrantyDetails: z.string().optional().describe("Warranty details"),
  lifetimeWarranty: z
    .boolean()
    .optional()
    .describe("Whether item has a lifetime warranty"),
  insured: z.boolean().optional().describe("Whether item is insured"),
  archived: z.boolean().optional().describe("Whether entity is archived"),
  notes: z.string().optional().describe("Additional notes"),
  fields: z
    .array(customFieldSchema.extend({ id: z.string().optional() }))
    .optional()
    .describe("Custom entity fields"),
};

/**
 * Registers Homebox entity, location tree, breadcrumb path, and custom field tools.
 */
export function registerEntityTools(
  server: McpServer,
  context: ToolRegistrationContext,
): void {
  const { homeboxClient, onUnauthorized } = context;

  server.registerTool(
    "list_entities",
    {
      description:
        "Search and list Homebox items and locations with optional query, label, location, parent, and pagination filters.",
      inputSchema: {
        q: z.string().optional().describe("Search query string"),
        page: z.number().int().min(1).optional().describe("Page number (1-based)"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Number of items per page"),
        labels: z
          .array(z.string().min(1))
          .optional()
          .describe("Filter by label/tag IDs"),
        locations: z
          .array(z.string().min(1))
          .optional()
          .describe("Filter by location IDs"),
        parentIds: z
          .array(z.string().min(1))
          .optional()
          .describe("Filter by parent entity IDs"),
        entityType: z
          .string()
          .min(1)
          .optional()
          .describe("Filter by entity type"),
        assetId: z.string().min(1).optional().describe("Filter by asset ID"),
        orderBy: z.string().min(1).optional().describe("Sort order field"),
        includeArchived: z
          .boolean()
          .optional()
          .describe("Whether to include archived entities"),
        tenant: tenantSchema,
      },
    },
    async (args) =>
      runHomeboxTool(() => homeboxClient.listEntities(args), onUnauthorized),
  );

  server.registerTool(
    "get_entity",
    {
      description:
        "Get detailed information about a single Homebox entity (item or location) by its ID.",
      inputSchema: {
        id: idSchema.describe("Homebox entity ID"),
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant }) =>
      runHomeboxTool(() => homeboxClient.getEntity(id, tenant), onUnauthorized),
  );

  server.registerTool(
    "create_entity",
    {
      description:
        "Create a new Homebox entity (item or location) with name and optional metadata, location, parent, or labels.",
      inputSchema: {
        name: z.string().min(1).describe("Entity name"),
        ...entityMutableFieldsSchema,
        tenant: tenantSchema,
      },
    },
    async ({ tenant, ...body }) =>
      runHomeboxTool(
        () => homeboxClient.createEntity(body, tenant),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "update_entity",
    {
      description:
        "Replace/update a Homebox entity by ID (PUT /v1/entities/{id}).",
      inputSchema: {
        id: idSchema.describe("Homebox entity ID"),
        name: z.string().min(1).describe("Entity name"),
        ...entityMutableFieldsSchema,
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant, ...body }) =>
      runHomeboxTool(
        () => homeboxClient.updateEntity(id, body, tenant),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "patch_entity",
    {
      description:
        "Partially update a Homebox entity by ID (PATCH /v1/entities/{id}), such as moving location or updating quantity.",
      inputSchema: {
        id: idSchema.describe("Homebox entity ID"),
        name: z.string().min(1).optional().describe("Entity name"),
        ...entityMutableFieldsSchema,
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant, ...body }) =>
      runHomeboxTool(
        () => homeboxClient.patchEntity(id, body, tenant),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "delete_entity",
    {
      description: "Delete a Homebox entity (item or location) by ID.",
      inputSchema: {
        id: idSchema.describe("Homebox entity ID"),
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant }) =>
      runHomeboxTool(
        () => homeboxClient.deleteEntity(id, tenant),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "get_entity_tree",
    {
      description:
        "Retrieve the hierarchical Homebox location tree, optionally including items.",
      inputSchema: {
        withItems: z
          .boolean()
          .optional()
          .describe("Include items inside locations in the tree"),
        tenant: tenantSchema,
      },
    },
    async ({ withItems, tenant }) =>
      runHomeboxTool(
        () => homeboxClient.getEntityTree({ withItems, tenant }),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "get_entity_path",
    {
      description:
        "Retrieve the breadcrumb path of ancestor locations for a Homebox entity.",
      inputSchema: {
        id: idSchema.describe("Homebox entity ID"),
        tenant: tenantSchema,
      },
    },
    async ({ id, tenant }) =>
      runHomeboxTool(
        () => homeboxClient.getEntityPath(id, tenant),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "get_entity_fields",
    {
      description:
        "List all custom field names defined across Homebox entities.",
      inputSchema: {
        tenant: tenantSchema,
      },
    },
    async ({ tenant }) =>
      runHomeboxTool(
        () => homeboxClient.getEntityFields(tenant),
        onUnauthorized,
      ),
  );

  server.registerTool(
    "get_entity_field_values",
    {
      description:
        "List distinct values used for custom entity fields, optionally filtered by field name.",
      inputSchema: {
        field: z
          .string()
          .min(1)
          .optional()
          .describe("Optional custom field name to filter values"),
        tenant: tenantSchema,
      },
    },
    async ({ field, tenant }) =>
      runHomeboxTool(
        () => homeboxClient.getEntityFieldValues({ field, tenant }),
        onUnauthorized,
      ),
  );
}
