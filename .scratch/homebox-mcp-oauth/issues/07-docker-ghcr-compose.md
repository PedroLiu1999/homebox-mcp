# 07: Multi-stage Dockerfile, GitHub Actions GHCR build, and Docker Compose deployment

**What to build:** Production multi-stage `Dockerfile`, a GitHub Actions workflow that runs typecheck/tests and publishes container images to GitHub Container Registry (`ghcr.io`), and a `docker-compose.yml` + `.env.example` + README instructions for local Docker deployment pulling from GHCR with persistent SQLite volume storage.

**Blocked by:** 04: Token refresh, revocation, and authenticated MCP tool bridge

**Status:** ready-for-agent

- [ ] Multi-stage `Dockerfile` builds the TypeScript server and runs it as a non-root user in a slim Node.js runtime image with a `/health` healthcheck
- [ ] GitHub Actions workflow runs typecheck and tests on pull requests and pushes, and builds/pushes `linux/amd64` and `linux/arm64` images to `ghcr.io` on pushes to `main` and version tags
- [ ] `docker-compose.yml` pulls the `ghcr.io` image, mounts a persistent volume for the SQLite database, and configures `HOMEBOX_URL`, `MCP_PUBLIC_URL`, `TOKEN_ENCRYPTION_KEY`, and `PORT` via environment variables
- [ ] `.env.example` and README document required environment variables, generating `TOKEN_ENCRYPTION_KEY`, and connecting an OAuth 2.1 MCP client
