import { beforeEach, describe, expect, it } from "vitest";
import {
  addSubtask,
  createEmptyTree,
  createRunEvent,
} from "../../packages/domain/src";
import { useEditorStore } from "./store";

const rootId = "00000000-0000-4000-8000-000000000010";
const runId = "00000000-0000-4000-8000-000000000011";
const childId = "00000000-0000-4000-8000-000000000012";

describe("editor history", () => {
  beforeEach(() => {
    useEditorStore.setState({
      tree: createEmptyTree(rootId),
      history: [],
      future: [],
      notice: null,
      activeRun: null,
      runSummary: null,
      runLogs: [],
      activityOpen: false,
    });
  });

  it("materializes Run events and commits completion as one undo entry", () => {
    const store = useEditorStore.getState();
    store.beginRun(runId, "decompose", rootId);
    store.applyRunEvent(
      createRunEvent(runId, 1, 1, "attempt.started", {
        tree: createEmptyTree(rootId),
        attempt: 1,
        maxAttempts: 3,
      }),
    );
    const child = {
      id: childId,
      title: "Draft Hero Copy",
      description: "",
      inputs: [],
      outputs: [],
      children: [],
    };
    store.applyRunEvent(
      createRunEvent(runId, 1, 2, "task.added", {
        parentId: rootId,
        task: child,
      }),
    );
    const completed = addSubtask(
      createEmptyTree(rootId),
      rootId,
      child.title,
      undefined,
      childId,
    ).tree;
    store.applyRunEvent(
      createRunEvent(runId, 1, 3, "run.completed", { tree: completed }),
    );

    expect(useEditorStore.getState().tree.root.children[0].id).toBe(childId);
    expect(useEditorStore.getState().history).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().tree.root.children).toEqual([]);
  });

  it("materializes Root Goals and Inputs as separate highlighted revisions", () => {
    const store = useEditorStore.getState();
    const base = createEmptyTree(rootId);
    const completed = createEmptyTree(rootId);
    completed.root.goals = ["Generate qualified leads"];
    completed.root.inputs = ["Startup Brief", "Target Audience"];

    store.beginRun(runId, "populate", rootId);
    store.applyRunEvent(
      createRunEvent(runId, 1, 1, "attempt.started", {
        tree: base,
        attempt: 1,
        maxAttempts: 3,
      }),
    );
    store.applyRunEvent(
      createRunEvent(runId, 1, 2, "task.revised", {
        taskId: rootId,
        patch: { goals: completed.root.goals },
      }),
    );
    expect(
      useEditorStore.getState().activeRun?.changedFields[rootId],
    ).toEqual(["goals"]);

    store.applyRunEvent(
      createRunEvent(runId, 1, 3, "task.revised", {
        taskId: rootId,
        patch: { inputs: completed.root.inputs },
      }),
    );
    expect(
      useEditorStore.getState().activeRun?.changedFields[rootId],
    ).toEqual(["goals", "inputs"]);

    store.applyRunEvent(
      createRunEvent(runId, 1, 4, "run.completed", { tree: completed }),
    );
    expect(useEditorStore.getState().tree.root.goals).toEqual(
      completed.root.goals,
    );
    expect(useEditorStore.getState().history).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().tree.root.goals).toEqual(base.root.goals);
    expect(useEditorStore.getState().tree.root.inputs).toEqual([]);
  });

  it("discards a failed overlay without adding undo history", () => {
    const store = useEditorStore.getState();
    store.beginRun(runId, "decompose", rootId);
    store.applyRunEvent(
      createRunEvent(runId, 3, 1, "run.failed", {
        message: "Exhausted retries",
      }),
    );
    expect(useEditorStore.getState().activeRun).toBeNull();
    expect(useEditorStore.getState().history).toHaveLength(0);
    expect(useEditorStore.getState().tree.root.children).toEqual([]);
  });

  it("rolls back an active Run immediately after cancellation is accepted", () => {
    const store = useEditorStore.getState();
    store.beginRun(runId, "populate", rootId);
    store.applyRunEvent(
      createRunEvent(runId, 1, 1, "task.revised", {
        taskId: rootId,
        patch: { goals: ["Draft Goal"] },
      }),
    );

    store.cancelActiveRun();

    expect(useEditorStore.getState().activeRun).toBeNull();
    expect(useEditorStore.getState().tree.root.goals).toEqual([
      "Define the desired outcome",
    ]);
    expect(useEditorStore.getState().history).toHaveLength(0);
    expect(useEditorStore.getState().runSummary?.state).toBe("cancelled");
    expect(useEditorStore.getState().notice?.message).toContain(
      "In-progress edits were undone",
    );
  });

  it("rolls back an active Run when its service connection is lost", () => {
    const store = useEditorStore.getState();
    store.beginRun(runId, "decompose", rootId);
    store.applyRunEvent(
      createRunEvent(runId, 1, 1, "task.revised", {
        taskId: rootId,
        patch: { description: "Draft description" },
      }),
    );

    store.failActiveRun("The local model service stopped responding.");

    expect(useEditorStore.getState().activeRun).toBeNull();
    expect(useEditorStore.getState().tree.root.description).toBe(
      "Describe the work, domain context, and constraints.",
    );
    expect(useEditorStore.getState().history).toHaveLength(0);
    expect(useEditorStore.getState().runSummary?.state).toBe("failed");
    expect(useEditorStore.getState().notice?.message).toContain(
      "In-progress edits were undone",
    );
  });

  it("commits inline edits and undoes or redoes them transactionally", () => {
    useEditorStore.getState().reviseTask(rootId, {
      title: "Launch a Marketing Website",
    });
    expect(useEditorStore.getState().tree.root.title).toBe(
      "Launch a Marketing Website",
    );

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().tree.root.title).toBe(
      "New Planning Brief",
    );

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().tree.root.title).toBe(
      "Launch a Marketing Website",
    );
  });

  it("clears history when importing a replacement tree", () => {
    useEditorStore.getState().reviseTask(rootId, { title: "Changed" });
    useEditorStore
      .getState()
      .replaceTree(createEmptyTree(rootId), {
        kind: "success",
        message: "Imported",
      });
    expect(useEditorStore.getState().history).toEqual([]);
    expect(useEditorStore.getState().future).toEqual([]);
  });

  it("restores a saved workspace without restoring an active Run", () => {
    const saved = createEmptyTree(rootId);
    saved.root.title = "Restored Brief";
    const history = [
      {
        label: "Edit Task title",
        patches: [],
        inversePatches: [],
      },
    ];
    useEditorStore.setState({
      activeRun: {
        id: runId,
        action: "decompose",
        targetTaskId: rootId,
        baseTree: createEmptyTree(rootId),
        overlayTree: createEmptyTree(rootId),
        attempt: 1,
        maxAttempts: 3,
        newTaskIds: [],
        changedFields: {},
        ghostBranches: [],
      },
    });

    useEditorStore.getState().restoreWorkspace(saved, history, []);

    expect(useEditorStore.getState().tree.root.title).toBe("Restored Brief");
    expect(useEditorStore.getState().history).toEqual(history);
    expect(useEditorStore.getState().activeRun).toBeNull();
  });
});
