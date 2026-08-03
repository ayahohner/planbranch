import { z } from "zod";
import {
  addSubtask,
  addSubtaskInputSchema,
  clearOperator,
  collapseTask,
  collapseTaskInputSchema,
  createRunEvent,
  declareOperator,
  declareOperatorInputSchema,
  deriveTaskKind,
  findTask,
  finishRunInputSchema,
  getSubtreeIds,
  moveSubtree,
  moveSubtreeInputSchema,
  parseTaskTree,
  reviseTask,
  reviseTaskInputSchema,
  toolsByAction,
  validateTaskTree,
  type RunAction,
  type RunEvent,
  type RunEventType,
  type StartRunRequest,
  type Task,
  type TaskTree,
  type ValidationIssue,
} from "../packages/domain/src";
import type { ServerConfig } from "./config";
import type {
  Message,
  ModelClient,
  ToolCall,
} from "./model";
import {
  buildActionPrompt,
  buildSemanticAuditPrompt,
  planningSystemPrompt,
  semanticAuditFormat,
} from "./prompts";

const semanticAuditSchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(
      z.object({
        severity: z.enum(["error", "warning"]),
        message: z.string().min(1),
        taskId: z.string().nullable(),
      }),
    ),
  })
  .strict();

class AttemptFailure extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = "AttemptFailure";
  }
}

type RunState = "running" | "completed" | "failed" | "cancelled";
type RunListener = (event: RunEvent) => void;

export interface RunSnapshot {
  id: string;
  state: RunState;
  events: RunEvent[];
}

class ManagedRun {
  readonly abortController = new AbortController();
  readonly events: RunEvent[] = [];
  readonly listeners = new Set<RunListener>();
  readonly completion: Promise<RunSnapshot>;
  private resolveCompletion!: (snapshot: RunSnapshot) => void;
  private sequence = 0;
  attempt = 0;
  state: RunState = "running";

  constructor(
    readonly id: string,
    readonly request: StartRunRequest,
  ) {
    this.completion = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  emit<T>(type: RunEventType, payload: T): RunEvent<T> {
    const event = createRunEvent(
      this.id,
      this.attempt,
      ++this.sequence,
      type,
      payload,
    );
    this.events.push(event as RunEvent);
    this.listeners.forEach((listener) => listener(event as RunEvent));
    return event;
  }

  finish(state: Exclude<RunState, "running">) {
    this.state = state;
    this.resolveCompletion(this.snapshot());
  }

  snapshot(): RunSnapshot {
    return { id: this.id, state: this.state, events: [...this.events] };
  }

  subscribe(afterSequence: number, listener: RunListener): () => void {
    this.events
      .filter((event) => event.sequence > afterSequence)
      .forEach(listener);
    if (this.state === "running") {
      this.listeners.add(listener);
    }
    return () => this.listeners.delete(listener);
  }
}

interface AttemptContext {
  action: RunAction;
  original: TaskTree;
  draft: TaskTree;
  targetTaskId: string;
  run: ManagedRun;
  rejectedTools: number;
  finished: boolean;
  populatedFields: Set<"goals" | "inputs">;
  toolResultsByCallId: Map<string, Record<string, unknown>>;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  );
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("The Run was cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function shallowTaskSnapshot(task: Task, root: TaskTree["root"]) {
  return {
    title: task.title,
    description: task.description,
    inputs: task.inputs,
    outputs: task.outputs,
    operator: task.operator,
    goals: task.id === root.id ? root.goals : undefined,
    childIds: task.children.map((child) => child.id),
  };
}

function findTaskOrFail(tree: TaskTree, taskId: string): Task {
  const task = findTask(tree, taskId)?.task;
  if (!task) {
    throw new AttemptFailure(`Task ${taskId} does not exist.`);
  }
  return task;
}

function assertFrozenTasksPreserved(
  original: TaskTree,
  draft: TaskTree,
  targetTaskId: string,
) {
  const writableIds = getSubtreeIds(original, targetTaskId);
  const visit = (task: Task) => {
    if (!writableIds.has(task.id)) {
      const current = findTask(draft, task.id)?.task;
      if (!current) {
        throw new AttemptFailure(
          `Frozen Task ${task.id} was removed from the tree.`,
        );
      }
      const before = shallowTaskSnapshot(task, original.root);
      const after = shallowTaskSnapshot(current, draft.root);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new AttemptFailure(
          `Frozen Task ${task.id} changed outside the writable scope.`,
        );
      }
    }
    task.children.forEach(visit);
  };
  visit(original.root);
}

