import express, { type Express } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { AppConfig } from "./config.js";
import { parseEncryptionKey } from "./crypto.js";
import { HomeboxOAuthProvider } from "./oauth/provider.js";
import { SqliteStore } from "./storage/sqlite.js";

export function createApp(config: AppConfig): Express {
  const app = express();
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
    const server = new McpServer({
      name: "homebox-mcp",
      version: "0.1.0",
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
