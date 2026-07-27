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
  ollamaHost: "http://127.0.0.1:11434",
  ollamaModel: "gemma4:26b-mlx",
  ollamaContext: 32_768,
  maxAttempts: 3,
  maxTurns: 10,
  maxRejectedTools: 3,
};

class IdleModel implements ModelClient {
  async *streamChat(): AsyncIterable<ModelMessage> {
    throw new Error("Not used.");
  }

  async completeChat(): Promise<ModelMessage> {
    throw new Error("Not used.");
  }

  async health(): Promise<ModelHealth> {
    return {
      connected: true,
      version: "test",
      installedModels: [config.ollamaModel],
    };
  }
}

describe("model service HTTP policy", () => {
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
