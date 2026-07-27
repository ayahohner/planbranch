import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyTree } from "../../packages/domain/src";
import { useEditorStore } from "./store";

const rootId = "00000000-0000-4000-8000-000000000010";

describe("editor history", () => {
  beforeEach(() => {
    useEditorStore.setState({
      tree: createEmptyTree(rootId),
      history: [],
      future: [],
      notice: null,
    });
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
