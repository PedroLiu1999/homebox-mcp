import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";

export interface TestHarness {
  baseUrl: string;
  homeboxUrl: string;
  close: () => Promise<void>;
}

export async function startTestServer(
  overrides: Partial<AppConfig> = {},
): Promise<TestHarness> {
  // Stub Homebox upstream HTTP server
  const homeboxServer = createServer((_req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not mocked" }));
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

  const config: AppConfig = {
    port: mcpPort,
    mcpPublicUrl: baseUrl,
    homeboxUrl,
    ...overrides,
  };

  const app = createApp(config);
  mcpServer.on("request", app);

  return {
    baseUrl,
    homeboxUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        mcpServer.close((err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        homeboxServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
