import {
  findTask,
  getAncestorPath,
  type RunAction,
  type TaskTree,
} from "../packages/domain/src";

export const planningSystemPrompt = `You are the planning engine for Task Tree, a strictly ordered task-decomposition application.

Ubiquitous language:
- A Compound Task has an ordered Decomposition and no Operator.
- A Primitive Task is childless and has one direct Operator.
- An Unresolved Task is childless and has no Operator.
- An Artifact Label is a reusable Title Case semantic input or output label.
- An Executor is either "llm" or "deterministic".
- An Operator is a concise kebab-case action identifier.

Rules:
1. Produce a strictly ordered tree. Do not create parallel, conditional, or alternative paths.
2. A Task is not Primitive when its executor must first decide which additional tasks or structural stages are required.
3. Bounded local judgment within a direct action is allowed.
4. Prefer terms from the user's brief and established domain terminology.
5. Do not introduce abstractions merely to organize the plan.
6. Reuse existing Artifact Labels rather than inventing synonyms.
7. Respect the writable scope. Everything else is read-only context.
8. Mutate the tree only through the supplied tools.
9. Work field-by-field so the user can watch meaningful progress.
10. Call finish_run when the writable scope is coherent.`;

function actionInstruction(action: RunAction, targetId: string): string {
  switch (action) {
    case "populate":
      return `Populate the Root Brief for Task ${targetId}.
Use its Title and Description as the authoritative brief.
First call revise_task with task_id and goals only. Then call revise_task with task_id and inputs only.
Goals must be 1–8 concise, testable end-state outcomes directly expressed or necessarily implied by the brief, never prerequisite projects or implementation steps.
Inputs must be 0–12 distinct Title Case Artifact Labels for source information or materials available before execution, never intermediate deliverables.
Preserve useful existing entries, remove weak placeholders and synonyms, and do not invent specific facts absent from the brief.
Do not revise Title, Description, Outputs, or any other Task field. Do not change the tree structure or Operator.`;
    case "decompose":
      return `Decompose Task ${targetId}. You may revise it and create an ordered subtree below it. Classify directly actionable leaves by declaring Operators.`;
    case "optimize":
      return `Optimize Task ${targetId} and its descendants. Preserve its overall intent, improve ordering and decomposition quality, and do not mutate anything outside this subtree.`;
    case "collapse":
      return `Collapse Task ${targetId}. Its descendants are staged for removal. Consolidate useful descendant detail into the surviving Task, then declare a direct Operator if defensible. Otherwise leave it Unresolved.`;
  }
}

export function buildActionPrompt(
  action: RunAction,
  tree: TaskTree,
  targetId: string,
): string {
  const target = findTask(tree, targetId)?.task;
  if (!target) {
    throw new Error(`Target Task ${targetId} does not exist.`);
  }
  const ancestors = getAncestorPath(tree, targetId).map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
  }));

  return `${actionInstruction(action, targetId)}

Root Goals:
${JSON.stringify(tree.root.goals, null, 2)}

Ancestor path:
${JSON.stringify(ancestors, null, 2)}

Target before the Run:
${JSON.stringify(target, null, 2)}

Complete Task Tree (read-only outside the writable scope):
${JSON.stringify(tree, null, 2)}`;
}

export function buildSemanticAuditPrompt(
  action: RunAction,
  original: TaskTree,
  draft: TaskTree,
  targetId: string,
): string {
  const checks =
    action === "populate"
      ? `- only Root Goals and Inputs changed;
- Goals are concise outcomes aligned with the Root Title and Description;
- Goals do not introduce prerequisite projects or implementation steps;
- Inputs are distinct Title Case source Artifact Labels needed to pursue those Goals, not intermediate deliverables;
- useful existing entries were preserved where still relevant;
- no unsupported specific facts were invented.`
      : `- alignment with Root Goals;
- ordered children plausibly cover each Compound parent;
- Primitive Tasks are directly actionable without another planning stage;
- Artifact flow is coherent;
- no unnecessary organizational abstractions were introduced;
- frozen Tasks outside the target subtree did not change;
- for Collapse, the surviving Task preserves useful intent and external siblings remain unchanged.`;

  return `Audit this ${action} result for Task ${targetId}.

Return JSON only:
{
  "valid": boolean,
  "issues": [
    {
      "severity": "error" | "warning",
      "message": string,
      "taskId": string | null
    }
  ]
}

Check:
${checks}

Unresolved Tasks are allowed and should produce warnings, not errors.

Before:
${JSON.stringify(original, null, 2)}

After:
${JSON.stringify(draft, null, 2)}`;
}

export const semanticAuditFormat = {
  type: "object",
  additionalProperties: false,
  required: ["valid", "issues"],
  properties: {
    valid: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "message", "taskId"],
        properties: {
          severity: { type: "string", enum: ["error", "warning"] },
          message: { type: "string" },
          taskId: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    },
  },
} as const;
