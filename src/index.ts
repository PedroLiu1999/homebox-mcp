import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, () => {
  console.log(
    `Homebox MCP server listening on port ${config.port} (public URL: ${config.mcpPublicUrl})`,
  );
});
