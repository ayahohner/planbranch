import { operatorNameSchema, parseTaskTree } from "./schema";
import type {
  Operator,
  RevisableTaskFields,
  RootTask,
  Task,
  TaskKind,
  TaskTree,
} from "./types";

export class TreeOperationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "TASK_NOT_FOUND"
      | "INVALID_PARENT"
      | "INVALID_POSITION"
      | "INVALID_SCOPE"
      | "INVALID_TASK_KIND"
      | "ROOT_IMMUTABLE"
      | "CYCLE",
  ) {
    super(message);
    this.name = "TreeOperationError";
  }
}

export interface TaskLocation {
  task: Task;
  parent: Task | null;
  index: number;
}

function cloneTree(tree: TaskTree): TaskTree {
  return structuredClone(tree);
}

function findMutable(
  task: Task,
  taskId: string,
  parent: Task | null = null,
  index = 0,
): TaskLocation | null {
  if (task.id === taskId) {
    return { task, parent, index };
  }

  for (let childIndex = 0; childIndex < task.children.length; childIndex += 1) {
    const result = findMutable(
      task.children[childIndex],
      taskId,
      task,
      childIndex,
    );
    if (result) {
      return result;
    }
  }
  return null;
}

export function findTask(tree: TaskTree, taskId: string): TaskLocation | null {
  return findMutable(tree.root, taskId);
}

function requireTask(tree: TaskTree, taskId: string): TaskLocation {
  const location = findTask(tree, taskId);
  if (!location) {
    throw new TreeOperationError(
      `Task ${taskId} does not exist.`,
      "TASK_NOT_FOUND",
    );
  }
  return location;
}

export function deriveTaskKind(task: Task): TaskKind {
  if (task.children.length > 0) {
    return "compound";
  }
  return task.operator ? "primitive" : "unresolved";
}

export function createEmptyTask(
  title = "Untitled Task",
  id = crypto.randomUUID(),
): Task {
  return {
    id,
    title,
    description: "",
    inputs: [],
    outputs: [],
    children: [],
  };
}

export function createEmptyTree(id = crypto.randomUUID()): TaskTree {
  const root: RootTask = {
    ...createEmptyTask("New Planning Brief", id),
    description: "Describe the work, domain context, and constraints.",
    goals: ["Define the desired outcome"],
  };
  return { schemaVersion: 1, root };
}

function insertionIndex(
  parent: Task,
  afterSiblingId: string | null | undefined,
): number {
  if (afterSiblingId === undefined) {
    return parent.children.length;
  }
  if (afterSiblingId === null) {
    return 0;
  }
  const siblingIndex = parent.children.findIndex(
    (child) => child.id === afterSiblingId,
  );
  if (siblingIndex < 0) {
    throw new TreeOperationError(
      "The requested sibling is not a direct child of the parent.",
      "INVALID_POSITION",
    );
  }
  return siblingIndex + 1;
}

export function addSubtask(
  source: TaskTree,
  parentId: string,
  title: string,
  afterSiblingId?: string | null,
  taskId = crypto.randomUUID(),
): { tree: TaskTree; task: Task } {
  const tree = cloneTree(source);
  const { task: parent } = requireTask(tree, parentId);
  const task = createEmptyTask(title.trim(), taskId);
  const index = insertionIndex(parent, afterSiblingId);
  delete parent.operator;
  parent.children.splice(index, 0, task);
  return { tree: parseTaskTree(tree), task };
}

export function reviseTask(
  source: TaskTree,
  taskId: string,
  patch: Partial<RevisableTaskFields>,
): TaskTree {
  const tree = cloneTree(source);
  const { task } = requireTask(tree, taskId);
  const isRoot = tree.root.id === taskId;

  if (patch.goals !== undefined && !isRoot) {
    throw new TreeOperationError(
      "Goals can only be revised on the Root Task.",
      "INVALID_SCOPE",
    );
  }

  if (patch.title !== undefined) task.title = patch.title.trim();
  if (patch.description !== undefined)
    task.description = patch.description.trim();
  if (patch.inputs !== undefined) task.inputs = [...patch.inputs];
  if (patch.outputs !== undefined) task.outputs = [...patch.outputs];
  if (patch.goals !== undefined) tree.root.goals = [...patch.goals];
  return parseTaskTree(tree);
}

