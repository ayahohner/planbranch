import { describe, expect, it } from "vitest";
import {
  addSubtask,
  collapseTask,
  createEmptyTree,
  declareOperator,
  deriveTaskKind,
  exportTaskTree,
  importTaskTree,
  moveSubtree,
  reviseTask,
  TreeOperationError,
  validateTaskTree,
} from "./index";

const rootId = "00000000-0000-4000-8000-000000000001";
const firstId = "00000000-0000-4000-8000-000000000002";
const secondId = "00000000-0000-4000-8000-000000000003";
const grandchildId = "00000000-0000-4000-8000-000000000004";

describe("Task Tree domain", () => {
  it("derives kinds instead of storing status", () => {
    const tree = createEmptyTree(rootId);
    expect(deriveTaskKind(tree.root)).toBe("unresolved");

    const withChild = addSubtask(
      tree,
      rootId,
      "Draft Hero Copy",
      undefined,
      firstId,
    ).tree;
    expect(deriveTaskKind(withChild.root)).toBe("compound");
    expect(deriveTaskKind(withChild.root.children[0])).toBe("unresolved");

    const primitive = declareOperator(withChild, firstId, {
      executor: "llm",
      name: "draft-hero-copy",
    });
    expect(deriveTaskKind(primitive.root.children[0])).toBe("primitive");
  });

  it("keeps ordered children and supports explicit insertion", () => {
    let tree = createEmptyTree(rootId);
    tree = addSubtask(
      tree,
      rootId,
      "Second Task",
      undefined,
      secondId,
    ).tree;
    tree = addSubtask(tree, rootId, "First Task", null, firstId).tree;
    expect(tree.root.children.map((task) => task.id)).toEqual([
      firstId,
      secondId,
    ]);
  });

  it("collapses descendants but preserves the selected task", () => {
    let tree = createEmptyTree(rootId);
    tree = addSubtask(tree, rootId, "Parent", undefined, firstId).tree;
    tree = addSubtask(tree, rootId, "Sibling", undefined, secondId).tree;
    tree = addSubtask(
      tree,
      firstId,
      "Over-decomposed Step",
      undefined,
      grandchildId,
    ).tree;
    tree = reviseTask(tree, firstId, {
      description: "Keep this useful task.",
    });

    const result = collapseTask(tree, firstId);
    expect(result.removedTaskIds).toEqual([grandchildId]);
    expect(result.tree.root.children.map((task) => task.id)).toEqual([
      firstId,
      secondId,
    ]);
    expect(result.tree.root.children[0]).toMatchObject({
      id: firstId,
      description: "Keep this useful task.",
      children: [],
    });
    expect(result.tree.root.children[1].id).toBe(secondId);
  });

  it("prevents cycles when moving subtrees", () => {
    let tree = createEmptyTree(rootId);
    tree = addSubtask(tree, rootId, "Parent", undefined, firstId).tree;
    tree = addSubtask(
      tree,
      firstId,
      "Child",
      undefined,
      grandchildId,
    ).tree;

    expect(() => moveSubtree(tree, firstId, grandchildId)).toThrowError(
      TreeOperationError,
    );
  });

  it("validates unique IDs and Compound/Operator exclusivity", () => {
    const tree = createEmptyTree(rootId);
    tree.root.children.push({
      id: rootId,
      title: "Duplicate",
      description: "",
      inputs: [],
      outputs: [],
      operator: { executor: "llm", name: "perform-task" },
      children: [
        {
          id: firstId,
          title: "Child",
          description: "",
          inputs: [],
          outputs: [],
          children: [],
        },
      ],
    });

    const issues = validateTaskTree(tree);
    expect(issues.some((issue) => issue.message.includes("Duplicate"))).toBe(
      true,
    );
    expect(
      issues.some((issue) => issue.message.includes("cannot also have")),
    ).toBe(true);
  });

  it("round-trips semantic JSON", () => {
    let tree = createEmptyTree(rootId);
    tree = reviseTask(tree, rootId, {
      title: "Create a Marketing Website",
      inputs: ["Startup Brief"],
      outputs: ["Published Website"],
      goals: ["Generate Demo Requests"],
    });
    const exported = exportTaskTree(tree);
    expect(importTaskTree(exported)).toEqual(tree);
  });
});
