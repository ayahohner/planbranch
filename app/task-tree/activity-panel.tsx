"use client";

import {
  AlertCircle,
  CheckCircle2,
  Circle,
  LoaderCircle,
  RefreshCcw,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import type { ModelOption } from "../../packages/domain/src";
import type {
  ModelHealthState,
  RunLogEntry,
  RunSummary,
} from "./store";

function LogIcon({ level }: { level: RunLogEntry["level"] }) {
  return level === "success" ? (
    <CheckCircle2 size={15} />
  ) : level === "error" ? (
    <XCircle size={15} />
  ) : level === "warning" ? (
    <TriangleAlert size={15} />
  ) : (
    <Circle size={11} />
  );
}

export function ActivityPanel({
  open,
  active,
  summary,
  logs,
  model,
  models,
  onCancel,
  onClose,
  onModelChange,
  onReasoningEffortChange,
  onRefreshModel,
}: {
  open: boolean;
  active: boolean;
  summary: RunSummary | null;
  logs: RunLogEntry[];
  model: ModelHealthState;
  models: ModelOption[];
  onCancel: () => void;
  onClose: () => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: string) => void;
  onRefreshModel: () => void;
}) {
  if (!open) return null;

  const selectedModel = models.find((option) => option.model === model.name);
  const reasoningEfforts = selectedModel?.supportedReasoningEfforts ?? [];
  const selectedEffort = reasoningEfforts.find(
    (option) => option.reasoningEffort === model.reasoningEffort,
  );

  const actionLabel =
    summary?.action === "populate"
      ? "Generate Goals & Inputs"
      : summary?.action === "decompose"
      ? "Decompose"
      : summary?.action === "optimize"
        ? "Optimize Subtree"
        : summary?.action === "collapse"
          ? "Collapse Task"
          : "Activity";

  return (
    <aside
      aria-label="Model activity"
      className="activity-panel"
      id="model-activity-panel"
    >
      <header className="activity-header">
        <div>
          <span className="activity-eyebrow">Model activity</span>
          <h2>{actionLabel}</h2>
        </div>
        <button aria-label="Close activity" onClick={onClose} type="button">
          <X size={17} />
        </button>
      </header>

      <section className={`health-card health-${model.status}`}>
        <span className="health-icon">
          {model.status === "ready" ? (
            <CheckCircle2 size={17} />
          ) : model.status === "checking" ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <AlertCircle size={17} />
          )}
        </span>
        <div>
          <small>
            {model.status === "ready"
              ? "Ready"
              : model.status === "checking"
                ? `Checking ${model.runtime}`
                : model.status === "unavailable"
                  ? "Model unavailable"
                  : "Runtime offline"}
          </small>
          <strong>{model.name}</strong>
          <span className="health-runtime">
            {model.provider} · {model.runtime}
            {model.reasoningEffort
              ? ` · ${model.reasoningEffort} effort`
              : ""}
          </span>
          {model.authentication ? (
            <span className="health-runtime">{model.authentication}</span>
          ) : null}
          {model.error ? <code>{model.error}</code> : null}
        </div>
        <button
          aria-label="Refresh model status"
          onClick={onRefreshModel}
          type="button"
        >
          <RefreshCcw size={14} />
        </button>
      </section>

      <section className="model-settings-card" aria-label="Run model settings">
        <label>
          <span>Model</span>
          <select
            aria-label="Model"
            disabled={active || models.length === 0}
            onChange={(event) => onModelChange(event.target.value)}
            value={model.name}
          >
            {models.length === 0 ? (
              <option value={model.name}>{model.name}</option>
            ) : (
              models.map((option) => (
                <option key={option.id} value={option.model}>
                  {option.displayName}
                </option>
              ))
            )}
          </select>
        </label>
        <label>
          <span>Reasoning effort</span>
          <select
            aria-label="Reasoning effort"
            disabled={active || reasoningEfforts.length === 0}
            onChange={(event) =>
              onReasoningEffortChange(event.target.value)
            }
            value={model.reasoningEffort ?? ""}
          >
            {reasoningEfforts.length === 0 ? (
              <option value={model.reasoningEffort ?? ""}>
                {model.reasoningEffort ?? "Unavailable"}
              </option>
            ) : (
              reasoningEfforts.map((option) => (
                <option
                  key={option.reasoningEffort}
                  value={option.reasoningEffort}
                >
                  {option.reasoningEffort}
                </option>
              ))
            )}
          </select>
        </label>
        {selectedEffort?.description ?? selectedModel?.description ? (
          <p>
            {selectedEffort?.description ?? selectedModel?.description}
          </p>
        ) : null}
        {active ? <small>Model settings are locked during a Run.</small> : null}
      </section>

      {summary ? (
        <section className="run-progress-card">
          <div className="run-progress-copy">
            <span
              className={`run-state run-state-${summary.state}`}
            >
              {active ? <LoaderCircle className="spin" size={12} /> : null}
              {summary.state}
            </span>
            <span>
              Attempt {Math.max(summary.attempt, 1)} of {summary.maxAttempts}
            </span>
          </div>
          <div className="attempt-dots" aria-hidden="true">
            {Array.from({ length: summary.maxAttempts }, (_, index) => (
              <span
                className={
                  index < summary.attempt
                    ? summary.state === "failed" &&
                      index === summary.attempt - 1
                      ? "is-failed"
                      : "is-used"
                    : ""
                }
                key={index}
              />
            ))}
          </div>
          {active ? (
            <button className="cancel-run" onClick={onCancel} type="button">
              Cancel and undo draft
            </button>
          ) : null}
        </section>
      ) : null}

      <div className="activity-log">
        {logs.length === 0 ? (
          <div className="empty-activity">
            <Circle size={18} />
            <p>Task mutations, validation, retries, and errors appear here.</p>
          </div>
        ) : (
          logs.map((entry) => (
            <article
              className={`log-entry log-${entry.level}`}
              key={entry.id}
            >
              <span className="log-icon">
                <LogIcon level={entry.level} />
              </span>
              <div>
                <strong>{entry.title}</strong>
                {entry.detail ? <p>{entry.detail}</p> : null}
                <small>
                  Attempt {Math.max(entry.attempt, 1)} ·{" "}
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </small>
              </div>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
