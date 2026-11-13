import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createAppRuntime } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { startServer } from "../src/index.js";

const TEST_CONFIG: AppConfig = {
  port: 0,
  mcpPublicUrl: "http://127.0.0.1:3000",
  homeboxUrl: "http://127.0.0.1:7745",
  databasePath: ":memory:",
  tokenEncryptionKey:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};

describe("Server lifecycle and pruning", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        await fn();
      }
    }
  });

  it("periodically prunes expired records and closes store on runtime.close()", async () => {
    const runtime = createAppRuntime(TEST_CONFIG, { pruneIntervalMs: 20 });
    cleanups.push(() => runtime.close());

    const expiredAt = Math.floor(Date.now() / 1000) - 10;
    runtime.store.savePendingAuthRequest({
      requestId: "req-to-prune",
      csrfToken: "csrf",
      clientId: "client-1",
      redirectUri: "http://localhost/cb",
      codeChallenge: "challenge",
      state: null,
      scopes: ["homebox"],
      resource: null,
      expiresAt: expiredAt,
    });

    expect(runtime.store.getPendingAuthRequest("req-to-prune")).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(runtime.store.getPendingAuthRequest("req-to-prune")).toBeUndefined();

    runtime.close();
    expect(() => runtime.store.getClient("any")).toThrow();
  });

  it.each(["SIGTERM", "SIGINT"] as const)(
    "shuts down HTTP server, prune timer, and SQLite store cleanly on %s",
    async (signal) => {
      const runtime = startServer(TEST_CONFIG);
      cleanups.push(() => runtime.shutdown());

      await new Promise<void>((resolve) => {
        if (runtime.server.listening) {
          resolve();
          return;
        }
        runtime.server.once("listening", () => resolve());
      });

      const { port } = runtime.server.address() as AddressInfo;
      const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
      expect(healthRes.status).toBe(200);

      process.emit(signal);

      await new Promise<void>((resolve) => {
        if (!runtime.server.listening) {
          resolve();
          return;
        }
        runtime.server.once("close", () => resolve());
      });

      expect(runtime.server.listening).toBe(false);
      await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
      expect(() => runtime.store.getClient("any")).toThrow();
    },
  );
});