function assertPopulateScopePreserved(original: TaskTree, draft: TaskTree) {
  const frozenSnapshot = (tree: TaskTree) => ({
    id: tree.root.id,
    title: tree.root.title,
    description: tree.root.description,
    outputs: tree.root.outputs,
    operator: tree.root.operator,
    children: tree.root.children,
  });
  const originalFrozen = frozenSnapshot(original);
  const draftFrozen = frozenSnapshot(draft);
  if (JSON.stringify(originalFrozen) !== JSON.stringify(draftFrozen)) {
    throw new AttemptFailure(
      "Populate Root Brief may change only the Root Goals and Inputs.",
    );
  }
}

function unresolvedWarnings(
  tree: TaskTree,
  targetTaskId: string,
): ValidationIssue[] {
  const target = findTaskOrFail(tree, targetTaskId);
  const issues: ValidationIssue[] = [];
  const visit = (task: Task) => {
    if (deriveTaskKind(task) === "unresolved") {
      issues.push({
        code: "UNRESOLVED_TASK",
        message: `${task.title} remains Unresolved.`,
        path: task.id,
        severity: "warning",
      });
    }
    task.children.forEach(visit);
  };
  visit(target);
  return issues;
}

function decompositionCompletenessIssues(
  context: AttemptContext,
): ValidationIssue[] {
  if (context.action !== "decompose" && context.action !== "optimize") {
    return [];
  }

  const target = findTaskOrFail(context.draft, context.targetTaskId);
  const issues: ValidationIssue[] = [];
  const visit = (task: Task) => {
    const isTarget = task.id === context.targetTaskId;
    const requiresOwnFields = !isTarget || task.children.length === 0;

    if (requiresOwnFields && !task.description.trim()) {
      issues.push({
        code: "MISSING_TASK_DESCRIPTION",
        message: `${task.title} needs a description before the Run can finish.`,
        path: task.id,
        severity: "error",
      });
    }
    if (requiresOwnFields && task.inputs.length === 0) {
      issues.push({
        code: "MISSING_TASK_INPUT",
        message: `${task.title} needs at least one input Artifact Label.`,
        path: task.id,
        severity: "error",
      });
    }
    if (requiresOwnFields && task.outputs.length === 0) {
      issues.push({
        code: "MISSING_TASK_OUTPUT",
        message: `${task.title} needs at least one output Artifact Label.`,
        path: task.id,
        severity: "error",
      });
    }
    if (task.children.length === 0 && !task.operator) {
      issues.push({
        code: "MISSING_OPERATOR",
        message: `${task.title} must have a direct Operator or be decomposed further.`,
        path: task.id,
        severity: "error",
      });
    }
    task.children.forEach(visit);
  };
  visit(target);
  return issues;
}

function parseToolArguments<T>(
  schema: z.ZodType<T>,
  call: ToolCall,
): T {
  const result = schema.safeParse(call.function.arguments);
  if (result.success) return result.data;

  const unsupported = result.error.issues.flatMap((issue) =>
    issue.code === "unrecognized_keys" ? issue.keys : [],
  );
  if (unsupported.length > 0) {
    const allowed =
      call.function.name === "add_subtask"
        ? "parent_id, after_sibling_id, and title"
        : call.function.name === "revise_task"
          ? "task_id and exactly one of title, description, inputs, outputs, or goals"
          : "the fields declared by the tool";
    throw new AttemptFailure(
      `${call.function.name} accepts only ${allowed}. Unsupported: ${unsupported.join(", ")}.`,
    );
  }

  if (
    result.error.issues.some((issue) =>
      issue.message.includes("Artifact Labels"),
    )
  ) {
    throw new AttemptFailure(
      'Artifact Labels must capitalize every word, for example "Running Water" and "Clean Body".',
    );
  }

  throw new AttemptFailure(
    result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? ` (${issue.path.join(".")})` : "";
        return `${issue.message}${path}`;
      })
      .join(" "),
  );
}

function parseStructuredJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  const embedded =
    objectStart >= 0 && objectEnd > objectStart
      ? trimmed.slice(objectStart, objectEnd + 1)
      : undefined;
  const candidates = [trimmed, fenced, embedded].filter(
    (candidate): candidate is string => Boolean(candidate),
  );

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next bounded representation.
    }
  }
  throw new SyntaxError("The model response did not contain valid JSON.");
}

export class RunManager {
  private readonly runs = new Map<string, ManagedRun>();

  constructor(
    private readonly model: ModelClient,
    private readonly config: ServerConfig,
    private readonly idFactory: () => string = () => crypto.randomUUID(),
  ) {}

  start(request: StartRunRequest): RunSnapshot {
    const tree = parseTaskTree(request.tree);
    findTaskOrFail(tree, request.targetTaskId);
    if (request.action === "populate") {
      if (request.targetTaskId !== tree.root.id) {
        throw new AttemptFailure(
          "Populate Root Brief is available only on the Root Task.",
        );
      }
      if (!tree.root.title.trim() || !tree.root.description.trim()) {
        throw new AttemptFailure(
          "Add a Root Title and Description before generating Goals and Inputs.",
        );
      }
    }
    const run = new ManagedRun(this.idFactory(), {
      ...request,
      tree,
    });
    this.runs.set(run.id, run);
    run.emit("run.started", {
      action: request.action,
      targetTaskId: request.targetTaskId,
      model: request.model ?? this.config.modelName,
      runtime: this.config.modelRuntime,
      provider: this.config.modelProvider,
    });
    void this.execute(run);
    return run.snapshot();
  }

  get(runId: string): RunSnapshot | null {
    return this.runs.get(runId)?.snapshot() ?? null;
  }

  getManaged(runId: string): ManagedRun | null {
    return this.runs.get(runId) ?? null;
  }

  waitForRun(runId: string): Promise<RunSnapshot> {
    const run = this.runs.get(runId);
    if (!run) {
      return Promise.reject(new Error(`Run ${runId} does not exist.`));
    }
    return run.state === "running"
      ? run.completion
      : Promise.resolve(run.snapshot());
  }

