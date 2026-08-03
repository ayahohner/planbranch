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
  ModelChatRequest,
  ModelHealth,
  ModelMessage,
  ModelToolHandler,
  ToolCall,
} from "./model";
import { RunManager } from "./run-manager";

const rootId = "00000000-0000-4000-8000-000000000001";
const parentId = "00000000-0000-4000-8000-000000000002";
const childId = "00000000-0000-4000-8000-000000000003";
const runId = "00000000-0000-4000-8000-000000000004";

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
  maxNewTasks: 12,
  maxDecompositionDepth: 2,
};

function toolCall(
  name: string,
  args: Record<string, unknown> = {},
): ToolCall {
  return { function: { name, arguments: args } };
}

class FakeModel implements ModelClient {
  readonly chatRequests: ModelChatRequest[] = [];
  readonly completionRequests: ModelChatRequest[] = [];

  constructor(
    private readonly streams: Array<ModelMessage | Error>,
    private readonly completions: ModelMessage[] = [],
  ) {}

  async runChat(
    request: ModelChatRequest,
    _signal: AbortSignal,
    onToolCall?: ModelToolHandler,
  ): Promise<ModelMessage> {
    this.chatRequests.push(request);
    const next = this.streams.shift();
    if (!next) throw new Error("Missing fake stream response.");
    if (next instanceof Error) throw next;
    for (const call of next.toolCalls) {
      await onToolCall?.(call);
    }
    return next;
  }

