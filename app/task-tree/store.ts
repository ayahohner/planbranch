"use client";

import {
  applyPatches,
  enablePatches,
  produceWithPatches,
  type Patch,
} from "immer";
import { create } from "zustand";
import {
  addSubtask,
  clearOperator,
  collapseTask,
  createEmptyTree,
  declareOperator,
  findTask,
  moveSubtree,
  parseTaskTree,
  reviseTask,
  type RunAction,
  type RunEvent,
  type Operator,
  type RevisableTaskFields,
  type Task,
  type TaskTree,
} from "../../packages/domain/src";

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
}

export interface EditorNotice {
  kind: "success" | "error" | "info";
  message: string;
}

export interface GhostBranch {
  task: Task;
  parentId: string;
  order: number;
}

export interface ActiveRun {
  id: string;
  action: RunAction;
  targetTaskId: string;
  baseTree: TaskTree;
  overlayTree: TaskTree;
  attempt: number;
  maxAttempts: number;
  newTaskIds: string[];
  changedFields: Record<string, string[]>;
  ghostBranches: GhostBranch[];
}

export interface RunLogEntry {
  id: string;
  type: RunEvent["type"];
  level: "info" | "success" | "warning" | "error";
  title: string;
  detail?: string;
  attempt: number;
  timestamp: string;
}

export interface RunSummary {
  id: string;
  action: RunAction;
  targetTaskId: string;
  state: "running" | "completed" | "failed" | "cancelled";
  attempt: number;
  maxAttempts: number;
}

export interface ModelHealthState {
  status: "checking" | "ready" | "unavailable" | "offline";
  name: string;
  runtime: string;
  provider: string;
  authentication?: string;
  reasoningEffort?: string;
  version?: string;
  error?: string;
}

interface EditorState {
  tree: TaskTree;
  history: HistoryEntry[];
  future: HistoryEntry[];
  notice: EditorNotice | null;
  activeRun: ActiveRun | null;
  runSummary: RunSummary | null;
  runLogs: RunLogEntry[];
  activityOpen: boolean;
  modelHealth: ModelHealthState;
  commitTree: (nextTree: TaskTree, label: string) => void;
  reviseTask: (
    taskId: string,
    patch: Partial<RevisableTaskFields>,
    label?: string,
  ) => void;
  setOperator: (taskId: string, operator: Operator) => void;
  clearOperator: (taskId: string) => void;
  replaceTree: (tree: TaskTree, notice?: EditorNotice) => void;
  restoreWorkspace: (
    tree: TaskTree,
    history: HistoryEntry[],
    future: HistoryEntry[],
  ) => void;
  newTree: () => void;
  undo: () => void;
  redo: () => void;
  setNotice: (notice: EditorNotice | null) => void;
  beginRun: (
    runId: string,
    action: RunAction,
    targetTaskId: string,
  ) => void;
  applyRunEvent: (event: RunEvent) => void;
  cancelActiveRun: () => void;
  failActiveRun: (message: string) => void;
  clearRun: () => void;
  setActivityOpen: (open: boolean) => void;
  toggleActivityOpen: () => void;
  setModelHealth: (health: ModelHealthState) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tree: createEmptyTree(),
  history: [],
  future: [],
  notice: null,
  activeRun: null,
  runSummary: null,
  runLogs: [],
  activityOpen: false,
  modelHealth: {
    status: "checking",
    name: "gpt-5.3-codex-spark",
    runtime: "Codex app-server",
    provider: "OpenAI",
    reasoningEffort: "xhigh",
  },

  commitTree: (nextTree, label) =>
    set((state) => {
      const parsed = parseTaskTree(nextTree);
      const [tree, patches, inversePatches] = produceWithPatches(
        state.tree,
        () => parsed,
      );
      if (patches.length === 0) return state;
      return {
        ...state,
        tree,
        history: [...state.history, { label, patches, inversePatches }],
        future: [],
      };
    }),

  reviseTask: (taskId, patch, label = "Edit Task") =>
    set((state) => {
      const revised = reviseTask(state.tree, taskId, patch);
      const [tree, patches, inversePatches] = produceWithPatches(
        state.tree,
        () => revised,
      );
      if (patches.length === 0) return state;
      return {
        ...state,
        tree,
        history: [...state.history, { label, patches, inversePatches }],
        future: [],
      };
    }),

