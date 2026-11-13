# 05: Homebox entity, location tree, and search MCP tools

**What to build:** MCP tools to search, list, inspect, create, update, and delete Homebox items and locations (`/v1/entities`), navigate location trees (`/v1/entities/tree`) and item breadcrumb paths (`/v1/entities/{id}/path`), and query custom/entity fields and values (`/v1/entities/fields`, `/v1/entities/fields/values`), with optional `tenant` (`X-Tenant`) support.

**Blocked by:** 04: Token refresh, revocation, and authenticated MCP tool bridge

**Status:** ready-for-agent

- [ ] MCP tools cover listing/searching entities (with query, label/tag, location, and pagination filters), getting entity details, creating, updating/patching, and deleting entities
- [ ] MCP tools cover location tree retrieval (`/v1/entities/tree`), entity breadcrumb path (`/v1/entities/{id}/path`), and entity fields/values discovery
- [ ] All tools accept an optional `tenant` parameter forwarded as `X-Tenant`
- [ ] Tool input schemas and descriptions are validated and Homebox `4xx`/`5xx` errors surface as structured MCP tool errors
- [ ] Integration tests verify tool calls end-to-end through `/mcp` against the stubbed Homebox API
