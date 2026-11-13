export interface AppConfig {
  port: number;
  mcpPublicUrl: string;
  homeboxUrl: string;
  databasePath: string;
  tokenEncryptionKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(env.PORT ?? "3000", 10);
  const mcpPublicUrl = env.MCP_PUBLIC_URL ?? `http://localhost:${port}`;
  const homeboxUrl = env.HOMEBOX_URL ?? "http://localhost:7745";
  const databasePath = env.DATABASE_PATH ?? "./data/homebox-mcp.db";
  const tokenEncryptionKey = env.TOKEN_ENCRYPTION_KEY;

  if (!tokenEncryptionKey) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY environment variable is required (64-char hex or 32-byte base64)",
    );
  }

  return {
    port,
    mcpPublicUrl,
    homeboxUrl,
    databasePath,
    tokenEncryptionKey,
  };
}
