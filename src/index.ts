import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { createAppRuntime } from "./app.js";
import { loadConfig, type AppConfig } from "./config.js";
import type { SqliteStore } from "./storage/sqlite.js";

export interface ServerRuntime {
  server: Server;
  store: SqliteStore;
  shutdown: () => Promise<void>;
}

export function startServer(config: AppConfig): ServerRuntime {
  const { app, store, close } = createAppRuntime(config);
  const server = app.listen(config.port, () => {
    console.log(
      `Homebox MCP server listening on port ${config.port} (public URL: ${config.mcpPublicUrl})`,
    );
  });

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);

    shutdownPromise = new Promise<void>((resolve, reject) => {
      server.closeIdleConnections?.();
      server.close((err) => {
        close();
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
    return shutdownPromise;
  };

  const handleSignal = (signal: NodeJS.Signals): void => {
    void shutdown().catch((err: unknown) => {
      console.error(`Error during ${signal} shutdown:`, err);
      process.exitCode = 1;
    });
  };
  const onSigterm = (): void => handleSignal("SIGTERM");
  const onSigint = (): void => handleSignal("SIGINT");

  process.on("SIGTERM", onSigterm);
  process.on("SIGINT", onSigint);

  return { server, store, shutdown };
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  startServer(loadConfig());
}
