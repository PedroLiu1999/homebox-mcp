import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestHarness } from "./helpers/test-server.js";

function sendRawHttpRequest(
  baseUrl: string,
  options: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: string }> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: options.path,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("DNS-rebinding protection (Host and Origin validation)", () => {
  let harness: TestHarness | undefined;

  afterEach(async () => {
    if (harness) {
      await harness.close();
      harness = undefined;
    }
  });

  it("rejects requests whose Host header does not match MCP_PUBLIC_URL with 403 and allows case-insensitive match", async () => {
    harness = await startTestServer({
      mcpPublicUrl: "https://mcp.example.com",
    });

    const rejected = await sendRawHttpRequest(harness.baseUrl, {
      path: "/.well-known/oauth-protected-resource",
      headers: { host: "evil.example.com" },
    });
    expect(rejected.status).toBe(403);

    const allowed = await sendRawHttpRequest(harness.baseUrl, {
      path: "/.well-known/oauth-protected-resource",
      headers: { host: "MCP.EXAMPLE.COM" },
    });
    expect(allowed.status).toBe(200);
  });

  it("allows 127.0.0.1 and localhost (any port) on /health but rejects them on other routes", async () => {
    harness = await startTestServer({
      mcpPublicUrl: "https://mcp.example.com",
    });

    for (const loopbackHost of [
      "127.0.0.1",
      "127.0.0.1:3000",
      "localhost",
      "localhost:8080",
      "LOCALHOST:3000",
    ]) {
      const healthRes = await sendRawHttpRequest(harness.baseUrl, {
        path: "/health",
        headers: { host: loopbackHost },
      });
      expect(healthRes.status).toBe(200);

      const otherRes = await sendRawHttpRequest(harness.baseUrl, {
        path: "/.well-known/oauth-protected-resource",
        headers: { host: loopbackHost },
      });
      expect(otherRes.status).toBe(403);
    }

    const evilHealthRes = await sendRawHttpRequest(harness.baseUrl, {
      path: "/health",
      headers: { host: "evil.example.com" },
    });
    expect(evilHealthRes.status).toBe(403);
  });

  it("rejects mismatched Origin header with 403, allows matching Origin, and allows omitted Origin", async () => {
    harness = await startTestServer({
      mcpPublicUrl: "https://mcp.example.com",
    });

    const mismatchedOrigin = await sendRawHttpRequest(harness.baseUrl, {
      path: "/mcp",
      method: "POST",
      headers: {
        host: "mcp.example.com",
        origin: "https://evil.example.com",
      },
    });
    expect(mismatchedOrigin.status).toBe(403);

    const nullOrigin = await sendRawHttpRequest(harness.baseUrl, {
      path: "/mcp",
      method: "POST",
      headers: {
        host: "mcp.example.com",
        origin: "null",
      },
    });
    expect(nullOrigin.status).toBe(403);

    const matchingOrigin = await sendRawHttpRequest(harness.baseUrl, {
      path: "/mcp",
      method: "POST",
      headers: {
        host: "mcp.example.com",
        origin: "https://mcp.example.com",
      },
    });
    expect(matchingOrigin.status).toBe(401);

    const omittedOrigin = await sendRawHttpRequest(harness.baseUrl, {
      path: "/mcp",
      method: "POST",
      headers: {
        host: "mcp.example.com",
      },
    });
    expect(omittedOrigin.status).toBe(401);
  });
});
