Status: ready-for-agent

# Homebox MCP Server with Embedded OAuth 2.1

## Problem Statement

Homebox (`sysadminsmedia/homebox`) exposes a REST API (`/api/v1`) that only accepts Homebox-issued opaque session tokens or static `hb_...` API keys. It does not implement OAuth 2.1, Dynamic Client Registration, or OAuth metadata discovery, and it rejects external IdP JWTs. As a result, remote MCP clients (such as Claude, Cursor, and other OAuth 2.1-capable clients) cannot authenticate directly against Homebox or connect securely to a self-hosted Homebox MCP server without manual, unstandardised credential sharing.

Additionally, self-hosters want a simple, repeatable local Docker deployment via Docker Compose that pulls pre-built container images published from GitHub Actions.

## Solution

Build a TypeScript MCP server using `@modelcontextprotocol/sdk` over Streamable HTTP with an **embedded OAuth 2.1 Authorization Server and Resource Server** that bridges MCP clients to Homebox:

1. Remote MCP clients discover OAuth metadata, register dynamically (DCR), and complete an Authorization Code + PKCE (`S256`) flow against the MCP server itself.
2. During authorization, the user authenticates with their Homebox credentials (which are exchanged once for a dedicated, revocable `hb_...` API key and never persisted) or supplies an existing `hb_...` API key.
3. The MCP server encrypts and stores the Homebox API key locally, issues standard OAuth 2.1 access and refresh tokens to the MCP client, and translates authenticated MCP tool calls into Homebox `/api/v1` requests.
4. A GitHub Actions workflow builds and publishes the container image to GitHub Container Registry (GHCR), and a `docker-compose.yml` configuration deploys it locally by pulling that image.

## User Stories

1. As an MCP client user, I want the MCP server to advertise `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` metadata, so that my MCP client can automatically discover how to authenticate.
2. As an MCP client, I want to register dynamically via `POST /register` (RFC 7591), so that I can obtain a `client_id` without manual admin pre-registration.
3. As a Homebox user, I want to authorize an MCP client via `GET /authorize` using PKCE (`S256`), so that my authorization flow is protected against code interception.
4. As a Homebox user, I want to sign in on the MCP authorization page using my Homebox username and password, so that the MCP server can automatically mint a dedicated `hb_...` API key on my behalf without storing my password.
5. As a Homebox user who uses OIDC/SSO on Homebox (or prefers manual key management), I want to paste an existing `hb_...` API key on the MCP authorization page, so that I can still authorize MCP clients even if local password login is disabled.
6. As a Homebox user, I want the MCP server to validate my Homebox credentials or API key before issuing an authorization code, so that invalid credentials are rejected immediately with clear feedback.
7. As a security-conscious user, I want my Homebox `hb_...` API key encrypted at rest in the MCP server's local database, so that a database file leak does not expose raw Homebox credentials.
8. As an MCP client, I want to exchange an authorization code and `code_verifier` at `POST /token` for an OAuth access token and refresh token, so that I can call MCP tools securely.
9. As an MCP client, I want to refresh expired access tokens using `grant_type=refresh_token` at `POST /token`, so that long-lived sessions stay connected without re-prompting the user.
10. As a user or MCP client, I want to revoke tokens via `POST /revoke`, so that I can terminate an MCP client's access when it is no longer needed.
11. As an unauthenticated caller, I want requests to the `/mcp` endpoint without a valid Bearer token to return `401 Unauthorized` with a `WWW-Authenticate` header pointing to the protected resource metadata, so that compliant MCP clients trigger the OAuth flow automatically.
12. As an authenticated MCP user, I want to search, list, and inspect Homebox items and locations (entities), so that my AI assistant can answer questions about what I own and where it is stored.
13. As an authenticated MCP user, I want to view the location tree and item breadcrumb paths, so that my AI assistant understands nested storage hierarchies.
14. As an authenticated MCP user, I want to create, update, and move items and locations in Homebox, so that my AI assistant can help me organize and catalog my inventory.
15. As an authenticated MCP user, I want to list and manage tags (labels), entity types, and templates, so that my AI assistant can categorize items consistently.
16. As an authenticated MCP user, I want to list, create, and update maintenance entries for items, so that my AI assistant can track warranties and upkeep schedules.
17. As an authenticated MCP user, I want to list my Homebox groups and optionally specify a target group (`X-Tenant`), so that I can work across multiple Homebox inventories.
18. As an authenticated MCP user, I want to inspect bill-of-materials / inventory statistics and attachment metadata, so that my AI assistant can summarize inventory value and documentation.
19. As a self-hoster, I want a `docker-compose.yml` that pulls the pre-built image from GHCR and persists the encrypted token database on a volume, so that I can run and upgrade the MCP server locally with minimal setup.
20. As a maintainer, I want a GitHub Actions workflow that runs tests/typechecks and builds/pushes the Docker image to GHCR on pushes and tags, so that the Compose setup always has up-to-date images available.

## Implementation Decisions

