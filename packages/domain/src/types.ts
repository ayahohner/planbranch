export type Executor = "llm" | "deterministic";

export interface Operator {
  executor: Executor;
  name: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  inputs: string[];
  outputs: string[];
  operator?: Operator;
  children: Task[];
}

export interface RootTask extends Task {
  goals: string[];
}

export interface TaskTree {
  schemaVersion: 1;
  root: RootTask;
}

export type TaskKind = "compound" | "primitive" | "unresolved";
export type RunAction = "populate" | "decompose" | "optimize" | "collapse";

export type RevisableTaskFields = Pick<
  Task,
  "title" | "description" | "inputs" | "outputs"
> & {
  goals?: string[];
};

export interface ValidationIssue {
  code: string;
  message: string;
  path: string;
  severity: "error" | "warning";
}

export const runEventTypes = [
  "run.started",
  "attempt.started",
  "task.added",
  "task.revised",
  "operator.declared",
  "subtree.moved",
  "collapse.staged",
  "tool.rejected",
  "validation.started",
  "validation.failed",
  "validation.warning",
  "attempt.failed",
  "attempt.retrying",
  "run.completed",
  "run.failed",
  "run.cancelled",
] as const;

export type RunEventType = (typeof runEventTypes)[number];

export interface RunEvent<T = Record<string, unknown>> {
  runId: string;
  attempt: number;
  sequence: number;
  timestamp: string;
  type: RunEventType;
  payload: T;
}

export interface StartRunRequest {
  action: RunAction;
  tree: TaskTree;
  targetTaskId: string;
  model?: string;
  reasoningEffort?: string;
}

export interface ReasoningEffortOption {
  reasoningEffort: string;
  description?: string;
}

export interface ModelOption {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  hidden: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts: ReasoningEffortOption[];
  isDefault: boolean;
}

export interface StartRunResponse {
  runId: string;
}
