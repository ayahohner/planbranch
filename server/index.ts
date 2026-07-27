import { buildApp } from "./app";
import { loadServerConfig } from "./config";
import { OllamaModelClient } from "./model";

const config = loadServerConfig();
const app = await buildApp({
  config,
  model: new OllamaModelClient(config.ollamaHost),
});

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(
    `Task Tree model service listening on http://${config.host}:${config.port}`,
  );
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
