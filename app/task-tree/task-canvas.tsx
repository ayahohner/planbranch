"use client";

import dagre from "@dagrejs/dagre";
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
import { useEffect, useMemo } from "react";
import type { RunAction, Task, TaskTree } from "../../packages/domain/src";
import type { GhostBranch } from "./store";
import { TaskNode, type TaskFlowNode } from "./task-node";

const nodeTypes: NodeTypes = { task: TaskNode };
const NODE_WIDTH = 390;

function estimateHeight(task: Task, isRoot: boolean): number {
  const descriptionLines = Math.max(1, Math.ceil(task.description.length / 48));
  const artifactRows =
    Math.ceil(Math.max(task.inputs.length, 1) / 2) +
    Math.ceil(Math.max(task.outputs.length, 1) / 2);
  const goalRows =
    isRoot && "goals" in task
      ? Math.ceil(Math.max((task.goals as string[]).length, 1) / 2)
      : 0;
  return 242 + descriptionLines * 18 + artifactRows * 27 + goalRows * 27;
}

function buildFlow(
  tree: TaskTree,
  onRun: (action: RunAction, taskId: string) => void,
  runDisabled: boolean,
  newTaskIds: string[],
  changedFields: Record<string, string[]>,
  ghostBranches: GhostBranch[],
): { nodes: TaskFlowNode[]; edges: Edge[]; structureKey: string } {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "TB",
    ranksep: 100,
    nodesep: 56,
    marginx: 48,
    marginy: 48,
  });

  const nodes: TaskFlowNode[] = [];
  const edges: Edge[] = [];
  const structure: string[] = [];

  const visit = (
    task: Task,
    parentId: string | null,
    order: number,
    isRoot = false,
    removing = false,
  ) => {
    const height = estimateHeight(task, isRoot);
    graph.setNode(task.id, { width: NODE_WIDTH, height });
    nodes.push({
      id: task.id,
      type: "task",
      position: { x: 0, y: 0 },
      style: { width: NODE_WIDTH },
      data: {
        task,
        isRoot,
        order,
        onRun,
        runDisabled: runDisabled || removing,
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
    structure.push(`${parentId ?? "root"}:${task.id}`);

    if (parentId) {
      graph.setEdge(parentId, task.id);
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
  dagre.layout(graph);
  const positioned = nodes.map((node) => {
    const position = graph.node(node.id);
    return {
      ...node,
      position: {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - position.height / 2,
      },
    };
  });

  return { nodes: positioned, edges, structureKey: structure.join("|") };
}

function FitOnStructure({ structureKey }: { structureKey: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void fitView({ duration: 420, padding: 0.18, maxZoom: 1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView, structureKey]);
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
      fitView
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
        className="task-minimap"
        maskColor="rgba(247, 246, 242, 0.78)"
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
        position="bottom-right"
        pannable
        zoomable
      />
      <FitOnStructure structureKey={flow.structureKey} />
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
