export interface ServerConfig {
  host: string;
  port: number;
  ollamaHost: string;
  ollamaModel: string;
  ollamaContext: number;
  maxAttempts: number;
  maxTurns: number;
  maxRejectedTools: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  return {
    host: environment.SERVER_HOST ?? "127.0.0.1",
    port: positiveInteger(environment.SERVER_PORT, 8787),
    ollamaHost: environment.OLLAMA_HOST ?? "http://127.0.0.1:11434",
    ollamaModel: environment.OLLAMA_MODEL ?? "gemma4:26b-mlx",
    ollamaContext: positiveInteger(environment.OLLAMA_NUM_CTX, 32_768),
    maxAttempts: positiveInteger(environment.RUN_MAX_ATTEMPTS, 3),
    maxTurns: positiveInteger(environment.RUN_MAX_TURNS, 80),
    maxRejectedTools: positiveInteger(environment.RUN_MAX_REJECTED_TOOLS, 3),
  };
}