  setOperator: (taskId, operator) =>
    set((state) => {
      const revised = declareOperator(state.tree, taskId, operator);
      const [tree, patches, inversePatches] = produceWithPatches(
        state.tree,
        () => revised,
      );
      return {
        ...state,
        tree,
        history: [
          ...state.history,
          { label: "Define Operator", patches, inversePatches },
        ],
        future: [],
      };
    }),

  clearOperator: (taskId) =>
    set((state) => {
      const revised = clearOperator(state.tree, taskId);
      const [tree, patches, inversePatches] = produceWithPatches(
        state.tree,
        () => revised,
      );
      return {
        ...state,
        tree,
        history: [
          ...state.history,
          { label: "Clear Operator", patches, inversePatches },
        ],
        future: [],
      };
    }),

  replaceTree: (tree, notice) =>
    set({
      tree: parseTaskTree(tree),
      history: [],
      future: [],
      notice: notice ?? null,
    }),

  restoreWorkspace: (tree, history, future) =>
    set({
      tree: parseTaskTree(tree),
      history,
      future,
      activeRun: null,
      runSummary: null,
      runLogs: [],
    }),

  newTree: () =>
    set({
      tree: createEmptyTree(),
      history: [],
      future: [],
      notice: { kind: "info", message: "Started a new planning brief." },
    }),

  undo: () =>
    set((state) => {
      const entry = state.history.at(-1);
      if (!entry) return state;
      return {
        ...state,
        tree: applyPatches(state.tree, entry.inversePatches),
        history: state.history.slice(0, -1),
        future: [entry, ...state.future],
        notice: { kind: "info", message: `Undid: ${entry.label}` },
      };
    }),

  redo: () =>
    set((state) => {
      const [entry, ...future] = state.future;
      if (!entry) return state;
      return {
        ...state,
        tree: applyPatches(state.tree, entry.patches),
        history: [...state.history, entry],
        future,
        notice: { kind: "info", message: `Redid: ${entry.label}` },
      };
    }),

  setNotice: (notice) => set({ notice }),

  beginRun: (runId, action, targetTaskId) =>
    set((state) => ({
      activeRun: {
        id: runId,
        action,
        targetTaskId,
        baseTree: structuredClone(state.tree),
        overlayTree: structuredClone(state.tree),
        attempt: 0,
        maxAttempts: 3,
        newTaskIds: [],
        changedFields: {},
        ghostBranches: [],
      },
      runSummary: {
        id: runId,
        action,
        targetTaskId,
        state: "running",
        attempt: 0,
        maxAttempts: 3,
      },
      runLogs: [],
      activityOpen: true,
      notice: null,
    })),

