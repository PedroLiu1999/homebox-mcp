import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createAppRuntime } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";

export type HomeboxMockHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;

export interface TestHarness {
  baseUrl: string;
  homeboxUrl: string;
  databasePath: string;
  setHomeboxHandler: (handler: HomeboxMockHandler) => void;
  close: () => Promise<void>;
}

const DEFAULT_TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export async function startTestServer(
  overrides: Partial<AppConfig> = {},
): Promise<TestHarness> {
  let homeboxHandler: HomeboxMockHandler = (_req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not mocked" }));
  };

  // Stub Homebox upstream HTTP server
  const homeboxServer = createServer((req, res) => {
    void Promise.resolve(homeboxHandler(req, res)).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: String(err) }));
    });
  });

  await new Promise<void>((resolve) => {
    homeboxServer.listen(0, "127.0.0.1", () => resolve());
  });
  const homeboxPort = (homeboxServer.address() as AddressInfo).port;
  const homeboxUrl = `http://127.0.0.1:${homeboxPort}`;

  // Reserve an ephemeral port for the MCP server so MCP_PUBLIC_URL matches the bound address
  const mcpServer: Server = createServer();
  await new Promise<void>((resolve) => {
    mcpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const mcpPort = (mcpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${mcpPort}`;

  const tempDir = mkdtempSync(join(tmpdir(), "homebox-mcp-test-"));
  const databasePath = overrides.databasePath ?? join(tempDir, "test.db");

  const config: AppConfig = {
    port: mcpPort,
    mcpPublicUrl: baseUrl,
    homeboxUrl,
    databasePath,
    tokenEncryptionKey: DEFAULT_TEST_ENCRYPTION_KEY,
    trustProxy: 1,
    ...overrides,
  };

  const runtime = createAppRuntime(config);
  mcpServer.on("request", runtime.app);

  return {
    baseUrl,
    homeboxUrl,
    databasePath,
    setHomeboxHandler: (handler: HomeboxMockHandler) => {
      homeboxHandler = handler;
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        mcpServer.close((err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        homeboxServer.close((err) => (err ? reject(err) : resolve()));
      });
      runtime.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
