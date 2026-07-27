export interface ServerConfig {
  host: string;
  port: number;
  modelRuntime: string;
  modelCommand: string;
  modelProvider: string;
  modelName: string;
  modelReasoningEffort: string;
  modelAuthMode: string;
  maxAttempts: number;
  maxToolCalls: number;
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
    modelRuntime: environment.MODEL_RUNTIME ?? "codex-app-server",
    modelCommand: environment.MODEL_COMMAND ?? "codex",
    modelProvider: environment.MODEL_PROVIDER ?? "OpenAI",
    modelName: environment.MODEL_NAME ?? "gpt-5.3-codex-spark",
    modelReasoningEffort:
      environment.MODEL_REASONING_EFFORT ?? "xhigh",
    modelAuthMode: environment.MODEL_AUTH_MODE ?? "chatgpt",
    maxAttempts: positiveInteger(environment.RUN_MAX_ATTEMPTS, 3),
    maxToolCalls: positiveInteger(environment.RUN_MAX_TOOL_CALLS, 80),
    maxRejectedTools: positiveInteger(environment.RUN_MAX_REJECTED_TOOLS, 3),
  };
}