  applyRunEvent: (event) =>
    set((state) => {
      const active = state.activeRun;
      const log = eventToLog(event);
      const runLogs = log ? [...state.runLogs, log] : state.runLogs;

      if (!active || active.id !== event.runId) {
        return { ...state, runLogs };
      }

      let nextActive = { ...active };
      const payload = event.payload as Record<string, unknown>;
      try {
        switch (event.type) {
          case "attempt.started": {
            const base = parseTaskTree(payload.tree);
            nextActive = {
              ...nextActive,
              baseTree: base,
              overlayTree: structuredClone(base),
              attempt: Number(payload.attempt ?? event.attempt),
              maxAttempts: Number(payload.maxAttempts ?? 3),
              newTaskIds: [],
              changedFields: {},
              ghostBranches: [],
            };
            break;
          }
          case "task.added": {
            const task = payload.task as Task;
            nextActive.overlayTree = addSubtask(
              nextActive.overlayTree,
              String(payload.parentId),
              task.title,
              payload.afterSiblingId as string | null | undefined,
              task.id,
            ).tree;
            nextActive.newTaskIds = [...nextActive.newTaskIds, task.id];
            break;
          }
          case "task.revised": {
            const taskId = String(payload.taskId);
            const patch = payload.patch as Partial<RevisableTaskFields> & {
              operator?: null;
            };
            if (patch.operator === null) {
              nextActive.overlayTree = clearOperator(
                nextActive.overlayTree,
                taskId,
              );
              nextActive.changedFields = addChangedField(
                nextActive,
                taskId,
                "operator",
              );
            } else {
              nextActive.overlayTree = reviseTask(
                nextActive.overlayTree,
                taskId,
                patch,
              );
              Object.keys(patch).forEach((field) => {
                nextActive.changedFields = addChangedField(
                  nextActive,
                  taskId,
                  field,
                );
              });
            }
            break;
          }
          case "operator.declared": {
            const taskId = String(payload.taskId);
            nextActive.overlayTree = declareOperator(
              nextActive.overlayTree,
              taskId,
              payload.operator as Operator,
            );
            nextActive.changedFields = addChangedField(
              nextActive,
              taskId,
              "operator",
            );
            break;
          }
          case "subtree.moved": {
            nextActive.overlayTree = moveSubtree(
              nextActive.overlayTree,
              String(payload.taskId),
              String(payload.newParentId),
              payload.afterSiblingId as string | null | undefined,
            );
            break;
          }
          case "collapse.staged": {
            const taskId = String(payload.taskId);
            const selected = findTask(nextActive.overlayTree, taskId)?.task;
            if (selected) {
              const branches = selected.children.map((task, index) => ({
                task: structuredClone(task),
                parentId: taskId,
                order: index + 1,
              }));
              const collapsed = collapseTask(
                nextActive.overlayTree,
                taskId,
              );
              nextActive.overlayTree = collapsed.tree;
              nextActive.ghostBranches = [
                ...nextActive.ghostBranches,
                ...branches,
              ];
            }
            break;
          }
          case "run.completed": {
            const finalTree = parseTaskTree(payload.tree);
            const [tree, patches, inversePatches] = produceWithPatches(
              state.tree,
              () => finalTree,
            );
            return {
              ...state,
              tree,
              history: [
                ...state.history,
                {
                  label: runLabel(active.action),
                  patches,
                  inversePatches,
                },
              ],
              future: [],
              activeRun: null,
              runSummary: {
                ...state.runSummary!,
                state: "completed",
                attempt: event.attempt,
              },
              runLogs,
              notice: {
                kind: "success",
                message: `${runLabel(active.action)} completed and was added to undo history.`,
              },
            };
          }
          case "run.failed":
          case "run.cancelled": {
            return {
              ...state,
              activeRun: null,
              runSummary: {
                ...state.runSummary!,
                state:
                  event.type === "run.failed" ? "failed" : "cancelled",
                attempt: event.attempt,
              },
              runLogs,
              activityOpen: true,
              notice: {
                kind: event.type === "run.failed" ? "error" : "info",
                message:
                  event.type === "run.failed"
                    ? "The Run failed after retries. In-progress edits were undone."
                    : "The Run was cancelled. In-progress edits were undone.",
              },
            };
          }
        }
      } catch (error) {
        return {
          ...state,
          runLogs: [
            ...runLogs,
            {
              id: `${event.sequence}-client-error`,
              type: "tool.rejected",
              level: "error",
              title: "Could not materialize an edit",
              detail:
                error instanceof Error ? error.message : "Unknown client error",
              attempt: event.attempt,
              timestamp: event.timestamp,
            },
          ],
          activityOpen: true,
        };
      }

      return {
        ...state,
        activeRun: nextActive,
        runSummary: state.runSummary
          ? {
              ...state.runSummary,
              attempt: nextActive.attempt,
              maxAttempts: nextActive.maxAttempts,
            }
          : null,
        runLogs,
      };
    }),

  cancelActiveRun: () =>
    set((state) => {
      if (!state.activeRun) return state;
      const timestamp = new Date().toISOString();
      return {
        ...state,
        activeRun: null,
        runSummary: state.runSummary
          ? { ...state.runSummary, state: "cancelled" }
          : null,
        runLogs: [
          ...state.runLogs,
          {
            id: `local-cancel-${timestamp}`,
            type: "run.cancelled",
            level: "warning",
            title: "Run cancelled",
            detail: "In-progress edits were undone.",
            attempt: state.activeRun.attempt,
            timestamp,
          },
        ],
        activityOpen: true,
        notice: {
          kind: "info",
          message: "The Run was cancelled. In-progress edits were undone.",
        },
      };
    }),

  failActiveRun: (message) =>
    set((state) => {
      if (!state.activeRun) return state;
      const timestamp = new Date().toISOString();
      return {
        ...state,
        activeRun: null,
        runSummary: state.runSummary
          ? {
              ...state.runSummary,
              state: "failed",
              attempt: state.activeRun.attempt,
            }
          : null,
        runLogs: [
          ...state.runLogs,
          {
            id: `local-failure-${timestamp}`,
            type: "run.failed",
            level: "error",
            title: "Run connection lost",
            detail: message,
            attempt: state.activeRun.attempt,
            timestamp,
          },
        ],
        activityOpen: true,
        notice: {
          kind: "error",
          message: `${message} In-progress edits were undone.`,
        },
      };
    }),

