import { describe, expect, it } from "vitest";
import { createEmptyTree } from "../packages/domain/src";
import {
  buildActionPrompt,
  buildSemanticAuditPrompt,
  planningSystemPrompt,
} from "./prompts";

const rootId = "00000000-0000-4000-8000-000000000101";

describe("planning stopping rules", () => {
  it("defines a direct Primitive boundary and deterministic preference", () => {
    expect(planningSystemPrompt).toContain("Default to making a Task Primitive");
    expect(planningSystemPrompt).toContain("real Artifact handoff");
    expect(planningSystemPrompt).toContain("Prefer a deterministic Operator");
    expect(planningSystemPrompt).toContain("Call finish_run as soon as");
  });

  it("includes the enforced task and depth budgets in decomposition prompts", () => {
    const prompt = buildActionPrompt(
      "decompose",
      createEmptyTree(rootId),
      rootId,
      { maxNewTasks: 8, maxDecompositionDepth: 2 },
    );

    expect(prompt).toContain("no more than 8 new Tasks");
    expect(prompt).toContain("more than 2 levels below the target");
    expect(prompt).toContain("These are hard limits, not goals to fill");
  });

  it("asks semantic validation to reject needless decomposition", () => {
    const tree = createEmptyTree(rootId);
    const prompt = buildSemanticAuditPrompt(
      "decompose",
      tree,
      tree,
      rootId,
    );

    expect(prompt).toContain("at least two independently meaningful stages");
    expect(prompt).toContain("implementation details stop at a direct Operator");
  });
});
