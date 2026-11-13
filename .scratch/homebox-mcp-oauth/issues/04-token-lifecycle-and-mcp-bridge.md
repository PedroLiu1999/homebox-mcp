# 04: Token refresh, revocation, and authenticated MCP tool bridge

**What to build:** Complete the OAuth 2.1 token lifecycle (`grant_type=refresh_token` rotation at `POST /token`, `POST /revoke`, and rejection of expired, revoked, or replayed tokens) and wire authenticated `/mcp` Streamable HTTP requests to decrypt the user's `hb_...` key and execute an initial Homebox MCP tool (`get_current_user` and `list_groups`, including `X-Tenant` header support and upstream error handling).

**Blocked by:** 02: Dynamic Client Registration and OAuth 2.1 PKCE flow with API key login

**Status:** ready-for-agent

- [ ] `POST /token` (`grant_type=refresh_token`) rotates the refresh token, invalidates the previous refresh token, and issues a new access token
- [ ] `POST /revoke` (RFC 7009) revokes access or refresh tokens so subsequent `/mcp` or refresh requests fail with `401`/`400`
- [ ] Authenticated `/mcp` requests validate the Bearer access token, decrypt the bound `hb_...` key, and pass `Authorization: Bearer <hb_...>` to Homebox
- [ ] Initial tools (`get_current_user`, `list_groups`) work end-to-end over Streamable HTTP MCP, with optional `tenant` argument forwarded via `X-Tenant`
- [ ] Upstream Homebox `401` responses (e.g. key revoked in Homebox) return a clear authentication error to the MCP caller