  clearRun: () =>
    set({
      activeRun: null,
      runSummary: null,
      runLogs: [],
      activityOpen: false,
    }),

  setActivityOpen: (activityOpen) => set({ activityOpen }),
  toggleActivityOpen: () =>
    set((state) => ({ activityOpen: !state.activityOpen })),
  setModelHealth: (modelHealth) => set({ modelHealth }),
}));

function addChangedField(
  active: ActiveRun,
  taskId: string,
  field: string,
): Record<string, string[]> {
  if (!findTask(active.baseTree, taskId)) return active.changedFields;
  const current = active.changedFields[taskId] ?? [];
  if (current.includes(field)) return active.changedFields;
  return {
    ...active.changedFields,
    [taskId]: [...current, field],
  };
}

function runLabel(action: RunAction): string {
  return action === "populate"
    ? "Generate Goals & Inputs"
    : action === "decompose"
    ? "Decompose"
    : action === "optimize"
      ? "Optimize Subtree"
      : "Collapse Task";
}

function eventToLog(event: RunEvent): RunLogEntry | null {
  const payload = event.payload as Record<string, unknown>;
  const base = {
    id: `${event.sequence}`,
    type: event.type,
    attempt: event.attempt,
    timestamp: event.timestamp,
  };
  switch (event.type) {
    case "run.started":
      return {
        ...base,
        level: "info",
        title: `${runLabel(payload.action as RunAction)} started`,
        detail: String(payload.model ?? ""),
      };
    case "attempt.started":
      return {
        ...base,
        level: "info",
        title: `Attempt ${payload.attempt} of ${payload.maxAttempts}`,
        detail:
          Number(payload.attempt) > 1
            ? "Restored the original tree before retrying."
            : "Draft overlay created.",
      };
    case "task.added":
      return {
        ...base,
        level: "success",
        title: `Added ${(payload.task as Task).title}`,
        detail: "Created and linked an ordered subtask.",
      };
    case "task.revised":
      return {
        ...base,
        level: "success",
        title: "Revised Task fields",
        detail: Object.keys(
          (payload.patch as Record<string, unknown>) ?? {},
        ).join(", "),
      };
    case "operator.declared":
      return {
        ...base,
        level: "success",
        title: `Declared ${(payload.operator as Operator).name}`,
        detail: `Executor: ${(payload.operator as Operator).executor}`,
      };
    case "subtree.moved":
      return {
        ...base,
        level: "success",
        title: "Moved a subtree",
        detail: "Ordering and parentage were updated.",
      };
    case "collapse.staged":
      return {
        ...base,
        level: "warning",
        title: "Staged descendants for Collapse",
        detail: `${(payload.removedTaskIds as string[])?.length ?? 0} Tasks will be removed after validation.`,
      };
    case "tool.rejected":
      return {
        ...base,
        level: "error",
        title: `Rejected ${payload.tool ?? "edit"}`,
        detail: String(payload.message ?? ""),
      };
    case "validation.started":
      return {
        ...base,
        level: "info",
        title: `${String(payload.phase ?? "Run")} validation`,
        detail: "Checking the draft before commit.",
      };
    case "validation.failed":
      return {
        ...base,
        level: "error",
        title: `${String(payload.phase ?? "Run")} validation failed`,
        detail: issueSummary(payload.issues),
      };
    case "validation.warning":
      return {
        ...base,
        level: "warning",
        title: "Validation warning",
        detail: String(payload.message ?? ""),
      };
    case "attempt.failed":
      return {
        ...base,
        level: "error",
        title: `Attempt ${event.attempt} failed`,
        detail: String(payload.message ?? ""),
      };
    case "attempt.retrying":
      return {
        ...base,
        level: "warning",
        title: `Retrying with attempt ${payload.nextAttempt}`,
        detail: "The partial draft will be discarded first.",
      };
    case "run.completed":
      return {
        ...base,
        level: "success",
        title: "Run completed",
        detail: "Validation passed. The draft was committed.",
      };
    case "run.failed":
      return {
        ...base,
        level: "error",
        title: "Run failed",
        detail: String(payload.message ?? ""),
      };
    case "run.cancelled":
      return {
        ...base,
        level: "warning",
        title: "Run cancelled",
        detail: String(payload.message ?? ""),
      };
    default:
      return null;
  }
}

function issueSummary(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .slice(0, 3)
    .map((issue) =>
      typeof issue === "object" && issue && "message" in issue
        ? String(issue.message)
        : String(issue),
    )
    .join(" ");
}
