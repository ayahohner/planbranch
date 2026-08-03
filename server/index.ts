import { buildApp } from "./app";
import { loadServerConfig } from "./config";
import { CodexAppServerClient } from "./model";

const config = loadServerConfig();
if (config.modelRuntime !== "codex-app-server") {
  throw new Error(
    `Unsupported MODEL_RUNTIME "${config.modelRuntime}". This build supports codex-app-server.`,
  );
}
const app = await buildApp({
  config,
  model: new CodexAppServerClient(config.modelCommand),
});

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(
    `Planbranch model service listening on http://${config.host}:${config.port}`,
  );
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
