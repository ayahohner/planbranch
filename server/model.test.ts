import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAppServerClient } from "./model";

const fakeCodexCommand = fileURLToPath(
  new URL("./test-fixtures/fake-codex-app-server.mjs", import.meta.url),
);
const originalMode = process.env.TASK_TREE_FAKE_CODEX_MODE;

afterEach(() => {
  if (originalMode === undefined) {
    delete process.env.TASK_TREE_FAKE_CODEX_MODE;
  } else {
    process.env.TASK_TREE_FAKE_CODEX_MODE = originalMode;
  }
});

function request() {
  return {
    model: "fake-model",
    messages: [{ role: "user" as const, content: "Plan a task." }],
  };
}

describe("CodexAppServerClient lifecycle", () => {
  it("rejects an active turn when the app-server child exits", async () => {
    process.env.TASK_TREE_FAKE_CODEX_MODE = "exit-after-turn-start";
    const client = new CodexAppServerClient(fakeCodexCommand);

    await expect(
      client.runChat(request(), new AbortController().signal),
    ).rejects.toThrow("exited unexpectedly");
  });

  it("aborts without leaking a rejected interrupt request", async () => {
    process.env.TASK_TREE_FAKE_CODEX_MODE = "ignore-interrupt";
    const client = new CodexAppServerClient(fakeCodexCommand);
    const controller = new AbortController();
    const result = client.runChat(request(), controller.signal);

    setTimeout(() => controller.abort(), 50);

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
});