  async completeChat(
    request: ModelChatRequest,
  ): Promise<ModelMessage> {
    this.completionRequests.push(request);
    const next = this.completions.shift();
    if (!next) throw new Error("Missing fake completion response.");
    return next;
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
      models: [],
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

function populatedTreeRequest(): StartRunRequest {
  const tree = createEmptyTree(rootId);
  tree.root.title = "Launch a Marketing Website";
  tree.root.description =
    "Create a focused website for an analytics startup serving small retailers.";
  tree.root.outputs = ["Published Website"];
  return {
    action: "populate",
    tree,
    targetTaskId: rootId,
  };
}

const successfulCollapseTools: ModelMessage = {
  content: "",
  toolCalls: [
    toolCall("revise_task", {
      task_id: parentId,
      description:
        "Create the landing page in one bounded implementation pass.",
    }),
    toolCall("revise_task", {
      task_id: parentId,
      inputs: ["Startup Brief"],
    }),
    toolCall("revise_task", {
      task_id: parentId,
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
  content: "```json\n{\"valid\":true,\"issues\":[]}\n```",
  toolCalls: [],
};

describe("RunManager", () => {
  it("streams Root Goals and Inputs separately without changing other fields", async () => {
    const model = new FakeModel(
      [
        {
          content: "",
          toolCalls: [
            toolCall("revise_task", {
              task_id: rootId,
              goals: [
                "Communicate the startup value clearly",
                "Generate qualified demo requests",
              ],
            }),
            toolCall("revise_task", {
              task_id: rootId,
              inputs: ["Startup Brief", "Target Audience"],
            }),
            toolCall("finish_run"),
          ],
        },
      ],
      [validAudit],
    );
    const manager = new RunManager(model, config, () => runId);
    const request = populatedTreeRequest();
    const started = manager.start(request);
    const finished = await manager.waitForRun(started.id);

    expect(finished.state).toBe("completed");
    const revisions = finished.events.filter(
      (event) => event.type === "task.revised",
    );
    expect(revisions).toHaveLength(2);
    expect(
      revisions.map((event) =>
        Object.keys(
          (event.payload as { patch: Record<string, unknown> }).patch,
        ).filter(
          (key) =>
            (event.payload as { patch: Record<string, unknown> }).patch[key] !==
            undefined,
        ),
      ),
    ).toEqual([["goals"], ["inputs"]]);

    const completion = finished.events.find(
      (event) => event.type === "run.completed",
    );
    const result = (
      completion?.payload as { tree: ReturnType<typeof createEmptyTree> }
    ).tree;
    expect(result.root).toMatchObject({
      title: request.tree.root.title,
      description: request.tree.root.description,
      outputs: ["Published Website"],
      goals: [
        "Communicate the startup value clearly",
        "Generate qualified demo requests",
      ],
      inputs: ["Startup Brief", "Target Audience"],
      children: [],
    });
  });

  it("rejects Populate Root Brief on a non-Root Task", () => {
    let tree = createEmptyTree(rootId);
    tree = addSubtask(tree, rootId, "Child", undefined, parentId).tree;
    const manager = new RunManager(new FakeModel([]), config, () => runId);
    expect(() =>
      manager.start({
        action: "populate",
        tree,
        targetTaskId: parentId,
      }),
    ).toThrow("available only on the Root Task");
  });

  it("rejects non-Goal and non-Input edits during Populate Root Brief", async () => {
    const invalidEdit: ModelMessage = {
      content: "",
      toolCalls: [
        toolCall("revise_task", {
          task_id: rootId,
          outputs: ["Changed Output"],
        }),
      ],
    };
    const manager = new RunManager(
      new FakeModel([invalidEdit, invalidEdit, invalidEdit]),
      { ...config, maxRejectedTools: 1 },
      () => runId,
    );
    const started = manager.start(populatedTreeRequest());
    const finished = await manager.waitForRun(started.id);

    expect(finished.state).toBe("failed");
    expect(
      finished.events.filter((event) => event.type === "tool.rejected"),
    ).toHaveLength(3);
    expect(
      finished.events.some((event) =>
        JSON.stringify(event.payload).includes(
          "exactly one field per revise_task call",
        ),
      ),
    ).toBe(true);
  });

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

  it("uses the model and reasoning effort selected for the Run", async () => {
    const model = new FakeModel([successfulCollapseTools], [validAudit]);
    const manager = new RunManager(model, config, () => runId);
    const started = manager.start({
      ...collapsedTreeRequest(),
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });
    const finished = await manager.waitForRun(started.id);

    expect(finished.state).toBe("completed");
    expect(model.chatRequests).toHaveLength(1);
    expect(model.completionRequests).toHaveLength(1);
    expect([...model.chatRequests, ...model.completionRequests]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "gpt-5.6-terra",
          reasoningEffort: "medium",
        }),
      ]),
    );
    expect(
      finished.events.find((event) => event.type === "run.started")?.payload,
    ).toMatchObject({ model: "gpt-5.6-terra" });
  });

  it("retries rather than committing incomplete generated subtasks", async () => {
    const incomplete: ModelMessage = {
      content: "",
      toolCalls: [
        toolCall("add_subtask", {
          parent_id: rootId,
          title: "Draft Page",
        }),
        toolCall("finish_run"),
      ],
    };
    const manager = new RunManager(
      new FakeModel([incomplete, incomplete, incomplete]),
      config,
      () => runId,
    );
    const started = manager.start({
      action: "decompose",
      tree: createEmptyTree(rootId),
      targetTaskId: rootId,
    });
    const finished = await manager.waitForRun(started.id);

    expect(finished.state).toBe("failed");
    expect(
      finished.events.filter((event) => event.type === "attempt.started"),
    ).toHaveLength(3);
    expect(
      JSON.stringify(
        finished.events
          .filter((event) => event.type === "attempt.failed")
          .map((event) => event.payload),
      ),
    ).toContain("MISSING_TASK_DESCRIPTION");
    expect(JSON.stringify(finished.events)).toContain("MISSING_OPERATOR");
  });

  it("commits complete sibling Tasks built through field-by-field edits", async () => {
    const complete: ModelMessage = {
      content: "",
      toolCalls: [
        toolCall("add_subtask", {
          parent_id: rootId,
          title: "Draft Page",
        }),
        toolCall("revise_task", {
          task_id: parentId,
          description: "Draft the page from the supplied brief.",
        }),
        toolCall("revise_task", {
          task_id: parentId,
          inputs: ["Page Brief"],
        }),
        toolCall("revise_task", {
          task_id: parentId,
          outputs: ["Page Draft"],
        }),
        toolCall("declare_operator", {
          task_id: parentId,
          executor: "llm",
          operator: "draft-page",
        }),
        toolCall("declare_operator", {
          task_id: parentId,
          executor: "llm",
          operator: "draft-page",
        }),
        toolCall("add_subtask", {
          parent_id: rootId,
          title: "Publish Page",
        }),
        toolCall("revise_task", {
          task_id: childId,
          description: "Publish the approved page through the site tooling.",
        }),
        toolCall("revise_task", {
          task_id: childId,
          inputs: ["Page Draft"],
        }),
        toolCall("revise_task", {
          task_id: childId,
          outputs: ["Published Page"],
        }),
        toolCall("declare_operator", {
          task_id: childId,
          executor: "deterministic",
          operator: "publish-page",
        }),
        toolCall("finish_run"),
      ],
    };
    const model = new FakeModel([complete], [validAudit]);
    const ids = [runId, parentId, childId];
    let idIndex = 0;
    const manager = new RunManager(
      model,
      { ...config, maxToolCalls: 20 },
      () => ids[idIndex++] ?? childId,
    );
    const started = manager.start({
      action: "decompose",
      tree: createEmptyTree(rootId),
      targetTaskId: rootId,
    });
    const finished = await manager.waitForRun(started.id);

    expect(finished.state).toBe("completed");
    const completion = finished.events.find(
      (event) => event.type === "run.completed",
    );
    const result = (
      completion?.payload as { tree: ReturnType<typeof createEmptyTree> }
    ).tree;
    expect(result.root.children[0]).toMatchObject({
      title: "Draft Page",
      description: "Draft the page from the supplied brief.",
      inputs: ["Page Brief"],
      outputs: ["Page Draft"],
      operator: { executor: "llm", name: "draft-page" },
    });
    expect(
      finished.events.filter((event) => event.type === "operator.declared"),
    ).toHaveLength(2);
  });

  it("rejects new Tasks beyond both depth and task-count limits", async () => {
    const bounded: ModelMessage = {
      content: "",
      toolCalls: [
        toolCall("add_subtask", {
          parent_id: rootId,
          title: "Prepare Data",
        }),
        toolCall("revise_task", {
          task_id: parentId,
          description: "Prepare the source data with explicit normalization rules.",
        }),
        toolCall("revise_task", {
          task_id: parentId,
          inputs: ["Source Data"],
        }),
        toolCall("revise_task", {
          task_id: parentId,
          outputs: ["Prepared Data"],
        }),
        toolCall("declare_operator", {
          task_id: parentId,
          executor: "deterministic",
          operator: "normalize-data",
        }),
        toolCall("add_subtask", {
          parent_id: parentId,
          title: "Needless Inner Step",
        }),
        toolCall("add_subtask", {
          parent_id: rootId,
          title: "Publish Data",
        }),
        toolCall("revise_task", {
          task_id: childId,
          description: "Publish the prepared data through the configured destination.",
        }),
        toolCall("revise_task", {
          task_id: childId,
          inputs: ["Prepared Data"],
        }),
        toolCall("revise_task", {
          task_id: childId,
          outputs: ["Published Data"],
        }),
        toolCall("declare_operator", {
          task_id: childId,
          executor: "deterministic",
          operator: "publish-data",
        }),
        toolCall("add_subtask", {
          parent_id: rootId,
          title: "Excess Task",
        }),
        toolCall("finish_run"),
      ],
    };
    const model = new FakeModel([bounded], [validAudit]);
    const ids = [runId, parentId, childId];
    let idIndex = 0;
    const manager = new RunManager(
      model,
      {
        ...config,
        maxToolCalls: 20,
        maxNewTasks: 2,
        maxDecompositionDepth: 1,
      },
      () => ids[idIndex++] ?? childId,
    );
    const started = manager.start({
      action: "decompose",
      tree: createEmptyTree(rootId),
      targetTaskId: rootId,
    });
    const finished = await manager.waitForRun(started.id);

    expect(finished.state).toBe("completed");
    const rejections = finished.events
      .filter((event) => event.type === "tool.rejected")
      .map((event) => JSON.stringify(event.payload));
    expect(rejections).toHaveLength(2);
    expect(rejections[0]).toContain("at most 1 levels");
    expect(rejections[1]).toContain("at most 2 Tasks");
  });

  it("rejects a redundant one-child decomposition", async () => {
    const unary: ModelMessage = {
      content: "",
      toolCalls: [
        toolCall("add_subtask", {
          parent_id: rootId,
          title: "Only Stage",
        }),
        toolCall("revise_task", {
          task_id: parentId,
          description: "Perform the only independently meaningful stage.",
        }),
        toolCall("revise_task", {
          task_id: parentId,
          inputs: ["Source Data"],
        }),
        toolCall("revise_task", {
          task_id: parentId,
          outputs: ["Result Data"],
        }),
        toolCall("declare_operator", {
          task_id: parentId,
          executor: "deterministic",
          operator: "transform-data",
        }),
        toolCall("finish_run"),
      ],
    };
    const model = new FakeModel([unary, unary, unary]);
    const manager = new RunManager(
      model,
      config,
      () => (model.chatRequests.length === 0 ? runId : parentId),
    );
    const started = manager.start({
      action: "decompose",
      tree: createEmptyTree(rootId),
      targetTaskId: rootId,
    });
    const finished = await manager.waitForRun(started.id);

    expect(finished.state).toBe("failed");
    expect(JSON.stringify(finished.events)).toContain(
      "REDUNDANT_SINGLE_CHILD_DECOMPOSITION",
    );
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
