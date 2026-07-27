import { describe, expect, it } from "vitest";
import { layoutOrderedTree, type OrderedLayoutNode } from "./ordered-layout";

function node(
  id: string,
  parentId: string | null,
  order: number,
  height = 200,
): OrderedLayoutNode {
  return { id, parentId, order, width: 390, height };
}

describe("ordered tree layout", () => {
  it("keeps chronological siblings left-to-right despite uneven subtrees", () => {
    const positions = layoutOrderedTree([
      node("root", null, 1),
      node("first", "root", 1),
      node("second", "root", 2),
      node("third", "root", 3),
      node("second-a", "second", 1),
      node("second-b", "second", 2),
      node("second-c", "second", 3),
    ]);

    expect(positions.first.x).toBeLessThan(positions.second.x);
    expect(positions.second.x).toBeLessThan(positions.third.x);
    expect(positions["second-a"].x).toBeLessThan(positions["second-b"].x);
    expect(positions["second-b"].x).toBeLessThan(positions["second-c"].x);
  });

  it("uses the tallest node in a rank to prevent vertical overlap", () => {
    const positions = layoutOrderedTree(
      [
        node("root", null, 1, 300),
        node("first", "root", 1, 180),
        node("second", "root", 2, 260),
        node("grandchild", "first", 1, 180),
      ],
      { marginY: 40, rankGap: 90 },
    );

    expect(positions.first.y).toBe(430);
    expect(positions.grandchild.y).toBe(780);
  });
});
