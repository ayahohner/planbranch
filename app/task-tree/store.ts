"use client";

import {
  applyPatches,
  enablePatches,
  produceWithPatches,
  type Patch,
} from "immer";
import { create } from "zustand";
import {
  clearOperator,
  createEmptyTree,
  declareOperator,
  parseTaskTree,
  reviseTask,
  type Operator,
  type RevisableTaskFields,
  type TaskTree,
} from "../../packages/domain/src";

enablePatches();

interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
}

export interface EditorNotice {
  kind: "success" | "error" | "info";
  message: string;
}

interface EditorState {
  tree: TaskTree;
  history: HistoryEntry[];
  future: HistoryEntry[];
  notice: EditorNotice | null;
  commitTree: (nextTree: TaskTree, label: string) => void;
  reviseTask: (
    taskId: string,
    patch: Partial<RevisableTaskFields>,
    label?: string,
  ) => void;
  setOperator: (taskId: string, operator: Operator) => void;
  clearOperator: (taskId: string) => void;
  replaceTree: (tree: TaskTree, notice?: EditorNotice) => void;
  newTree: () => void;
  undo: () => void;
  redo: () => void;
  setNotice: (notice: EditorNotice | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tree: createEmptyTree(),
  history: [],
  future: [],
  notice: null,

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
}));
