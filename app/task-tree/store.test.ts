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
});
