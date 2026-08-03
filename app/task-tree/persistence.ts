import { z } from "zod";
import { taskTreeSchema, type TaskTree } from "../../packages/domain/src";

export const WORKSPACE_STORAGE_KEY = "task-tree.workspace.v1";
export const MODEL_SELECTION_STORAGE_KEY = "planbranch.model-selection.v1";

const patchSchema = z
  .object({
    op: z.enum(["replace", "remove", "add"]),
    path: z.array(z.union([z.string(), z.number()])),
    value: z.unknown().optional(),
  })
  .strict();

const historyEntrySchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    patches: z.array(patchSchema).max(10_000),
    inversePatches: z.array(patchSchema).max(10_000),
  })
  .strict();

const persistedWorkspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    tree: taskTreeSchema,
    history: z.array(historyEntrySchema).max(500),
    future: z.array(historyEntrySchema).max(500),
  })
  .strict();

export type PersistedHistoryEntry = z.infer<typeof historyEntrySchema>;

export interface PersistedWorkspace {
  schemaVersion: 1;
  tree: TaskTree;
  history: PersistedHistoryEntry[];
  future: PersistedHistoryEntry[];
}

const modelSelectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    model: z.string().trim().min(1).max(200),
    reasoningEffort: z.string().trim().min(1).max(50),
  })
  .strict();

export type PersistedModelSelection = z.infer<typeof modelSelectionSchema>;

export function serializeWorkspace(
  workspace: Omit<PersistedWorkspace, "schemaVersion">,
): string {
  return JSON.stringify({
    schemaVersion: 1,
    ...workspace,
  } satisfies PersistedWorkspace);
}

export function parsePersistedWorkspace(source: string): PersistedWorkspace {
  return persistedWorkspaceSchema.parse(JSON.parse(source));
}

export function serializeModelSelection(
  selection: Omit<PersistedModelSelection, "schemaVersion">,
): string {
  return JSON.stringify({
    schemaVersion: 1,
    ...selection,
  } satisfies PersistedModelSelection);
}

export function parsePersistedModelSelection(
  source: string,
): PersistedModelSelection {
  return modelSelectionSchema.parse(JSON.parse(source));
}