  cancel(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.state !== "running") return false;
    run.abortController.abort();
    return true;
  }

  private async execute(run: ManagedRun) {
    const signal = run.abortController.signal;
    let lastError = "The model Run failed.";

    try {
      for (
        let attempt = 1;
        attempt <= this.config.maxAttempts;
        attempt += 1
      ) {
        run.attempt = attempt;
        run.emit("attempt.started", {
          tree: run.request.tree,
          attempt,
          maxAttempts: this.config.maxAttempts,
        });

        try {
          const finalTree = await this.executeAttempt(run);
          run.emit("run.completed", { tree: finalTree });
          run.finish("completed");
          return;
        } catch (error) {
          if (isAbortError(error) || signal.aborted) {
            run.emit("run.cancelled", {
              message: "The Run was cancelled. In-progress edits were undone.",
            });
            run.finish("cancelled");
            return;
          }
          lastError =
            error instanceof Error ? error.message : "Unknown model error";
          const issues =
            error instanceof AttemptFailure ? error.issues : undefined;
          run.emit("attempt.failed", {
            message: lastError,
            issues,
          });
          if (attempt < this.config.maxAttempts) {
            run.emit("attempt.retrying", {
              nextAttempt: attempt + 1,
              maxAttempts: this.config.maxAttempts,
            });
            await delay(250 * attempt, signal);
          }
        }
      }

      run.emit("run.failed", {
        message: lastError,
        attempts: this.config.maxAttempts,
      });
      run.finish("failed");
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        run.emit("run.cancelled", {
          message: "The Run was cancelled. In-progress edits were undone.",
        });
        run.finish("cancelled");
        return;
      }
      run.emit("run.failed", {
        message: error instanceof Error ? error.message : "Unknown Run error",
        attempts: run.attempt,
      });
      run.finish("failed");
    }
  }

  private async executeAttempt(run: ManagedRun): Promise<TaskTree> {
    const original = structuredClone(run.request.tree);
    const context: AttemptContext = {
      action: run.request.action,
      original,
      draft: structuredClone(original),
      targetTaskId: run.request.targetTaskId,
      run,
      rejectedTools: 0,
      finished: false,
      populatedFields: new Set(),
      toolResultsByCallId: new Map(),
    };

    if (
      context.action === "decompose" &&
      deriveTaskKind(findTaskOrFail(context.draft, context.targetTaskId)) ===
        "primitive"
    ) {
      context.draft = clearOperator(context.draft, context.targetTaskId);
      run.emit("task.revised", {
        taskId: context.targetTaskId,
        patch: { operator: null },
      });
    }

    if (context.action === "collapse") {
      const collapsed = collapseTask(context.draft, context.targetTaskId);
      context.draft = collapsed.tree;
      run.emit("collapse.staged", {
        taskId: context.targetTaskId,
        removedTaskIds: collapsed.removedTaskIds,
      });
    }

    const messages: Message[] = [
      { role: "system", content: planningSystemPrompt },
      {
        role: "user",
        content: buildActionPrompt(
          context.action,
          original,
          context.targetTaskId,
        ),
      },
    ];
    const tools = [...toolsByAction[context.action]];
    let toolCallCount = 0;
    const response = await this.model.runChat(
      {
        model: run.request.model ?? this.config.modelName,
        messages,
        tools,
        reasoningEffort:
          run.request.reasoningEffort ?? this.config.modelReasoningEffort,
      },
      run.abortController.signal,
      (call) => {
        if (call.id) {
          const cached = context.toolResultsByCallId.get(call.id);
          if (cached) return cached;
        }
        toolCallCount += 1;
        if (toolCallCount > this.config.maxToolCalls) {
          throw new AttemptFailure(
            "The model exceeded the Run tool-call budget.",
          );
        }
        let result: Record<string, unknown>;
        try {
          result = this.applyTool(context, call);
        } catch (error) {
          context.rejectedTools += 1;
          const message =
            error instanceof Error ? error.message : "Unknown tool error";
          run.emit("tool.rejected", {
            tool: call.function.name,
            message,
            rejectedCount: context.rejectedTools,
            maxRejectedTools: this.config.maxRejectedTools,
          });
          result = { ok: false, error: message };
          if (context.rejectedTools >= this.config.maxRejectedTools) {
            throw new AttemptFailure(
              `The model exceeded the rejected-edit limit: ${message}`,
            );
          }
        }
        if (call.id) context.toolResultsByCallId.set(call.id, result);
        return result;
      },
    );

    if (response.toolCalls.length === 0) {
      throw new AttemptFailure(
        "The model stopped before calling a Planbranch tool.",
      );
    }
    if (!context.finished) {
      throw new AttemptFailure(
        "The model stopped before calling finish_run.",
      );
    }
    return this.validateAttempt(context);
  }

  private assertWritable(context: AttemptContext, taskId: string) {
    if (context.action === "populate") {
      if (taskId !== context.original.root.id) {
        throw new AttemptFailure(
          "Populate Root Brief may revise only the Root Task.",
        );
      }
      return;
    }
    if (context.action === "collapse") {
      if (taskId !== context.targetTaskId) {
        throw new AttemptFailure(
          "A Collapse Run may revise only its selected Task.",
        );
      }
      return;
    }
    if (
      !getSubtreeIds(context.draft, context.targetTaskId).has(taskId)
    ) {
      throw new AttemptFailure(
        `Task ${taskId} is outside the writable subtree.`,
      );
    }
  }

  private applyTool(
    context: AttemptContext,
    call: ToolCall,
  ): Record<string, unknown> {
    const name = call.function.name;
    const allowed = new Set(
      toolsByAction[context.action].map((tool) => tool.function.name),
    );
    if (!allowed.has(name as never)) {
      throw new AttemptFailure(
        `Tool ${name} is unavailable for ${context.action}.`,
      );
    }

    switch (name) {
      case "add_subtask": {
        const input = parseToolArguments(addSubtaskInputSchema, call);
        this.assertWritable(context, input.parent_id);
        const result = addSubtask(
          context.draft,
          input.parent_id,
          input.title,
          input.after_sibling_id,
          this.idFactory(),
        );
        context.draft = result.tree;
        context.run.emit("task.added", {
          parentId: input.parent_id,
          afterSiblingId: input.after_sibling_id,
          task: result.task,
        });
        return { ok: true, task_id: result.task.id };
      }
      case "revise_task": {
        const input = parseToolArguments(reviseTaskInputSchema, call);
        this.assertWritable(context, input.task_id);
        const {
          task_id: taskId,
          title,
          description,
          inputs,
          outputs,
          goals,
        } = input;
        if (context.action === "populate") {
          const hasGoals = goals !== undefined;
          const hasInputs = inputs !== undefined;
          if (
            title !== undefined ||
            description !== undefined ||
            outputs !== undefined ||
            hasGoals === hasInputs
          ) {
            throw new AttemptFailure(
              "Populate Root Brief requires exactly one field per revise_task call: goals or inputs.",
            );
          }
          const field = hasGoals ? "goals" : "inputs";
          if (context.populatedFields.has(field)) {
            throw new AttemptFailure(
              `Populate Root Brief may revise ${field} only once.`,
            );
          }
          if (field === "inputs" && !context.populatedFields.has("goals")) {
            throw new AttemptFailure(
              "Populate Root Brief must revise goals before inputs.",
            );
          }
          if (goals && goals.length > 8) {
            throw new AttemptFailure(
              "Populate Root Brief accepts at most 8 Goals.",
            );
          }
          if (inputs && inputs.length > 12) {
            throw new AttemptFailure(
              "Populate Root Brief accepts at most 12 Inputs.",
            );
          }
          context.populatedFields.add(field);
        }
        const patch = { title, description, inputs, outputs, goals };
        const currentTask = findTaskOrFail(context.draft, taskId);
        const suppliedField = Object.entries({
          title,
          description,
          inputs,
          outputs,
          goals,
        }).find(([, value]) => value !== undefined);
        if (suppliedField) {
          const [field, value] = suppliedField;
          const currentValue =
            field === "goals" ? context.draft.root.goals : currentTask[field as keyof Task];
          if (JSON.stringify(currentValue) === JSON.stringify(value)) {
            return { ok: true, unchanged: true };
          }
        }
        context.draft = reviseTask(context.draft, taskId, patch);
        context.run.emit("task.revised", { taskId, patch });
        return { ok: true };
      }
      case "declare_operator": {
        const input = parseToolArguments(declareOperatorInputSchema, call);
        this.assertWritable(context, input.task_id);
        const task = findTaskOrFail(context.draft, input.task_id);
        if (
          task.operator?.executor === input.executor &&
          task.operator.name === input.operator
        ) {
          return { ok: true, unchanged: true };
        }
        context.draft = declareOperator(context.draft, input.task_id, {
          executor: input.executor,
          name: input.operator,
        });
        context.run.emit("operator.declared", {
          taskId: input.task_id,
          operator: {
            executor: input.executor,
            name: input.operator,
          },
        });
        return { ok: true };
      }
      case "move_subtree": {
        const input = parseToolArguments(moveSubtreeInputSchema, call);
        this.assertWritable(context, input.task_id);
        this.assertWritable(context, input.new_parent_id);
        if (input.task_id === context.targetTaskId) {
          throw new AttemptFailure(
            "The optimization root cannot be moved.",
          );
        }
        context.draft = moveSubtree(
          context.draft,
          input.task_id,
          input.new_parent_id,
          input.after_sibling_id,
        );
        context.run.emit("subtree.moved", {
          taskId: input.task_id,
          newParentId: input.new_parent_id,
          afterSiblingId: input.after_sibling_id,
        });
        return { ok: true };
      }
      case "collapse_task": {
        const input = parseToolArguments(collapseTaskInputSchema, call);
        this.assertWritable(context, input.task_id);
        const result = collapseTask(context.draft, input.task_id);
        context.draft = result.tree;
        context.run.emit("collapse.staged", {
          taskId: input.task_id,
          removedTaskIds: result.removedTaskIds,
        });
        return { ok: true, removed_task_ids: result.removedTaskIds };
      }
      case "finish_run": {
        parseToolArguments(finishRunInputSchema, call);
        if (
          context.action === "populate" &&
          (!context.populatedFields.has("goals") ||
            !context.populatedFields.has("inputs"))
        ) {
          throw new AttemptFailure(
            "Populate Root Brief must revise Goals and Inputs before finish_run.",
          );
        }
        context.finished = true;
        return { ok: true, status: "validating" };
      }
      default:
        throw new AttemptFailure(`Unknown tool: ${name}`);
    }
  }

  private async validateAttempt(context: AttemptContext): Promise<TaskTree> {
    context.run.emit("validation.started", {
      phase: "structural",
    });
    const structuralIssues = validateTaskTree(context.draft);
    if (structuralIssues.length > 0) {
      context.run.emit("validation.failed", {
        phase: "structural",
        issues: structuralIssues,
      });
      throw new AttemptFailure(
        "Structural validation failed.",
        structuralIssues,
      );
    }

    const completenessIssues = decompositionCompletenessIssues(context);
    if (completenessIssues.length > 0) {
      context.run.emit("validation.failed", {
        phase: "completeness",
        issues: completenessIssues,
      });
      throw new AttemptFailure(
        "Generated Tasks are incomplete.",
        completenessIssues,
      );
    }

    assertFrozenTasksPreserved(
      context.original,
      context.draft,
      context.targetTaskId,
    );
    if (context.action === "populate") {
      assertPopulateScopePreserved(context.original, context.draft);
    }

    const warnings =
      context.action === "populate"
        ? []
        : unresolvedWarnings(context.draft, context.targetTaskId);
    warnings.forEach((warning) =>
      context.run.emit("validation.warning", warning),
    );

    context.run.emit("validation.started", {
      phase: "semantic",
    });
    const response = await this.model.completeChat(
      {
        model: context.run.request.model ?? this.config.modelName,
        messages: [
          {
            role: "system",
            content:
              "You are a strict read-only Task Tree auditor. Return only the requested JSON.",
          },
          {
            role: "user",
            content: buildSemanticAuditPrompt(
              context.action,
              context.original,
              context.draft,
              context.targetTaskId,
            ),
          },
        ],
        format: semanticAuditFormat,
        reasoningEffort:
          context.run.request.reasoningEffort ??
          this.config.modelReasoningEffort,
      },
      context.run.abortController.signal,
    );

    let audit: z.infer<typeof semanticAuditSchema>;
    try {
      audit = semanticAuditSchema.parse(
        parseStructuredJson(response.content),
      );
    } catch {
      throw new AttemptFailure(
        "Semantic validation returned invalid structured output.",
      );
    }

    audit.issues
      .filter((issue) => issue.severity === "warning")
      .forEach((issue) =>
        context.run.emit("validation.warning", {
          code: "SEMANTIC_WARNING",
          message: issue.message,
          path: issue.taskId ?? context.targetTaskId,
          severity: "warning",
        }),
      );

    const semanticErrors = audit.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => ({
        code: "SEMANTIC_ERROR",
        message: issue.message,
        path: issue.taskId ?? context.targetTaskId,
        severity: "error" as const,
      }));

    if (!audit.valid || semanticErrors.length > 0) {
      context.run.emit("validation.failed", {
        phase: "semantic",
        issues: semanticErrors,
      });
      throw new AttemptFailure(
        "Semantic validation failed.",
        semanticErrors,
      );
    }

    return parseTaskTree(context.draft);
  }
}
