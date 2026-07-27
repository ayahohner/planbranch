"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import {
  ChevronsDown,
  Layers3,
  ListCollapse,
  Sparkles,
  Split,
} from "lucide-react";
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  deriveTaskKind,
  type RunAction,
  type Task,
} from "../../packages/domain/src";
import { EditableList, InlineText } from "./inline-fields";
import { OperatorEditor } from "./operator-editor";
import { useEditorStore } from "./store";

export interface TaskNodeData extends Record<string, unknown> {
  task: Task;
  isRoot: boolean;
  order: number;
  onRun: (action: RunAction, taskId: string) => void;
  runDisabled: boolean;
  visualState?: "new" | "changed" | "removing";
  changedFields: string[];
}

export type TaskFlowNode = Node<TaskNodeData, "task">;

function ActionButton({
  label,
  children,
  disabled,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          aria-label={label}
          className="node-action"
          disabled={disabled}
          onClick={onClick}
          type="button"
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="app-tooltip" sideOffset={6}>
          {label}
          <Tooltip.Arrow className="app-tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function TaskNodeComponent({ data }: NodeProps<TaskFlowNode>) {
  const {
    task,
    isRoot,
    order,
    onRun,
    runDisabled,
    visualState,
    changedFields,
  } = data;
  const kind = deriveTaskKind(task);
  const revise = useEditorStore((state) => state.reviseTask);
  const setOperator = useEditorStore((state) => state.setOperator);
  const clearOperator = useEditorStore((state) => state.clearOperator);

  return (
    <article
      className={`task-node task-node-${kind} ${isRoot ? "task-node-root" : ""} ${runDisabled ? "task-node-run-locked" : ""}`}
      data-task-id={task.id}
      data-run-state={visualState}
    >
      {!isRoot ? <Handle position={Position.Top} type="target" /> : null}
      <header className="task-node-header">
        <div className="task-kind-row">
          <span className={`task-kind task-kind-${kind}`}>
            {kind === "compound" ? (
              <Layers3 size={12} />
            ) : kind === "primitive" ? (
              <ChevronsDown size={12} />
            ) : (
              <Split size={12} />
            )}
            {visualState === "removing"
              ? "Removing"
              : isRoot
              ? "Root Brief"
              : kind === "compound"
                ? "Compound"
                : kind === "primitive"
                  ? "Primitive"
                  : "Unresolved"}
          </span>
          {!isRoot ? (
            <span className="task-order">{String(order).padStart(2, "0")}</span>
          ) : null}
        </div>
        <div className="task-node-actions">
          <ActionButton
            disabled={runDisabled}
            label="Decompose Task"
            onClick={() => onRun("decompose", task.id)}
          >
            <Split size={15} />
          </ActionButton>
          <ActionButton
            disabled={runDisabled}
            label="Optimize Subtree"
            onClick={() => onRun("optimize", task.id)}
          >
            <Sparkles size={15} />
          </ActionButton>
          {kind === "compound" ? (
            <ActionButton
              disabled={runDisabled}
              label="Collapse Task"
              onClick={() => onRun("collapse", task.id)}
            >
              <ListCollapse size={15} />
            </ActionButton>
          ) : null}
        </div>
      </header>

      <InlineText
        className={`task-title ${changedFields.includes("title") ? "run-field-changed" : ""}`}
        onCommit={(title) => revise(task.id, { title }, "Edit Task title")}
        placeholder="Task title"
        value={task.title}
      />
      <InlineText
        className={`task-description ${changedFields.includes("description") ? "run-field-changed" : ""}`}
        multiline
        onCommit={(description) =>
          revise(task.id, { description }, "Edit Task description")
        }
        placeholder="Add the purpose, boundaries, and useful context…"
        value={task.description}
      />

      {isRoot ? (
        <section
          className={`task-field-section goals-section ${changedFields.includes("goals") ? "run-field-changed" : ""}`}
        >
          <span className="task-field-label">Goals</span>
          <EditableList
            addLabel="Add Goal"
            emptyLabel="No goals yet"
            onCommit={(goals) =>
              revise(task.id, { goals }, "Edit Root goals")
            }
            values={"goals" in task ? (task.goals as string[]) : []}
          />
        </section>
      ) : null}

      <div className="task-io-grid">
        <section
          className={`task-field-section ${changedFields.includes("inputs") ? "run-field-changed" : ""}`}
        >
          <span className="task-field-label">Inputs</span>
          <EditableList
            addLabel="Add Input"
            emptyLabel="No inputs"
            onCommit={(inputs) =>
              revise(task.id, { inputs }, "Edit Task inputs")
            }
            values={task.inputs}
          />
        </section>
        <section
          className={`task-field-section ${changedFields.includes("outputs") ? "run-field-changed" : ""}`}
        >
          <span className="task-field-label">Outputs</span>
          <EditableList
            addLabel="Add Output"
            emptyLabel="No outputs"
            onCommit={(outputs) =>
              revise(task.id, { outputs }, "Edit Task outputs")
            }
            values={task.outputs}
          />
        </section>
      </div>

      <footer
        className={`task-node-footer ${changedFields.includes("operator") ? "run-field-changed" : ""}`}
      >
        <span className="task-field-label">Operator</span>
        <OperatorEditor
          disabled={kind === "compound"}
          onClear={() => clearOperator(task.id)}
          onCommit={(operator) => setOperator(task.id, operator)}
          operator={task.operator}
        />
      </footer>
      {task.children.length > 0 ? (
        <Handle position={Position.Bottom} type="source" />
      ) : null}
    </article>
  );
}

export const TaskNode = memo(TaskNodeComponent);
