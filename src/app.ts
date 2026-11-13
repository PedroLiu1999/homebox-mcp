import path from "node:path";
import { fileURLToPath } from "node:url";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
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

const DEFAULT_PRUNE_INTERVAL_MS = 15 * 60 * 1000;
const LOGO_ASSETS_DIR = fileURLToPath(
  new URL("../assets/logo", import.meta.url),
);

const BRAND_ASSET_ROUTES: ReadonlyArray<{
  route: string;
  relativePath: string;
  contentType: string;
}> = [
  {
    route: "/favicon.ico",
    relativePath: "variants/favicon.ico",
    contentType: "image/x-icon",
  },
  {
    route: "/favicon.svg",
    relativePath: "variants/favicon.svg",
    contentType: "image/svg+xml",
  },
  {
    route: "/apple-touch-icon.png",
    relativePath: "variants/apple-touch-icon.png",
    contentType: "image/png",
  },
  {
    route: "/icon-192.png",
    relativePath: "variants/icon-192.png",
    contentType: "image/png",
  },
  {
    route: "/icon-512.png",
    relativePath: "variants/icon-512.png",
    contentType: "image/png",
  },
  {
    route: "/maskable-512.png",
    relativePath: "variants/maskable-512.png",
    contentType: "image/png",
  },
  {
    route: "/site.webmanifest",
    relativePath: "variants/site.webmanifest",
    contentType: "application/manifest+json",
  },
  {
    route: "/logo.svg",
    relativePath: "homebox-mcp-symbol.svg",
    contentType: "image/svg+xml",
  },
  {
    route: "/logo.png",
    relativePath: "png/homebox-mcp-symbol.png",
    contentType: "image/png",
  },
];

export interface AppRuntime {
  app: Express;
  store: SqliteStore;
  close: () => void;
}

export interface CreateAppOptions {
  pruneIntervalMs?: number;
}

export function createAppRuntime(
  config: AppConfig,
  options: CreateAppOptions = {},
): AppRuntime {
  const app = express();
  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");
  app.use(
    helmet({
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          // OAuth login forms 302-redirect to external client redirect_uris; form-action 'self' blocks those redirects in Chromium.
          formAction: null,
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
    }),
  );

  const issuerUrl = new URL(config.mcpPublicUrl);
  const expectedHost = issuerUrl.host.toLowerCase();
  const expectedOrigin = issuerUrl.origin.toLowerCase();
  const loopbackHostPattern = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;

  app.use((req, res, next) => {
    const host = req.headers.host?.toLowerCase();
    const isLoopbackHealthCheck =
      req.path === "/health" && host !== undefined && loopbackHostPattern.test(host);
    if (!host || (host !== expectedHost && !isLoopbackHealthCheck)) {
      res.status(403).json({ error: "Forbidden: invalid Host header" });
      return;
    }

    const origin = req.headers.origin;
    const secFetchSite = req.headers["sec-fetch-site"];
    const isSameOriginNull =
      origin?.toLowerCase() === "null" &&
      typeof secFetchSite === "string" &&
      secFetchSite.toLowerCase() === "same-origin";
    if (
      origin !== undefined &&
      origin.toLowerCase() !== expectedOrigin &&
      !isSameOriginNull
    ) {
      res.status(403).json({ error: "Forbidden: invalid Origin header" });
      return;
    }

    next();
  });

  app.use(express.json({ limit: "100kb" }));

  const store = new SqliteStore(config.databasePath);
  const encryptionKey = parseEncryptionKey(config.tokenEncryptionKey);
  const provider = new HomeboxOAuthProvider({
    store,
    homeboxUrl: config.homeboxUrl,
    encryptionKey,
    isHttps: issuerUrl.protocol === "https:",
  });
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(issuerUrl);

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/", (_req, res) => {
    res.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Homebox MCP Server</title>
  <link rel="icon" href="/favicon.ico" sizes="48x48" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <meta name="theme-color" content="#1E2A23" />
  <meta property="og:title" content="Homebox MCP Server" />
  <meta property="og:image" content="${issuerUrl.origin}/logo.png" />
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:460px;margin:48px auto;padding:0 16px;color:#111827;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
    <img src="/logo.svg" alt="Homebox MCP" width="40" height="40" />
    <span style="font-weight:700;font-size:1.25rem;color:#111827;">Homebox <span style="font-weight:400;color:#567f67;">MCP</span></span>
  </div>
  <p style="color:#4b5563;margin:0;">Homebox Model Context Protocol server with embedded OAuth 2.1. Connect an MCP client to <code>/mcp</code>.</p>
</body>
</html>`);
  });

  for (const asset of BRAND_ASSET_ROUTES) {
    const filePath = path.join(LOGO_ASSETS_DIR, asset.relativePath);
    app.get(asset.route, (_req, res, next) => {
      res.type(asset.contentType);
      res.set("Cache-Control", "public, max-age=86400");
      res.set("Cross-Origin-Resource-Policy", "cross-origin");
      res.set("Access-Control-Allow-Origin", "*");
      res.sendFile(filePath, (err) => {
        if (err) {
          next(err);
        }
      });
    });
  }

  const createIpRateLimiter = (windowMs: number, limit: number) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    });

  const loginLimiter = createIpRateLimiter(15 * 60 * 1000, 10);
  const registerLimiter = createIpRateLimiter(60 * 60 * 1000, 10);
  const tokenLimiter = createIpRateLimiter(15 * 60 * 1000, 30);
  const mcpLimiter = createIpRateLimiter(60 * 1000, 120);

  app.post(
    "/authorize/login",
    loginLimiter,
    express.urlencoded({ extended: false, limit: "16kb" }),
    (req, res, next) => {
      void provider.handleAuthorizeLogin(req, res).catch(next);
    },
  );

  app.use("/register", registerLimiter);
  app.use("/token", tokenLimiter);

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl,
      resourceServerUrl: issuerUrl,
      resourceName: "Homebox MCP Server",
      clientRegistrationOptions: { rateLimit: false },
      tokenOptions: { rateLimit: false },
    }),
  );

  const bearerAuth = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl,
  });

  app.all("/mcp", mcpLimiter, bearerAuth, async (req, res, next) => {
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
      publicUrl: issuerUrl.origin,
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
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      void transport.close();
      void server.close();
      if (!res.headersSent) {
        next(err);
        return;
      }
      console.error("Unhandled error after /mcp headers sent:", err);
      res.end();
    }
  });

  app.use(
    (
      err: unknown,
      _req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (res.headersSent) {
        next(err);
        return;
      }

      const status =
        typeof err === "object" &&
        err !== null &&
        "status" in err &&
        typeof err.status === "number" &&
        err.status >= 400 &&
        err.status < 500
          ? err.status
          : 500;

      if (status === 413) {
        res.status(413).json({ error: "payload_too_large" });
        return;
      }

      if (status >= 400 && status < 500) {
        res.status(status).json({ error: "bad_request" });
        return;
      }

      console.error("Unhandled Express error:", err);
      res.status(500).json({ error: "internal_server_error" });
    },
  );

  const pruneIntervalMs = options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
  const pruneTimer = setInterval(() => {
    store.pruneExpired();
  }, pruneIntervalMs);
  pruneTimer.unref();

  let closed = false;
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(pruneTimer);
    store.close();
  };

  return { app, store, close };
}

export function createApp(config: AppConfig): Express {
  return createAppRuntime(config).app;
}
