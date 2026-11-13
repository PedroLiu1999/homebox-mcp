export type TrustProxySetting = boolean | number | string;

export interface AppConfig {
  port: number;
  mcpPublicUrl: string;
  homeboxUrl: string;
  databasePath: string;
  tokenEncryptionKey: string;
  trustProxy: TrustProxySetting;
}

function parseTrustProxy(value: string | undefined): TrustProxySetting {
  if (value === undefined) {
    return 1;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return 1;
  }

  const lower = trimmed.toLowerCase();
  if (lower === "true") {
    return true;
  }
  if (lower === "false") {
    return false;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  return trimmed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(env.PORT ?? "3000", 10);
  const mcpPublicUrl = env.MCP_PUBLIC_URL ?? `http://localhost:${port}`;
  const homeboxUrl = env.HOMEBOX_URL ?? "http://localhost:7745";
  const databasePath = env.DATABASE_PATH ?? "./data/homebox-mcp.db";
  const tokenEncryptionKey = env.TOKEN_ENCRYPTION_KEY;
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);

  if (!tokenEncryptionKey) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY environment variable is required (64-char hex or 32-byte base64)",
    );
  }

  if (env.NODE_ENV === "production" && !mcpPublicUrl.startsWith("https://")) {
    throw new Error(
      "MCP_PUBLIC_URL must start with https:// when NODE_ENV=production",
    );
  }

  return {
    port,
    mcpPublicUrl,
    homeboxUrl,
    databasePath,
    tokenEncryptionKey,
    trustProxy,
  };
}
