"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  exportTaskTree,
  importTaskTree,
  type RunAction,
  type TaskTree,
} from "../../packages/domain/src";
import { ConfirmDialog } from "./confirm-dialog";
import { useEditorStore } from "./store";
import { TaskCanvas } from "./task-canvas";
import { Toolbar } from "./toolbar";

type PendingAction =
  | { type: "new" }
  | { type: "import"; tree: TaskTree }
  | null;

export function TaskTreeApp() {
  const tree = useEditorStore((state) => state.tree);
  const history = useEditorStore((state) => state.history);
  const future = useEditorStore((state) => state.future);
  const notice = useEditorStore((state) => state.notice);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const newTree = useEditorStore((state) => state.newTree);
  const replaceTree = useEditorStore((state) => state.replaceTree);
  const setNotice = useEditorStore((state) => state.setNotice);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(timeout);
  }, [notice, setNotice]);

  const runTask = useCallback(
    (action: RunAction) => {
      setNotice({
        kind: "info",
        message: `${action === "optimize" ? "Optimize" : action === "collapse" ? "Collapse" : "Decompose"} will use the local model once it is ready.`,
      });
    },
    [setNotice],
  );

  const readImport = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      setNotice({
        kind: "error",
        message: "Import files must be 5 MB or smaller.",
      });
      return;
    }
    try {
      const imported = importTaskTree(await file.text());
      setPendingAction({ type: "import", tree: imported });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "The import was invalid.",
      });
    }
  };

  const exportJson = () => {
    const source = exportTaskTree(tree);
    const blob = new Blob([source], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${tree.root.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "task-tree"}-task-tree.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice({ kind: "success", message: "Task Tree exported as JSON." });
  };

  return (
    <Tooltip.Provider delayDuration={350}>
      <main className="task-tree-app">
        <Toolbar
          canRedo={future.length > 0}
          canUndo={history.length > 0}
          modelLabel="Checking Ollama…"
          modelReady={false}
          onExport={exportJson}
          onImport={(file) => void readImport(file)}
          onNew={() => setPendingAction({ type: "new" })}
          onOpenActivity={() =>
            setNotice({
              kind: "info",
              message: "Model activity will appear here during a Run.",
            })
          }
          onRedo={redo}
          onUndo={undo}
        />
        <section className="canvas-shell" aria-label="Task Tree canvas">
          <div className="canvas-context">
            <span>Ordered decomposition</span>
            <strong>{countTasks(tree.root)} Tasks</strong>
          </div>
          <TaskCanvas onRun={runTask} tree={tree} />
        </section>

        {notice ? (
          <div className={`app-notice notice-${notice.kind}`} role="status">
            {notice.kind === "success" ? (
              <CheckCircle2 size={17} />
            ) : notice.kind === "error" ? (
              <AlertCircle size={17} />
            ) : (
              <Info size={17} />
            )}
            <span>{notice.message}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice(null)}
              type="button"
            >
              <X size={15} />
            </button>
          </div>
        ) : null}

        <ConfirmDialog
          confirmLabel={
            pendingAction?.type === "import" ? "Import Tree" : "New Tree"
          }
          description={
            pendingAction?.type === "import"
              ? "The imported Task Tree will replace the current workspace and clear undo history."
              : "The current Task Tree will be replaced with a new planning brief."
          }
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            if (pendingAction?.type === "import") {
              replaceTree(pendingAction.tree, {
                kind: "success",
                message: "Task Tree imported successfully.",
              });
            } else if (pendingAction?.type === "new") {
              newTree();
            }
            setPendingAction(null);
          }}
          open={pendingAction !== null}
          title={
            pendingAction?.type === "import"
              ? "Replace the current tree?"
              : "Start a new tree?"
          }
        />
      </main>
    </Tooltip.Provider>
  );
}

function countTasks(task: TaskTree["root"]): number {
  return 1 + task.children.reduce((total, child) => total + countTasks(child as TaskTree["root"]), 0);
}
