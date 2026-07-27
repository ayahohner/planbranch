import type { ToolCall } from "ollama";
import { describe, expect, it } from "vitest";
import {
  addSubtask,
  createEmptyTree,
  findTask,
  type StartRunRequest,
} from "../packages/domain/src";
import type { ServerConfig } from "./config";
import type {
  ModelClient,
  ModelHealth,
  ModelMessage,
} from "./model";
import { RunManager } from "./run-manager";

const rootId = "00000000-0000-4000-8000-000000000001";
const parentId = "00000000-0000-4000-8000-000000000002";
const childId = "00000000-0000-4000-8000-000000000003";
const runId = "00000000-0000-4000-8000-000000000004";

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

function toolCall(
  name: string,
  args: Record<string, unknown> = {},
): ToolCall {
  return { function: { name, arguments: args } };
}

class FakeModel implements ModelClient {
  constructor(
    private readonly streams: Array<ModelMessage | Error>,
    private readonly completions: ModelMessage[] = [],
  ) {}

  async *streamChat(): AsyncIterable<ModelMessage> {
    const next = this.streams.shift();
    if (!next) throw new Error("Missing fake stream response.");
    if (next instanceof Error) throw next;
    yield next;
  }

  async completeChat(): Promise<ModelMessage> {
    const next = this.completions.shift();
    if (!next) throw new Error("Missing fake completion response.");
    return next;
  }

  async health(): Promise<ModelHealth> {
    return {
      connected: true,
      version: "test",
      installedModels: [config.ollamaModel],
    };
  }
}

function collapsedTreeRequest(): StartRunRequest {
  let tree = createEmptyTree(rootId);
  tree = addSubtask(tree, rootId, "Design Landing Page", undefined, parentId)
    .tree;
  tree = addSubtask(tree, parentId, "Choose Layout", undefined, childId).tree;
  return {
    action: "collapse",
    tree,
    targetTaskId: parentId,
  };
}

const successfulCollapseTools: ModelMessage = {
  content: "",
  toolCalls: [
    toolCall("revise_task", {
      task_id: parentId,
      description:
        "Create the landing page in one bounded implementation pass.",
      inputs: ["Startup Brief"],
      outputs: ["Landing Page"],
    }),
    toolCall("declare_operator", {
      task_id: parentId,
      executor: "llm",
      operator: "create-landing-page",
    }),
    toolCall("finish_run"),
  ],
};

const validAudit: ModelMessage = {
  content: JSON.stringify({ valid: true, issues: [] }),
  toolCalls: [],
};

describe("RunManager", () => {
  it("streams and commits a validated Collapse as one completed Run", async () => {
    const model = new FakeModel([successfulCollapseTools], [validAudit]);
    const manager = new RunManager(model, config, () => runId);
    const started = manager.start(collapsedTreeRequest());
    const finished = await manager.waitForRun(started.id);

    expect(finished.state).toBe("completed");
    expect(finished.events.map((event) => event.type)).toContain(
      "collapse.staged",
    );
    const completion = finished.events.find(
      (event) => event.type === "run.completed",
    );
    const result = (completion?.payload as { tree: ReturnType<typeof createEmptyTree> })
      .tree;
    const parent = findTask(result, parentId)?.task;
    expect(parent?.children).toEqual([]);
    expect(parent?.operator).toEqual({
      executor: "llm",
      name: "create-landing-page",
    });
  });

  it("retries from the original snapshot after a generation failure", async () => {
    const model = new FakeModel(
      [new Error("temporary model error"), successfulCollapseTools],
      [validAudit],
    );
    let idIndex = 0;
    const ids = [runId, "00000000-0000-4000-8000-000000000005"];
    const manager = new RunManager(model, config, () => ids[idIndex++] ?? runId);
    const started = manager.start(collapsedTreeRequest());
    const finished = await manager.waitForRun(started.id);

    expect(finished.state).toBe("completed");
    expect(
      finished.events.filter((event) => event.type === "attempt.started"),
    ).toHaveLength(2);
    expect(finished.events.map((event) => event.type)).toContain(
      "attempt.retrying",
    );
  });

  it("rolls back after exhausting all attempts", async () => {
    const model = new FakeModel([
      new Error("failure one"),
      new Error("failure two"),
      new Error("failure three"),
    ]);
    const manager = new RunManager(model, config, () => runId);
    const started = manager.start(collapsedTreeRequest());
    const finished = await manager.waitForRun(started.id);

    expect(finished.state).toBe("failed");
    expect(finished.events.map((event) => event.type)).not.toContain(
      "run.completed",
    );
    expect(finished.events.at(-1)?.type).toBe("run.failed");
  });
});
