import express, { type Express } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { AppConfig } from "./config.js";
import { parseEncryptionKey } from "./crypto.js";
import { HomeboxClient } from "./homebox/client.js";
import { createHomeboxMcpServer } from "./mcp/server.js";
import { HomeboxOAuthProvider } from "./oauth/provider.js";
import { SqliteStore } from "./storage/sqlite.js";

export function createApp(config: AppConfig): Express {
  const app = express();
  app.set("trust proxy", config.trustProxy);
  app.use(express.json());

  const issuerUrl = new URL(config.mcpPublicUrl);
  const store = new SqliteStore(config.databasePath);
  const encryptionKey = parseEncryptionKey(config.tokenEncryptionKey);
  const provider = new HomeboxOAuthProvider({
    store,
    homeboxUrl: config.homeboxUrl,
    encryptionKey,
  });
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(issuerUrl);

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post(
    "/authorize/login",
    express.urlencoded({ extended: false }),
    (req, res, next) => {
      void provider.handleAuthorizeLogin(req, res).catch(next);
    },
  );

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl,
      resourceServerUrl: issuerUrl,
      resourceName: "Homebox MCP Server",
    }),
  );

  const bearerAuth = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl,
  });

  app.all("/mcp", bearerAuth, async (req, res) => {
    const extra = req.auth?.extra as
      | { homeboxApiKey?: string; grantId?: string }
      | undefined;
    const homeboxApiKey = extra?.homeboxApiKey;
    const grantId = extra?.grantId;
    if (!homeboxApiKey) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }

    const homeboxClient = new HomeboxClient(config.homeboxUrl, homeboxApiKey);
    const server = createHomeboxMcpServer({
      homeboxClient,
      onUnauthorized: grantId
        ? () => store.revokeGrant(grantId, Math.floor(Date.now() / 1000))
        : undefined,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return app;
}
