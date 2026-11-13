import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type TrustProxySetting } from "../src/config.js";

const VALID_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("loadConfig", () => {
  it("defaults trustProxy to 1 when TRUST_PROXY is unset", () => {
    const config = loadConfig({
      TOKEN_ENCRYPTION_KEY: VALID_KEY,
    });

    expect(config.trustProxy).toBe(1);
  });

  it("parses TRUST_PROXY boolean, numeric hop count, and string values", () => {
    expect(
      loadConfig({ TOKEN_ENCRYPTION_KEY: VALID_KEY, TRUST_PROXY: "true" })
        .trustProxy,
    ).toBe(true);
    expect(
      loadConfig({ TOKEN_ENCRYPTION_KEY: VALID_KEY, TRUST_PROXY: "false" })
        .trustProxy,
    ).toBe(false);
    expect(
      loadConfig({ TOKEN_ENCRYPTION_KEY: VALID_KEY, TRUST_PROXY: "0" })
        .trustProxy,
    ).toBe(0);
    expect(
      loadConfig({ TOKEN_ENCRYPTION_KEY: VALID_KEY, TRUST_PROXY: "2" })
        .trustProxy,
    ).toBe(2);
    expect(
      loadConfig({ TOKEN_ENCRYPTION_KEY: VALID_KEY, TRUST_PROXY: "loopback" })
        .trustProxy,
    ).toBe("loopback");
    expect(
      loadConfig({ TOKEN_ENCRYPTION_KEY: VALID_KEY, TRUST_PROXY: "127.0.0.1" })
        .trustProxy,
    ).toBe("127.0.0.1");
    expect(
      loadConfig({ TOKEN_ENCRYPTION_KEY: VALID_KEY, TRUST_PROXY: "  " })
        .trustProxy,
    ).toBe(1);
  });

  it("throws when NODE_ENV=production and MCP_PUBLIC_URL does not use https://", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        TOKEN_ENCRYPTION_KEY: VALID_KEY,
        MCP_PUBLIC_URL: "http://mcp.example.com",
      }),
    ).toThrow(/https:\/\//i);

    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        TOKEN_ENCRYPTION_KEY: VALID_KEY,
      }),
    ).toThrow(/https:\/\//i);
  });

  it("allows https:// in production and http://localhost or http://127.0.0.1 in non-production", () => {
    const prodConfig = loadConfig({
      NODE_ENV: "production",
      TOKEN_ENCRYPTION_KEY: VALID_KEY,
      MCP_PUBLIC_URL: "https://mcp.example.com",
    });
    expect(prodConfig.mcpPublicUrl).toBe("https://mcp.example.com");

    const devConfig = loadConfig({
      NODE_ENV: "development",
      TOKEN_ENCRYPTION_KEY: VALID_KEY,
      MCP_PUBLIC_URL: "http://localhost:3000",
    });
    expect(devConfig.mcpPublicUrl).toBe("http://localhost:3000");

    const testConfig = loadConfig({
      NODE_ENV: "test",
      TOKEN_ENCRYPTION_KEY: VALID_KEY,
      MCP_PUBLIC_URL: "http://127.0.0.1:3000",
    });
    expect(testConfig.mcpPublicUrl).toBe("http://127.0.0.1:3000");
  });
});

describe("Express trust proxy wiring", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      if (cleanup) {
        await cleanup();
      }
    }
  });

  async function startProbeServer(trustProxy: TrustProxySetting) {
    const tempDir = mkdtempSync(join(tmpdir(), "homebox-mcp-proxy-test-"));
    const app = createApp({
      port: 0,
      mcpPublicUrl: "http://127.0.0.1:3000",
      homeboxUrl: "http://127.0.0.1:7745",
      databasePath: join(tempDir, "test.db"),
      tokenEncryptionKey: VALID_KEY,
      trustProxy,
    });

    app.get("/__test-ip", (req, res) => {
      res.json({
        ip: req.ip,
        ips: req.ips,
        protocol: req.protocol,
      });
    });

    const server: Server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server.address() as AddressInfo;

    cleanups.push(async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      rmSync(tempDir, { recursive: true, force: true });
    });

    return { app, baseUrl: `http://127.0.0.1:${port}` };
  }

  it("resolves req.ip and req.protocol from X-Forwarded-For when trustProxy is 1", async () => {
    const { app, baseUrl } = await startProbeServer(1);
    expect(app.get("trust proxy")).toBe(1);

    const res = await fetch(`${baseUrl}/__test-ip`, {
      headers: {
        "x-forwarded-for": "198.51.100.10, 203.0.113.195",
        "x-forwarded-proto": "https",
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ip: string;
      ips: string[];
      protocol: string;
    };
    expect(body.ip).toBe("203.0.113.195");
    expect(body.ips).toEqual(["203.0.113.195"]);
    expect(body.protocol).toBe("https");
  });

  it("ignores X-Forwarded-For when trustProxy is false", async () => {
    const { app, baseUrl } = await startProbeServer(false);
    expect(app.get("trust proxy")).toBe(false);

    const res = await fetch(`${baseUrl}/__test-ip`, {
      headers: {
        "x-forwarded-for": "203.0.113.195",
        "x-forwarded-proto": "https",
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ip: string;
      ips: string[];
      protocol: string;
    };
    expect(body.ip).toBe("127.0.0.1");
    expect(body.ips).toEqual([]);
    expect(body.protocol).toBe("http");
  });
});
