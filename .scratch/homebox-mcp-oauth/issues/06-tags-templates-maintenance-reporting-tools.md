# 06: Homebox tags, templates, maintenance, and reporting MCP tools

**What to build:** MCP tools for managing Homebox tags/labels (`/v1/tags`), entity types and item templates (`/v1/entity-types`, `/v1/templates`), maintenance logs (`/v1/maintenance`, `/v1/entities/{id}/maintenance`), attachment metadata, and inventory reporting/statistics (`/v1/reporting/bill-of-materials`, `/v1/groups/statistics`), with optional `tenant` (`X-Tenant`) support.

**Blocked by:** 04: Token refresh, revocation, and authenticated MCP tool bridge

**Status:** resolved

- [ ] MCP tools cover listing, creating, updating, and deleting tags (`/v1/tags`)
- [ ] MCP tools cover listing/managing entity types (`/v1/entity-types`) and templates (`/v1/templates`, including creating an item from a template)
- [ ] MCP tools cover listing, creating, updating, and deleting maintenance entries (`/v1/maintenance`, `/v1/entities/{id}/maintenance`)
- [ ] MCP tools cover reading bill-of-materials reporting (`/v1/reporting/bill-of-materials`), group statistics (`/v1/groups/statistics`), and attachment metadata on entities
- [ ] Integration tests verify these tools end-to-end through `/mcp` against the stubbed Homebox API
