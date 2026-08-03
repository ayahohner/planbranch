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
import { ActivityPanel } from "./activity-panel";
import { ConfirmDialog } from "./confirm-dialog";
import {
  parsePersistedWorkspace,
  serializeWorkspace,
  WORKSPACE_STORAGE_KEY,
} from "./persistence";
import { useEditorStore } from "./store";
import { TaskCanvas } from "./task-canvas";
import { Toolbar } from "./toolbar";
import { useRuns } from "./use-runs";

type PendingAction =
  | { type: "new" }
  | { type: "import"; tree: TaskTree }
  | null;

export function TaskTreeApp() {
  const tree = useEditorStore((state) => state.tree);
  const history = useEditorStore((state) => state.history);
  const future = useEditorStore((state) => state.future);
  const notice = useEditorStore((state) => state.notice);
  const activeRun = useEditorStore((state) => state.activeRun);
  const runSummary = useEditorStore((state) => state.runSummary);
  const runLogs = useEditorStore((state) => state.runLogs);
  const activityOpen = useEditorStore((state) => state.activityOpen);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const newTree = useEditorStore((state) => state.newTree);
  const replaceTree = useEditorStore((state) => state.replaceTree);
  const restoreWorkspace = useEditorStore((state) => state.restoreWorkspace);
  const setNotice = useEditorStore((state) => state.setNotice);
  const setActivityOpen = useEditorStore((state) => state.setActivityOpen);
  const toggleActivityOpen = useEditorStore(
    (state) => state.toggleActivityOpen,
  );
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const {
    startRun,
    cancelRun,
    refreshHealth,
    modelHealth,
  } = useRuns();
  const runTask = useCallback(
    (action: RunAction, taskId: string) => {
      void startRun(action, taskId);
    },
    [startRun],
  );

  useEffect(() => {
    try {
      const source = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
      if (source) {
        const saved = parsePersistedWorkspace(source);
        restoreWorkspace(saved.tree, saved.history, saved.future);
      }
    } catch {
      try {
        window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      } catch {
        // Storage can be unavailable in restricted browser contexts.
      }
      setNotice({
        kind: "error",
        message:
          "The saved workspace was invalid and could not be restored.",
      });
    }

    const persist = (state: ReturnType<typeof useEditorStore.getState>) => {
      window.localStorage.setItem(
        WORKSPACE_STORAGE_KEY,
        serializeWorkspace({
          tree: state.tree,
          history: state.history.slice(-500),
          future: state.future.slice(0, 500),
        }),
      );
    };
    persist(useEditorStore.getState());

    return useEditorStore.subscribe((state, previous) => {
      if (
        state.tree === previous.tree &&
        state.history === previous.history &&
        state.future === previous.future
      ) {
        return;
      }
      try {
        persist(state);
      } catch {
        setNotice({
          kind: "error",
          message:
            "The workspace changed, but browser storage could not be updated.",
        });
      }
    });
  }, [restoreWorkspace, setNotice]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(timeout);
  }, [notice, setNotice]);

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
      <main className={`task-tree-app ${activeRun ? "is-running" : ""}`}>
        <Toolbar
          canRedo={future.length > 0}
          canUndo={history.length > 0}
          activityOpen={activityOpen}
          locked={Boolean(activeRun)}
          modelLabel={
            activeRun
              ? `Attempt ${Math.max(activeRun.attempt, 1)} of ${activeRun.maxAttempts}`
              : modelHealth.status === "checking"
                ? `Checking ${modelHealth.runtime}…`
                : modelHealth.name
          }
          modelRuntimeLabel={`${modelHealth.provider} · ${modelHealth.runtime}`}
          modelReady={modelHealth.status === "ready"}
          onExport={exportJson}
          onImport={(file) => void readImport(file)}
          onNew={() => setPendingAction({ type: "new" })}
          onToggleActivity={toggleActivityOpen}
          onRedo={redo}
          onUndo={undo}
        />
        <section className="canvas-shell" aria-label="Task Tree canvas">
          <div className="canvas-context">
            <span>Ordered decomposition</span>
            <strong>{taskCountLabel(activeRun?.overlayTree ?? tree)}</strong>
          </div>
          <TaskCanvas
            changedFields={activeRun?.changedFields}
            ghostBranches={activeRun?.ghostBranches}
            newTaskIds={activeRun?.newTaskIds}
            onRun={runTask}
            runDisabled={Boolean(activeRun)}
            tree={activeRun?.overlayTree ?? tree}
          />
        </section>

        <ActivityPanel
          active={Boolean(activeRun)}
          logs={runLogs}
          model={modelHealth}
          onCancel={() => void cancelRun()}
          onClose={() => setActivityOpen(false)}
          onRefreshModel={() => void refreshHealth()}
          open={activityOpen}
          summary={runSummary}
        />

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

function taskCountLabel(tree: TaskTree): string {
  const count = countTasks(tree.root);
  return `${count} ${count === 1 ? "Task" : "Tasks"}`;
}

function countTasks(task: TaskTree["root"]): number {
  return (
    1 +
    task.children.reduce(
      (total, child) =>
        total + 1 + child.children.reduce(countDescendants, 0),
      0,
    )
  );
}

function countDescendants(
  total: number,
  task: TaskTree["root"]["children"][number],
): number {
  return total + 1 + task.children.reduce(countDescendants, 0);
}
