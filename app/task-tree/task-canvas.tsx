"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import { useEffect, useMemo, useRef } from "react";
import type { RunAction, Task, TaskTree } from "../../packages/domain/src";
import { layoutOrderedTree, type OrderedLayoutNode } from "./ordered-layout";
import type { GhostBranch } from "./store";
import { TaskNode, type TaskFlowNode } from "./task-node";
import { getTaskNodeSize } from "./task-node-size";
import { shouldFitRoot } from "./viewport-policy";

const nodeTypes: NodeTypes = { task: TaskNode };

function buildFlow(
  tree: TaskTree,
  onRun: (action: RunAction, taskId: string) => void,
  runDisabled: boolean,
  newTaskIds: string[],
  changedFields: Record<string, string[]>,
  ghostBranches: GhostBranch[],
): { nodes: TaskFlowNode[]; edges: Edge[] } {
  const ghostParentIds = new Set(
    ghostBranches.map((branch) => branch.parentId),
  );

  const nodes: TaskFlowNode[] = [];
  const edges: Edge[] = [];
  const layoutNodes: OrderedLayoutNode[] = [];

  const visit = (
    task: Task,
    parentId: string | null,
    order: number,
    isRoot = false,
    removing = false,
  ) => {
    const { height, width } = getTaskNodeSize(task, isRoot);
    layoutNodes.push({
      id: task.id,
      parentId,
      order,
      width,
      height,
    });
    nodes.push({
      id: task.id,
      type: "task",
      position: { x: 0, y: 0 },
      height,
      width,
      style: { height, width },
      data: {
        task,
        isRoot,
        order,
        onRun,
        runDisabled: runDisabled || removing,
        hasOutgoing:
          task.children.length > 0 || ghostParentIds.has(task.id),
        visualState: removing
          ? "removing"
          : newTaskIds.includes(task.id)
            ? "new"
            : changedFields[task.id]?.length
              ? "changed"
              : undefined,
        changedFields: removing ? [] : (changedFields[task.id] ?? []),
      },
    });
    if (parentId) {
      edges.push({
        id: `${parentId}-${task.id}`,
        source: parentId,
        target: task.id,
        type: "smoothstep",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: "#a4a1ad",
        },
        style: removing
          ? {
              stroke: "#c96c5b",
              strokeWidth: 1.5,
              strokeDasharray: "5 5",
            }
          : { stroke: "#a4a1ad", strokeWidth: 1.5 },
      });
    }

    task.children.forEach((child, index) =>
      visit(child, task.id, index + 1, false, removing),
    );
  };

  visit(tree.root, null, 1, true);
  ghostBranches.forEach((branch) =>
    visit(branch.task, branch.parentId, branch.order, false, true),
  );
  const positions = layoutOrderedTree(layoutNodes);
  const positioned = nodes.map((node) => {
    return {
      ...node,
      position: positions[node.id],
    };
  });

  return { nodes: positioned, edges };
}

function FitOnRootChange({ rootId }: { rootId: string }) {
  const { fitView } = useReactFlow();
  const fittedRootId = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldFitRoot(fittedRootId.current, rootId)) return;
    fittedRootId.current = rootId;

    const frame = requestAnimationFrame(() => {
      void fitView({ duration: 420, padding: 0.18, maxZoom: 1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView, rootId]);
  return null;
}

function Canvas({
  tree,
  onRun,
  runDisabled,
  newTaskIds,
  changedFields,
  ghostBranches,
}: {
  tree: TaskTree;
  onRun: (action: RunAction, taskId: string) => void;
  runDisabled: boolean;
  newTaskIds: string[];
  changedFields: Record<string, string[]>;
  ghostBranches: GhostBranch[];
}) {
  const flow = useMemo(
    () =>
      buildFlow(
        tree,
        onRun,
        runDisabled,
        newTaskIds,
        changedFields,
        ghostBranches,
      ),
    [
      tree,
      onRun,
      runDisabled,
      newTaskIds,
      changedFields,
      ghostBranches,
    ],
  );

  return (
    <ReactFlow
      colorMode="light"
      defaultEdgeOptions={{ focusable: false }}
      edges={flow.edges}
      maxZoom={1.25}
      minZoom={0.22}
      nodeTypes={nodeTypes}
      nodes={flow.nodes}
      nodesConnectable={false}
      nodesDraggable
      panOnScroll
      proOptions={{ hideAttribution: true }}
      selectionOnDrag={false}
    >
      <Background
        color="#d9d6df"
        gap={24}
        size={1}
        variant={BackgroundVariant.Dots}
      />
      <Controls position="bottom-left" showInteractive={false} />
      <MiniMap
        ariaLabel="Task Tree overview"
        bgColor="#ffffff"
        className="task-minimap"
        maskColor="rgba(247, 246, 242, 0.58)"
        maskStrokeColor="#6659d6"
        maskStrokeWidth={2}
        nodeBorderRadius={14}
        nodeColor={(node) => {
          const kind = node.data?.task
            ? deriveTaskKindSafe(node.data.task as Task)
            : "unresolved";
          return kind === "compound"
            ? "#6659d6"
            : kind === "primitive"
              ? "#d79234"
              : "#96919e";
        }}
        nodeStrokeColor="#ffffff"
        nodeStrokeWidth={3}
        position="bottom-right"
        pannable
        zoomable
      />
      <FitOnRootChange rootId={tree.root.id} />
    </ReactFlow>
  );
}

function deriveTaskKindSafe(task: Task) {
  if (task.children.length > 0) return "compound";
  return task.operator ? "primitive" : "unresolved";
}

export function TaskCanvas({
  tree,
  onRun,
  runDisabled = false,
  newTaskIds = [],
  changedFields = {},
  ghostBranches = [],
}: {
  tree: TaskTree;
  onRun: (action: RunAction, taskId: string) => void;
  runDisabled?: boolean;
  newTaskIds?: string[];
  changedFields?: Record<string, string[]>;
  ghostBranches?: GhostBranch[];
}) {
  return (
    <ReactFlowProvider>
      <Canvas
        changedFields={changedFields}
        ghostBranches={ghostBranches}
        newTaskIds={newTaskIds}
        onRun={onRun}
        runDisabled={runDisabled}
        tree={tree}
      />
    </ReactFlowProvider>
  );
}
