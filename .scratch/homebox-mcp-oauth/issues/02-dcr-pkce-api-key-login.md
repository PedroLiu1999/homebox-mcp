# 02: Dynamic Client Registration and OAuth 2.1 PKCE flow with API key login

**What to build:** End-to-end OAuth 2.1 registration and authorization flow where an MCP client registers dynamically via `POST /register`, redirects the user to `GET /authorize` with PKCE (`S256`), the user submits an existing `hb_...` Homebox API key that is verified against Homebox (`GET /api/v1/users/self`), encrypted with AES-256-GCM and persisted in SQLite, and the client exchanges the authorization code and `code_verifier` at `POST /token` for MCP access and refresh tokens.

**Blocked by:** 01: Project scaffold, HTTP server, and OAuth metadata discovery

**Status:** resolved

- [ ] `POST /register` (RFC 7591) validates redirect URIs, persists client metadata in SQLite, and returns a `client_id`
- [ ] `GET /authorize` validates `client_id`, `redirect_uri`, `response_type=code`, `code_challenge`, and `code_challenge_method=S256`, rendering a CSRF-protected login/consent HTML form
- [ ] Submitting a valid `hb_...` API key verifies it against Homebox `GET /api/v1/users/self`, encrypts the key at rest using `TOKEN_ENCRYPTION_KEY`, stores a short-lived single-use authorization code, and redirects back to `redirect_uri` with `code` and `state`
- [ ] Submitting an invalid `hb_...` key re-renders the form with an error message without issuing a code
- [ ] `POST /token` (`grant_type=authorization_code`) verifies PKCE `code_verifier`, rejects replayed/expired codes or mismatched `redirect_uri`/`client_id`, and returns MCP access and refresh tokens
- [ ] Integration tests verify the full DCR -> `/authorize` -> `/token` flow and verify the stored Homebox API key is encrypted (not plaintext) in SQLite
