import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config";

describe("server configuration defaults", () => {
  it("uses the balanced model tier and bounded decomposition limits", () => {
    const config = loadServerConfig({});

    expect(config.modelName).toBe("gpt-5.6-terra");
    expect(config.modelReasoningEffort).toBe("medium");
    expect(config.maxNewTasks).toBe(12);
    expect(config.maxDecompositionDepth).toBe(2);
  });

  it("allows decomposition safeguards to be tuned through the environment", () => {
    const config = loadServerConfig({
      RUN_MAX_NEW_TASKS: "7",
      RUN_MAX_DECOMPOSITION_DEPTH: "1",
    });

    expect(config.maxNewTasks).toBe(7);
    expect(config.maxDecompositionDepth).toBe(1);
  });
});