export function declareOperator(
  source: TaskTree,
  taskId: string,
  operator: Operator,
): TaskTree {
  const tree = cloneTree(source);
  const { task } = requireTask(tree, taskId);
  if (task.children.length > 0) {
    throw new TreeOperationError(
      "Only a childless Task can declare an Operator.",
      "INVALID_TASK_KIND",
    );
  }
  task.operator = {
    executor: operator.executor,
    name: operatorNameSchema.parse(operator.name),
  };
  return parseTaskTree(tree);
}

export function clearOperator(source: TaskTree, taskId: string): TaskTree {
  const tree = cloneTree(source);
  const { task } = requireTask(tree, taskId);
  delete task.operator;
  return parseTaskTree(tree);
}

function collectTaskIds(task: Task, ids: Set<string>) {
  ids.add(task.id);
  task.children.forEach((child) => collectTaskIds(child, ids));
}

export function getSubtreeIds(tree: TaskTree, taskId: string): Set<string> {
  const { task } = requireTask(tree, taskId);
  const ids = new Set<string>();
  collectTaskIds(task, ids);
  return ids;
}

export function getAllTaskIds(tree: TaskTree): Set<string> {
  const ids = new Set<string>();
  collectTaskIds(tree.root, ids);
  return ids;
}

export function moveSubtree(
  source: TaskTree,
  taskId: string,
  newParentId: string,
  afterSiblingId?: string | null,
): TaskTree {
  if (source.root.id === taskId) {
    throw new TreeOperationError(
      "The Root Task cannot be moved.",
      "ROOT_IMMUTABLE",
    );
  }

  const tree = cloneTree(source);
  const movingLocation = requireTask(tree, taskId);
  if (!movingLocation.parent) {
    throw new TreeOperationError(
      "The Root Task cannot be moved.",
      "ROOT_IMMUTABLE",
    );
  }

  const subtreeIds = new Set<string>();
  collectTaskIds(movingLocation.task, subtreeIds);
  if (subtreeIds.has(newParentId)) {
    throw new TreeOperationError(
      "A Task cannot be moved into its own subtree.",
      "CYCLE",
    );
  }

  const [movingTask] = movingLocation.parent.children.splice(
    movingLocation.index,
    1,
  );
  const { task: newParent } = requireTask(tree, newParentId);
  const index = insertionIndex(newParent, afterSiblingId);
  delete newParent.operator;
  newParent.children.splice(index, 0, movingTask);
  return parseTaskTree(tree);
}

export function collapseTask(
  source: TaskTree,
  taskId: string,
): { tree: TaskTree; removedTaskIds: string[] } {
  const tree = cloneTree(source);
  const { task } = requireTask(tree, taskId);
  if (task.children.length === 0) {
    throw new TreeOperationError(
      "Only a Compound Task can be collapsed.",
      "INVALID_TASK_KIND",
    );
  }

  const removedIds = new Set<string>();
  task.children.forEach((child) => collectTaskIds(child, removedIds));
  task.children = [];
  delete task.operator;
  return {
    tree: parseTaskTree(tree),
    removedTaskIds: [...removedIds],
  };
}

export function isWithinSubtree(
  tree: TaskTree,
  subtreeRootId: string,
  taskId: string,
): boolean {
  return getSubtreeIds(tree, subtreeRootId).has(taskId);
}

export function getAncestorPath(tree: TaskTree, taskId: string): Task[] {
  const path: Task[] = [];
  const visit = (task: Task): boolean => {
    path.push(task);
    if (task.id === taskId) return true;
    for (const child of task.children) {
      if (visit(child)) return true;
    }
    path.pop();
    return false;
  };
  if (!visit(tree.root)) {
    throw new TreeOperationError(
      `Task ${taskId} does not exist.`,
      "TASK_NOT_FOUND",
    );
  }
  return path;
}
