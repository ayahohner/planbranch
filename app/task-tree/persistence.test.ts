import { describe, expect, it } from "vitest";
import { createEmptyTree } from "../../packages/domain/src";
import {
  parsePersistedModelSelection,
  parsePersistedWorkspace,
  serializeModelSelection,
  serializeWorkspace,
} from "./persistence";

const rootId = "00000000-0000-4000-8000-000000000020";

describe("workspace persistence", () => {
  it("round-trips the committed tree and undo history", () => {
    const tree = createEmptyTree(rootId);
    tree.root.title = "Persist this planning brief";
    const source = serializeWorkspace({
      tree,
      history: [
        {
          label: "Edit Task title",
          patches: [
            {
              op: "replace",
              path: ["root", "title"],
              value: tree.root.title,
            },
          ],
          inversePatches: [
            {
              op: "replace",
              path: ["root", "title"],
              value: "New Planning Brief",
            },
          ],
        },
      ],
      future: [],
    });

    expect(parsePersistedWorkspace(source)).toEqual({
      schemaVersion: 1,
      tree,
      history: [
        {
          label: "Edit Task title",
          patches: [
            {
              op: "replace",
              path: ["root", "title"],
              value: tree.root.title,
            },
          ],
          inversePatches: [
            {
              op: "replace",
              path: ["root", "title"],
              value: "New Planning Brief",
            },
          ],
        },
      ],
      future: [],
    });
  });

  it("rejects malformed saved workspaces", () => {
    expect(() =>
      parsePersistedWorkspace(
        JSON.stringify({
          schemaVersion: 1,
          tree: { invalid: true },
          history: [],
          future: [],
        }),
      ),
    ).toThrow();
  });

  it("round-trips a model and reasoning preference", () => {
    const source = serializeModelSelection({
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
    });

    expect(parsePersistedModelSelection(source)).toEqual({
      schemaVersion: 1,
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
    });
  });
});
