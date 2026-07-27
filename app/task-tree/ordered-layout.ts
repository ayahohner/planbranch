export interface OrderedLayoutNode {
  id: string;
  parentId: string | null;
  order: number;
  width: number;
  height: number;
}

export interface OrderedPosition {
  x: number;
  y: number;
}

export interface OrderedLayoutOptions {
  siblingGap?: number;
  rankGap?: number;
  marginX?: number;
  marginY?: number;
}

export function layoutOrderedTree(
  nodes: OrderedLayoutNode[],
  {
    siblingGap = 56,
    rankGap = 100,
    marginX = 48,
    marginY = 48,
  }: OrderedLayoutOptions = {},
): Record<string, OrderedPosition> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const insertionOrder = new Map(
    nodes.map((node, index) => [node.id, index]),
  );
  const children = new Map<string, OrderedLayoutNode[]>();
  const roots: OrderedLayoutNode[] = [];

  nodes.forEach((node) => {
    if (!node.parentId || !byId.has(node.parentId)) {
      roots.push(node);
      return;
    }
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  });
  const sortSiblings = (siblings: OrderedLayoutNode[]) =>
    siblings.sort(
      (left, right) =>
        left.order - right.order ||
        (insertionOrder.get(left.id) ?? 0) -
          (insertionOrder.get(right.id) ?? 0),
    );
  roots.sort(
    (left, right) =>
      left.order - right.order ||
      (insertionOrder.get(left.id) ?? 0) -
        (insertionOrder.get(right.id) ?? 0),
  );
  children.forEach(sortSiblings);

  const depths = new Map<string, number>();
  const levelHeights: number[] = [];
  const assignDepth = (node: OrderedLayoutNode, depth: number) => {
    depths.set(node.id, depth);
    levelHeights[depth] = Math.max(levelHeights[depth] ?? 0, node.height);
    (children.get(node.id) ?? []).forEach((child) =>
      assignDepth(child, depth + 1),
    );
  };
  roots.forEach((root) => assignDepth(root, 0));

  const levelTops: number[] = [];
  levelHeights.forEach((height, depth) => {
    levelTops[depth] =
      depth === 0
        ? marginY
        : levelTops[depth - 1] + levelHeights[depth - 1] + rankGap;
  });

  const subtreeWidths = new Map<string, number>();
  const measure = (node: OrderedLayoutNode): number => {
    const orderedChildren = children.get(node.id) ?? [];
    const childWidth =
      orderedChildren.reduce((total, child) => total + measure(child), 0) +
      Math.max(orderedChildren.length - 1, 0) * siblingGap;
    const width = Math.max(node.width, childWidth);
    subtreeWidths.set(node.id, width);
    return width;
  };
  roots.forEach(measure);

  const positions: Record<string, OrderedPosition> = {};
  const place = (node: OrderedLayoutNode, subtreeLeft: number) => {
    const subtreeWidth = subtreeWidths.get(node.id) ?? node.width;
    positions[node.id] = {
      x: subtreeLeft + subtreeWidth / 2 - node.width / 2,
      y: levelTops[depths.get(node.id) ?? 0] ?? marginY,
    };

    const orderedChildren = children.get(node.id) ?? [];
    const childrenWidth =
      orderedChildren.reduce(
        (total, child) => total + (subtreeWidths.get(child.id) ?? child.width),
        0,
      ) + Math.max(orderedChildren.length - 1, 0) * siblingGap;
    let childLeft = subtreeLeft + (subtreeWidth - childrenWidth) / 2;
    orderedChildren.forEach((child) => {
      place(child, childLeft);
      childLeft += (subtreeWidths.get(child.id) ?? child.width) + siblingGap;
    });
  };

  let rootLeft = marginX;
  roots.forEach((root) => {
    place(root, rootLeft);
    rootLeft += (subtreeWidths.get(root.id) ?? root.width) + siblingGap;
  });
  return positions;
}
