import { describe, expect, it } from "vitest";
import { addSubtask, createEmptyTree } from "../../packages/domain/src";
import { getTaskNodeSize } from "./task-node-size";

const rootId = "00000000-0000-4000-8000-000000000030";
const childId = "00000000-0000-4000-8000-000000000031";

describe("task node dimensions", () => {
  it("provides the width and height required by the minimap", () => {
    const tree = addSubtask(
      createEmptyTree(rootId),
      rootId,
      "First Task",
      undefined,
      childId,
    ).tree;

    const sizes = [
      getTaskNodeSize(tree.root, true),
      getTaskNodeSize(tree.root.children[0], false),
    ];

    sizes.forEach((size) => {
      expect(size.width).toBe(390);
      expect(size.height).toBeGreaterThan(0);
    });
  });
});
