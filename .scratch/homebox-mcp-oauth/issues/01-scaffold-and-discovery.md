# 01: Project scaffold, HTTP server, and OAuth metadata discovery

**What to build:** A runnable TypeScript Node.js MCP server over Streamable HTTP with a Vitest integration test harness (testing at the HTTP server boundary with a stubbed Homebox upstream), exposing `/health`, `GET /.well-known/oauth-protected-resource`, `GET /.well-known/oauth-authorization-server`, and `/mcp` returning `401 Unauthorized` with a `WWW-Authenticate` header for unauthenticated requests.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] TypeScript project builds cleanly and passes typechecking and Vitest integration tests
- [ ] `GET /health` returns `200 OK`
- [ ] `GET /.well-known/oauth-protected-resource` returns RFC 9728 metadata pointing to the configured `MCP_PUBLIC_URL` authorization server
- [ ] `GET /.well-known/oauth-authorization-server` returns RFC 8414 metadata advertising `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `revocation_endpoint`, and `S256` PKCE support
- [ ] Unauthenticated requests to `/mcp` return `401 Unauthorized` with a `WWW-Authenticate` header referencing the protected resource metadata URL