- **Language & MCP Runtime:** Build in TypeScript (Node.js LTS) using `@modelcontextprotocol/sdk` with `StreamableHTTPServerTransport` and the SDK's embedded OAuth 2.1 router/provider abstractions (`mcpAuthRouter` / `OAuthServerProvider`) hosted on an HTTP server (Express or Hono).
- **Embedded OAuth 2.1 Provider:**
  - Implement Authorization Server metadata (RFC 8414), Protected Resource metadata (RFC 9728), Dynamic Client Registration (RFC 7591), Authorization Code flow with mandatory PKCE (`S256`), Refresh Token rotation, and Token Revocation (RFC 7009).
  - Issue opaque or signed MCP access tokens (short-lived, e.g. 1 hour) and refresh tokens (longer-lived, e.g. 30 days) mapped to an internal user-grant record.
- **Homebox Credential Bridging:**
  - On `GET /authorize`, render a minimal server-rendered HTML consent/login page with CSRF protection.
  - Support two login modes on the form:
    1. *Username & Password*: call Homebox `POST /api/v1/users/login` to obtain a temporary session token, call `POST /api/v1/users/self/api-keys` to mint a dedicated `hb_...` key (named after the MCP client), and discard the password and temporary session token.
    2. *Direct API Key*: accept an `hb_...` key and verify it via `GET /api/v1/users/self`.
  - Encrypt the `hb_...` key with authenticated encryption (AES-256-GCM) using a configured `TOKEN_ENCRYPTION_KEY` before storing it.
- **Persistence Layer:** Use embedded SQLite (e.g. `better-sqlite3` or `node:sqlite`) stored on a configurable data path for Docker volume persistence, storing registered OAuth clients, pending authorization codes (with PKCE challenge, redirect URI, expiry), refresh/access token records, and encrypted Homebox API keys.
- **Homebox API Client:**
  - Generate or define typed request/response schemas from Homebox's OpenAPI 3.0.0 specification (`/api/v1`).
  - Pass `Authorization: Bearer <hb_key>` on every upstream request and support optional `tenant` parameter forwarding via the `X-Tenant` header.
  - Surface Homebox HTTP errors (401/403/404/422) cleanly as MCP tool errors (and invalidate/flag revoked `hb_...` keys when Homebox returns 401).
- **MCP Tool Surface:** Expose cohesive, well-documented tools for Homebox entities (search/list/get/create/update/delete/tree/path), tags, entity types, templates, maintenance logs, groups, and reporting/BOM, plus a health/status check.
- **Containerization & CI/CD:**
  - Multi-stage `Dockerfile` (builder stage compiling TypeScript, slim runtime stage running non-root with healthcheck).
  - GitHub Actions workflow triggered on pushes to `main`, version tags, and pull requests: runs typecheck/lint/tests on PRs, and builds/pushes multi-arch or `linux/amd64`/`linux/arm64` images to `ghcr.io` on `main` and tags.
  - `docker-compose.yml` referencing the `ghcr.io` image, mounting a named volume for the SQLite database, and configuring `HOMEBOX_URL`, `MCP_PUBLIC_URL`, `TOKEN_ENCRYPTION_KEY`, and `PORT` via environment variables / `.env`.

## Testing Decisions

- **Primary Seam:** Test at the **HTTP server boundary** of the MCP + OAuth 2.1 application using real SQLite storage (in-memory or temp file) and the real `@modelcontextprotocol/sdk` transport, while stubbing only the **external Homebox `/api/v1` HTTP upstream** (via a local mock HTTP server or `fetch` interceptor).
- **What Makes a Good Test:**
  - Assert only external HTTP and MCP protocol behavior (status codes, `WWW-Authenticate` headers, metadata JSON, PKCE verification failures, token exchange, token refresh/revocation, encrypted-at-rest behavior, and MCP tool inputs/outputs).
  - Do not assert internal SQL queries, private helper functions, or internal SDK wiring.
- **Modules / Flows Tested:**
  - OAuth 2.1 discovery (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`) and Dynamic Client Registration (`POST /register`).
  - Authorization Code + PKCE (`S256`) flow for both username/password login (verifying `/v1/users/login` -> `/v1/users/self/api-keys` exchange) and direct `hb_...` API key login (verifying `/v1/users/self`).
  - Token issuance, refresh rotation, revocation, and rejection of invalid/expired/replayed codes or tokens.
  - End-to-end MCP Streamable HTTP tool calls (authorized vs unauthorized `401`, upstream Homebox error propagation, and `X-Tenant` forwarding).
- **Prior Art:** This is a greenfield repository; these integration tests will establish the test suite pattern (e.g. Vitest + HTTP client + mock Homebox server).

## Out of Scope

- External OIDC/OAuth IdP delegation (e.g. Authentik/Keycloak Resource Server mode) — embedded OAuth 2.1 is the chosen model.
- Modifying Homebox's Go backend to add native OAuth 2.1 support.
- Binary file upload/download streaming for large Homebox attachments or label printing hardware integration (attachment metadata listing is in scope; binary blob transfer is out of scope for v1).
- Multi-node horizontal clustering / external Postgres session store (single-instance SQLite with Docker volume is the target).

## Further Notes

- Upstream Homebox API and authentication details are documented in `docs/homebox-api.md`.
- Local Docker Compose deployments behind a reverse proxy (e.g. Caddy, Traefik, Nginx) should set `MCP_PUBLIC_URL` to the external HTTPS origin so OAuth metadata URLs and redirect URIs match what remote MCP clients expect.
