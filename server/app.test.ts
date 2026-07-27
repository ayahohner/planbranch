import { describe, expect, it } from "vitest";
import type { ServerConfig } from "./config";
import { buildApp } from "./app";
import type { RunManager } from "./run-manager";
import type {
  ModelClient,
  ModelHealth,
  ModelMessage,
} from "./model";

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 8787,
  modelRuntime: "codex-app-server",
  modelCommand: "codex",
  modelProvider: "OpenAI",
  modelName: "gpt-5.3-codex-spark",
  modelReasoningEffort: "xhigh",
  modelAuthMode: "chatgpt",
  maxAttempts: 3,
  maxToolCalls: 10,
  maxRejectedTools: 3,
};

class IdleModel implements ModelClient {
  async runChat(): Promise<ModelMessage> {
    throw new Error("Not used.");
  }

  async completeChat(): Promise<ModelMessage> {
    throw new Error("Not used.");
  }

  async health(): Promise<ModelHealth> {
    return {
      connected: true,
      authenticated: true,
      authenticationMode: "chatgpt",
      runtime: "Fake",
      provider: "Test",
      version: "test",
      availableModels: [config.modelName],
    };
  }
}

describe("model service HTTP policy", () => {
  it("reports provider-neutral runtime and model health", async () => {
    const app = await buildApp({ config, model: new IdleModel() });
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      runtime: {
        id: "codex-app-server",
        name: "Fake",
        connected: true,
        version: "test",
      },
      provider: {
        name: "Test",
        authenticated: true,
        authenticationMode: "chatgpt",
        requiredAuthenticationMode: "chatgpt",
      },
      model: {
        name: "gpt-5.3-codex-spark",
        available: true,
        reasoningEffort: "xhigh",
      },
    });
    await app.close();
  });

  it("allows browser DELETE requests used to cancel Runs", async () => {
    const app = await buildApp({ config, model: new IdleModel() });
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/runs/example",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "DELETE",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain(
      "DELETE",
    );
    await app.close();
  });

  it("acknowledges cancellation before scheduling the model abort", async () => {
    let cancelled = false;
    const runManager = {
      get: () => ({
        id: "example",
        state: "running",
        events: [],
      }),
      cancel: () => {
        cancelled = true;
        return true;
      },
    } as unknown as RunManager;
    const app = await buildApp({
      config,
      model: new IdleModel(),
      runManager,
    });
    const response = await app.inject({
      method: "DELETE",
      url: "/api/runs/example",
      headers: { origin: "http://localhost:3000" },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ cancelled: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toBe(true);
    await app.close();
  });
});
