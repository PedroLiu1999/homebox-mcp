export interface AppConfig {
  port: number;
  mcpPublicUrl: string;
  homeboxUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(env.PORT ?? "3000", 10);
  const mcpPublicUrl = env.MCP_PUBLIC_URL ?? `http://localhost:${port}`;
  const homeboxUrl = env.HOMEBOX_URL ?? "http://localhost:7745";

  return {
    port,
    mcpPublicUrl,
    homeboxUrl,
  };
}
