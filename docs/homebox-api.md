# Homebox API & Authentication Investigation

## 1. Upstream Repository & Official Documentation

- **Original repository (archived):** [`hay-kot/homebox`](https://github.com/hay-kot/homebox) — archived on GitHub (`archived: true`, last pushed `2024-06-11T13:58:05Z`).
- **Active upstream repository:** [`sysadminsmedia/homebox`](https://github.com/sysadminsmedia/homebox) — active continuation of Homebox (`archived: false`, default branch `main`, actively maintained).
- **Official documentation site:** [`https://homebox.software`](https://homebox.software) (configured in [`docs/astro.config.mjs`](https://github.com/sysadminsmedia/homebox/blob/main/docs/astro.config.mjs#L35)).

All API and authentication findings below are verified against `sysadminsmedia/homebox` (`main` branch).

---

## 2. Homebox API Overview

### 2.1 Base URL, Versioning & OpenAPI/Swagger

- **Router & Base Path:** The Go backend uses `chi` and mounts version 1 of the REST API under `/api/v1` (`const prefix = "/api"` and `r.Route(prefix+"/v1", ...)` in [`backend/app/api/routes.go`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L25) and [lines 94–298](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L94-L298)).
- **OpenAPI / Swagger Specs:**
  - **OpenAPI 3.0.0** (`"openapi": "3.0.0"`, `"title": "Homebox API"`, `"version": "1.0"`, `servers: [{"url": "/api"}]`): [`backend/app/api/static/docs/openapi-3.json`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/static/docs/openapi-3.json) and [`openapi-3.yaml`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/static/docs/openapi-3.yaml) (also published under [`docs/public/api/openapi-3.0.json`](https://github.com/sysadminsmedia/homebox/blob/main/docs/public/api/openapi-3.0.json)).
  - **Swagger 2.0:** [`backend/app/api/static/docs/swagger.json`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/static/docs/swagger.json) and [`swagger.yaml`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/static/docs/swagger.yaml).
  - **Live serving:** Exposed unauthenticated at `GET /swagger/doc.json` (rewriting `host` via `SecureBaseURL` / `r.Host`) and Swagger UI at `GET /swagger/*` ([`backend/app/api/routes.go#L41-L76`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L41-L76)).
- **Spec Size:** `openapi-3.json` defines **79 paths** and **111 operations** across 18 tags.
- **Multi-Tenancy (Group Scoping):** Authenticated routes use `mwTenant`, which resolves the active group/collection from the `X-Tenant` request header, the `?tenant=` query parameter, or falls back to `user.DefaultGroupID` ([`backend/app/api/middleware.go#L330-L358`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/middleware.go#L330-L358)).

### 2.2 Key API Resources & Endpoints

All endpoints below are relative to `/api` (so `/v1/...` is served at `/api/v1/...`), as defined in [`backend/app/api/routes.go`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go) and [`openapi-3.json`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/static/docs/openapi-3.json):

| Resource Area | Key Endpoints | Source Reference |
| --- | --- | --- |
| **Base / Health** | `GET /v1/status`, `GET /v1/currencies` | [`routes.go#L95-L101`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L95-L101) |
| **Entities (Items & Locations)** | `GET/POST /v1/entities`, `GET/PUT/PATCH/DELETE /v1/entities/{id}`, `POST /v1/entities/{id}/duplicate`, `GET /v1/entities/{id}/path`, `GET /v1/entities/tree`, `GET /v1/entities/fields`, `GET /v1/entities/fields/values`, `POST /v1/entities/import`, `GET /v1/entities/export` | [`routes.go#L201-L215`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L201-L215) |
| **Entity Types & Templates** | `GET/POST /v1/entity-types`, `PUT/DELETE /v1/entity-types/{id}`; `GET/POST /v1/templates`, `GET/PUT/DELETE /v1/templates/{id}`, `POST /v1/templates/{id}/create-item` | [`routes.go#L196-L199`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L196-L199), [`L230-L235`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L230-L235) |
| **Assets, Barcodes & QR** | `GET /v1/assets/{id}`, `GET /v1/products/search-from-barcode`, `GET /v1/qrcode` | [`routes.go#L227`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L227), [`L272-L274`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L272-L274) |
| **Attachments** | `POST /v1/entities/{id}/attachments`, `POST /v1/entities/{id}/attachments/external`, `GET/PUT/DELETE /v1/entities/{id}/attachments/{attachment_id}` | [`routes.go#L218-L221`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L218-L221), [`L275-L278`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L275-L278) |
| **Tags (Labels)** | `GET/POST /v1/tags`, `GET/PUT/DELETE /v1/tags/{id}` | [`routes.go#L189-L193`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L189-L193) |
| **Label Templates & Labelmaker** | `GET/POST /v1/label-templates`, `GET/PUT/DELETE /v1/label-templates/{id}`, `.../preview`, `.../render`, `.../print`, `.../render-assets`, `.../render-locations`, `.../print-locations`, `.../presets`, `.../barcode-formats`; `GET /v1/labelmaker/{entity,location,item,asset}/{id}` | [`routes.go#L238-L251`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L238-L251), [`L281-L284`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L281-L284) |
| **Maintenance** | `GET/POST /v1/entities/{id}/maintenance`, `GET /v1/maintenance`, `PUT/DELETE /v1/maintenance/{id}` | [`routes.go#L224-L225`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L224-L225), [`L254-L256`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L254-L256) |
| **Users & API Keys** | `POST /v1/users/register`, `GET/PUT/DELETE /v1/users/self`, `GET/PUT /v1/users/self/settings`, `PUT /v1/users/self/change-password`, `GET/POST /v1/users/self/api-keys`, `DELETE /v1/users/self/api-keys/{id}` | [`routes.go#L107`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L107), [`L137-L150`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L137-L150) |
| **Groups, Exports & Stats** | `GET /v1/groups/all`, `GET/POST/PUT/DELETE /v1/groups`, `GET /v1/groups/members`, `DELETE /v1/groups/members/{user_id}`, `GET/POST/DELETE /v1/groups/invitations`, `POST /v1/groups/invitations/{id}`, `/v1/group/exports*`, `POST /v1/group/import`, `/v1/groups/statistics*` | [`routes.go#L153-L178`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L153-L178) |
| **Notifiers, Actions, Reporting, WS** | `/v1/notifiers*`, `/v1/actions/*`, `GET /v1/reporting/bill-of-materials`, `GET /v1/ws/events` | [`routes.go#L134`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L134), [`L181-L186`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L181-L186), [`L259-L263`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L259-L263), [`L287`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L287) |

---

## 3. Authentication Mechanisms

In `openapi-3.json`, the only declared `securityScheme` is:
```json
"Bearer": {
  "description": "\"Type 'Bearer TOKEN' to correctly set the API Key\"",
  "type": "apiKey",
  "name": "Authorization",
  "in": "header"
}
```
([`openapi-3.json`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/static/docs/openapi-3.json))

Internally, `mwAuthToken` ([`backend/app/api/middleware.go#L186-L328`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/middleware.go#L186-L328)) validates **two types of stateful, database-backed opaque tokens** (not stateless JWTs):

### 3.1 Session Tokens (Local Login & Refresh)

- **Login endpoint:** `POST /api/v1/users/login` (accepts `application/json` or `application/x-www-form-urlencoded` with `username`, `password`, `stayLoggedIn`; optional `?provider=local`) ([`v1_ctrl_auth.go#L33-L144`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/handlers/v1/v1_ctrl_auth.go#L33-L144)).
- **Token format & storage:** `hasher.GenerateTokenCtx` generates 16 cryptographically random bytes encoded as unpadded Base32, hashes them with SHA-256 (`hasher.HashToken`), and stores the hash in the `auth_tokens` table with a default 7-day `expires_at` ([`backend/pkgs/hasher/token.go#L45-L70`](https://github.com/sysadminsmedia/homebox/blob/main/backend/pkgs/hasher/token.go#L45-L70), [`backend/internal/data/ent/schema/auth_tokens.go#L26-L33`](https://github.com/sysadminsmedia/homebox/blob/main/backend/internal/data/ent/schema/auth_tokens.go#L26-L33)).
- **Response & Cookies:** Returns JSON `{ "token": "Bearer <raw>", "expiresAt": "...", "attachmentToken": "..." }` and sets `hb.auth.token` (HttpOnly), `hb.auth.remember` (HttpOnly), `hb.auth.session`, and `hb.auth.attachment_token` cookies ([`v1_ctrl_auth.go#L27-L31`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/handlers/v1/v1_ctrl_auth.go#L27-L31), [`L137-L142`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/handlers/v1/v1_ctrl_auth.go#L137-L142), [`L442-L491`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/handlers/v1/v1_ctrl_auth.go#L442-L491)).
- **How to send:** `Authorization: Bearer <token>` header, `hb.auth.token` cookie, `Sec-WebSocket-Protocol` header, or `?access_token=<token>` (query parameter is restricted to attachment-scoped tokens or WebSocket routes with `mwAllowQuerySessionToken`) ([`middleware.go#L144-L278`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/middleware.go#L144-L278)).
- **Refresh & Logout:** `GET /api/v1/users/refresh` issues a renewed session token; `POST /api/v1/users/logout` and `POST /api/v1/users/logout/all` revoke session tokens ([`v1_ctrl_auth.go#L321-L436`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/handlers/v1/v1_ctrl_auth.go#L321-L436)).

### 3.2 Long-Lived Static API Keys

- **Management endpoints:**
  - `GET /api/v1/users/self/api-keys` — list API keys
  - `POST /api/v1/users/self/api-keys` — create API key (`name`, optional `expiresAt`)
  - `DELETE /api/v1/users/self/api-keys/{id}` — revoke/delete API key
  ([`routes.go#L148-L150`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L148-L150), [`v1_ctrl_api_keys.go#L13-L60`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/handlers/v1/v1_ctrl_api_keys.go#L13-L60))
- **Token format & storage:** `hasher.GenerateAPIKeyCtx` generates 32 random bytes (256-bit entropy) prefixed with `hb_` (`hb_<base64url(32 bytes)>`), hashed via HMAC-SHA256 with a server-side pepper (`hasher.HashAPIKey`), and stored in the `api_keys` table with optional `expires_at` and `last_used_at` ([`backend/pkgs/hasher/token.go#L17`](https://github.com/sysadminsmedia/homebox/blob/main/backend/pkgs/hasher/token.go#L17), [`L77-L113`](https://github.com/sysadminsmedia/homebox/blob/main/backend/pkgs/hasher/token.go#L77-L113), [`backend/internal/data/ent/schema/api_key.go#L26-L40`](https://github.com/sysadminsmedia/homebox/blob/main/backend/internal/data/ent/schema/api_key.go#L26-L40)).
- **Transport & Privileges:**
  - Accepted **only** via the `Authorization: Bearer <hb_...>` header (explicitly rejected in cookies and query parameters) ([`middleware.go#L281-L303`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/middleware.go#L281-L303)).
  - Grants the same access as the owning user (`user` role synthesized in `mwRoles`, [`middleware.go#L95-L103`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/middleware.go#L95-L103)); no fine-grained OAuth-style scopes exist.
  - Cannot be refreshed via `/v1/users/refresh` or revoked via `/v1/users/logout` (both return `400 Bad Request`) ([`v1_ctrl_auth.go#L335-L341`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/handlers/v1/v1_ctrl_auth.go#L335-L341), [`L414-L420`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/handlers/v1/v1_ctrl_auth.go#L414-L420)).

### 3.3 OIDC / SSO (Relying Party Only)

- **Role:** Homebox acts strictly as an **OIDC Relying Party (OAuth 2.0 Client)** using `github.com/coreos/go-oidc/v3/oidc` and `golang.org/x/oauth2` ([`backend/app/api/providers/oidc.go#L15-L31`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/providers/oidc.go#L15-L31)).
- **Endpoints (only mounted when `HBOX_OIDC_ENABLED=true`):**
  - `GET /api/v1/users/login/oidc` — initiates browser redirect to external IdP with `state`, `nonce`, and PKCE (`code_challenge_method=S256`) stored in HttpOnly cookies ([`routes.go#L112-L115`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L112-L115), [`oidc.go#L354-L453`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/providers/oidc.go#L354-L453)).
  - `GET /api/v1/users/login/oidc/callback` — exchanges the authorization code with `code_verifier`, verifies the ID token and optional group/email claims, logs the user in via `LoginOIDC`, sets Homebox session cookies (`hb.auth.token`, etc.), and redirects to `/home` ([`v1_ctrl_auth.go#L583-L619`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/handlers/v1/v1_ctrl_auth.go#L583-L619), [`oidc.go#L130-L259`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/providers/oidc.go#L130-L259)).
- **Configuration:** Configured via `HBOX_OIDC_ENABLED`, `HBOX_OIDC_ISSUER_URL`, `HBOX_OIDC_CLIENT_ID`, `HBOX_OIDC_CLIENT_SECRET`, `HBOX_OIDC_SCOPE`, `HBOX_OIDC_ALLOWED_GROUPS`, `HBOX_OIDC_AUTO_REDIRECT`, `HBOX_OIDC_VERIFY_EMAIL`, and `HBOX_OPTIONS_ALLOW_LOCAL_LOGIN` ([`docs/src/content/docs/en/quick-start/configure/oidc.mdx`](https://github.com/sysadminsmedia/homebox/blob/main/docs/src/content/docs/en/quick-start/configure/oidc.mdx), live docs at [`https://homebox.software`](https://homebox.software)).

---

## 4. Does Homebox Support OAuth 2.1?

**No.** Homebox does **not** implement OAuth 2.1 (neither as an OAuth 2.1 Authorization Server nor as an OAuth 2.1 Resource Server).

Specifically, for **MCP (Model Context Protocol) OAuth 2.1** requirements:

| OAuth 2.1 / MCP Capability | Supported by Homebox? | Evidence in Source |
| --- | --- | --- |
| **OAuth 2.1 Authorization Server** (`/authorize`, `/token`) | **No** | No authorization or token issuance endpoints exist in [`routes.go`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go). Homebox only acts as an OIDC *client* to an external IdP. |
| **Authorization Server Metadata** (RFC 8414 `/.well-known/oauth-authorization-server`) | **No** | Not mounted in [`routes.go`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go); `NotFound` falls through to the embedded SPA ([`routes.go#L300`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go#L300)). |
| **Protected Resource Metadata** (RFC 9728 `/.well-known/oauth-protected-resource`) | **No** | Not mounted in [`routes.go`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/routes.go). |
| **Dynamic Client Registration (DCR)** (RFC 7591) | **No** | No client registration endpoint or client registry exists. |
| **PKCE** (RFC 7636) | **Client-side only (OIDC)** | Homebox sends `code_challenge_method=S256` *as an OIDC client* to external IdPs ([`oidc.go#L354-L361`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/providers/oidc.go#L354-L361)), but does not accept or validate PKCE as an authorization server. |
| **External JWT / OAuth Access Token Validation** (Resource Server) | **No** | `mwAuthToken` ([`middleware.go#L186-L328`](https://github.com/sysadminsmedia/homebox/blob/main/backend/app/api/middleware.go#L186-L328)) only accepts Homebox-issued opaque session tokens (`auth_tokens` table) or Homebox-issued static API keys (`hb_...` in `api_keys` table). External IdP JWTs are rejected. |
| **OpenAPI Security Schemes** | **Bearer API Key only** | `openapi-3.json` declares only `Bearer` (`type: apiKey`, `in: header`, `name: Authorization`); no `oauth2` or `openIdConnect` schemes. |

### Practical Implication for `homebox-mcp`

- Because Homebox only accepts **its own stateful session tokens** (via `POST /api/v1/users/login`) or **long-lived static API keys** (`hb_...` via `POST /api/v1/users/self/api-keys`), `homebox-mcp` cannot delegate authentication directly to Homebox via OAuth 2.1.
- If `homebox-mcp` needs OAuth 2.1 for remote MCP clients, the MCP server itself (or an auth proxy in front of it) must implement the OAuth 2.1 / DCR / metadata endpoints and map authenticated MCP users to a Homebox API key (`Authorization: Bearer hb_...`) or Homebox session token.
