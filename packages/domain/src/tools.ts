import { z } from "zod";
import { artifactLabelSchema, operatorNameSchema } from "./schema";

export const addSubtaskInputSchema = z
  .object({
    parent_id: z.uuid(),
    after_sibling_id: z.uuid().nullable().optional(),
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export const reviseTaskInputSchema = z
  .object({
    task_id: z.uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).max(10_000).optional(),
    inputs: z.array(artifactLabelSchema).max(50).optional(),
    outputs: z.array(artifactLabelSchema).max(50).optional(),
    goals: z.array(z.string().trim().min(1).max(500)).min(1).max(50).optional(),
  })
  .strict()
  .refine(({ title, description, inputs, outputs, goals }) =>
    [title, description, inputs, outputs, goals].filter(
      (value) => value !== undefined,
    ).length === 1, "revise_task accepts exactly one semantic field per call.");

export const declareOperatorInputSchema = z
  .object({
    task_id: z.uuid(),
    executor: z.enum(["llm", "deterministic"]),
    operator: operatorNameSchema,
  })
  .strict();

export const moveSubtreeInputSchema = z
  .object({
    task_id: z.uuid(),
    new_parent_id: z.uuid(),
    after_sibling_id: z.uuid().nullable().optional(),
  })
  .strict();

export const collapseTaskInputSchema = z
  .object({
    task_id: z.uuid(),
  })
  .strict();

export const finishRunInputSchema = z.object({}).strict();

export type ToolName =
  | "add_subtask"
  | "revise_task"
  | "declare_operator"
  | "move_subtree"
  | "collapse_task"
  | "finish_run";

export interface LlmToolDefinition {
  type: "function";
  function: {
    name: ToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const toolDefinitions: Record<ToolName, LlmToolDefinition> = {
  add_subtask: {
    type: "function",
    function: {
      name: "add_subtask",
      description:
        "Create and immediately link one ordered Unresolved subtask. This tool accepts only parent_id, after_sibling_id, and title. After creation, use the returned task_id with separate revise_task calls for description, inputs, and outputs, then declare_operator for a direct leaf.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["parent_id", "title"],
        properties: {
          parent_id: { type: "string", format: "uuid" },
          after_sibling_id: {
            anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
            description:
              "Omit to append, use null to insert first, or provide a direct sibling ID.",
          },
          title: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
    },
  },
  revise_task: {
    type: "function",
    function: {
      name: "revise_task",
      description:
        'Replace exactly one semantic field on an existing Task so the edit can stream visibly. Artifact Labels must capitalize every word, for example "Running Water" or "Clean Body". Goals are Root-only.',
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["task_id"],
        minProperties: 2,
        maxProperties: 2,
        properties: {
          task_id: { type: "string", format: "uuid" },
          title: { type: "string", minLength: 1, maxLength: 200 },
          description: {
            type: "string",
            minLength: 1,
            maxLength: 10_000,
          },
          inputs: {
            type: "array",
            items: { type: "string" },
            maxItems: 50,
          },
          outputs: {
            type: "array",
            items: { type: "string" },
            maxItems: 50,
          },
          goals: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 50,
          },
        },
      },
    },
  },
  declare_operator: {
    type: "function",
    function: {
      name: "declare_operator",
      description:
        "Make a childless Task Primitive by declaring its Executor and direct kebab-case Operator.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["task_id", "executor", "operator"],
        properties: {
          task_id: { type: "string", format: "uuid" },
          executor: { type: "string", enum: ["llm", "deterministic"] },
          operator: {
            type: "string",
            pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
          },
        },
      },
    },
  },
  move_subtree: {
    type: "function",
    function: {
      name: "move_subtree",
      description:
        "Reorder or reparent a Task and all descendants within the optimization scope.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["task_id", "new_parent_id"],
        properties: {
          task_id: { type: "string", format: "uuid" },
          new_parent_id: { type: "string", format: "uuid" },
          after_sibling_id: {
            anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
          },
        },
      },
    },
  },
  collapse_task: {
    type: "function",
    function: {
      name: "collapse_task",
      description:
        "Keep a Compound Task but stage every descendant for removal so the Task can be consolidated.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["task_id"],
        properties: {
          task_id: { type: "string", format: "uuid" },
        },
      },
    },
  },
  finish_run: {
    type: "function",
    function: {
      name: "finish_run",
      description:
        "Signal that the writable Task scope is ready for structural and semantic validation.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
};

export const toolsByAction = {
  populate: [
    toolDefinitions.revise_task,
    toolDefinitions.finish_run,
  ],
  decompose: [
    toolDefinitions.add_subtask,
    toolDefinitions.revise_task,
    toolDefinitions.declare_operator,
    toolDefinitions.finish_run,
  ],
  optimize: Object.values(toolDefinitions),
  collapse: [
    toolDefinitions.revise_task,
    toolDefinitions.declare_operator,
    toolDefinitions.finish_run,
  ],
} as const;
