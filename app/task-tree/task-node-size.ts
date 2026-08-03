import type { Task } from "../../packages/domain/src";

export const TASK_NODE_WIDTH = 390;

export function getTaskNodeSize(
  task: Task,
  isRoot: boolean,
): { width: number; height: number } {
  const descriptionLines = Math.max(
    1,
    Math.ceil(task.description.length / 48),
  );
  const artifactRows =
    Math.ceil(Math.max(task.inputs.length, 1) / 2) +
    Math.ceil(Math.max(task.outputs.length, 1) / 2);
  const goalRows =
    isRoot && "goals" in task
      ? Math.ceil(Math.max((task.goals as string[]).length, 1) / 2)
      : 0;

  return {
    width: TASK_NODE_WIDTH,
    height:
      242 + descriptionLines * 18 + artifactRows * 27 + goalRows * 27,
  };
}
