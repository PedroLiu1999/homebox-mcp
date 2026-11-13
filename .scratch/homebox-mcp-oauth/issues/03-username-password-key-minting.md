# 03: Homebox username/password login with automatic API key minting

**What to build:** Support signing in on the `GET /authorize` form using Homebox username and password credentials; the server authenticates against Homebox (`POST /api/v1/users/login`), immediately mints a dedicated `hb_...` API key (`POST /api/v1/users/self/api-keys`) named after the MCP client, discards the password and temporary session token, and encrypts/stores the minted key.

**Blocked by:** 02: Dynamic Client Registration and OAuth 2.1 PKCE flow with API key login

**Status:** ready-for-agent

- [ ] The `GET /authorize` login form accepts either a Homebox username/password pair or a direct `hb_...` API key
- [ ] Submitting username/password calls Homebox `POST /api/v1/users/login` and then `POST /api/v1/users/self/api-keys` using the temporary session token
- [ ] Plaintext passwords and temporary session tokens are never persisted to SQLite or logged
- [ ] Invalid Homebox credentials (`401`) surface a clear error on the login form without issuing an authorization code
- [ ] Integration tests verify the full authorization flow using username/password against the stubbed Homebox login and API-key creation endpoints
