import { z } from "zod";
import type {
  Operator,
  RootTask,
  Task,
  TaskTree,
  ValidationIssue,
} from "./types";

export const artifactLabelPattern =
  /^[A-Z0-9][A-Za-z0-9&/'()_-]*(?: [A-Z0-9][A-Za-z0-9&/'()_-]*)*$/;
export const operatorNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const artifactLabelSchema = z
  .string()
  .trim()
  .min(1, "Artifact Labels cannot be empty.")
  .max(120, "Artifact Labels must be 120 characters or fewer.")
  .regex(artifactLabelPattern, "Artifact Labels must use Title Case words.");

export const operatorNameSchema = z
  .string()
  .trim()
  .min(1, "Operator names cannot be empty.")
  .max(120, "Operator names must be 120 characters or fewer.")
  .regex(operatorNamePattern, "Operator names must use kebab-case.");

export const operatorSchema: z.ZodType<Operator> = z
  .object({
    executor: z.enum(["llm", "deterministic"]),
    name: operatorNameSchema,
  })
  .strict();

const taskTextShape = {
  id: z.uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000),
  inputs: z.array(artifactLabelSchema).max(50),
  outputs: z.array(artifactLabelSchema).max(50),
  operator: operatorSchema.optional(),
};

function enforceTaskKind(
  task: Pick<Task, "children" | "operator">,
  ctx: z.RefinementCtx,
) {
  if (task.children.length > 0 && task.operator) {
    ctx.addIssue({
      code: "custom",
      message: "A Compound Task cannot also have an Operator.",
      path: ["operator"],
    });
  }
}

let recursiveTaskSchema: z.ZodType<Task>;
recursiveTaskSchema = z
  .object({
    ...taskTextShape,
    children: z.lazy(() => z.array(recursiveTaskSchema).max(500)),
  })
  .strict()
  .superRefine(enforceTaskKind);

export const taskSchema = recursiveTaskSchema;

export const rootTaskSchema: z.ZodType<RootTask> = z
  .object({
    ...taskTextShape,
    goals: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
    children: z.array(taskSchema).max(500),
  })
  .strict()
  .superRefine(enforceTaskKind);

export const taskTreeSchema: z.ZodType<TaskTree> = z
  .object({
    schemaVersion: z.literal(1),
    root: rootTaskSchema,
  })
  .strict()
  .superRefine((tree, ctx) => {
    const seen = new Set<string>();
    const visit = (task: Task, path: Array<string | number>) => {
      if (seen.has(task.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate Task ID: ${task.id}`,
          path,
        });
      }
      seen.add(task.id);
      task.children.forEach((child, index) =>
        visit(child, [...path, "children", index]),
      );
    };
    visit(tree.root, ["root"]);
  });

export function validateTaskTree(tree: unknown): ValidationIssue[] {
  const result = taskTreeSchema.safeParse(tree);
  if (result.success) {
    return [];
  }

  return result.error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.map(String).join("."),
    severity: "error" as const,
  }));
}

export function parseTaskTree(tree: unknown): TaskTree {
  return taskTreeSchema.parse(tree);
}

export function importTaskTree(source: string): TaskTree {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  return parseTaskTree(parsed);
}

export function exportTaskTree(tree: TaskTree): string {
  return `${JSON.stringify(parseTaskTree(tree), null, 2)}\n`;
}
