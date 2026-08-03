"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Activity,
  Download,
  FilePlus2,
  GitBranch,
  Redo2,
  RotateCcw,
  Undo2,
  Upload,
} from "lucide-react";
import { useRef } from "react";

function ToolbarButton({
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
          className="toolbar-icon-button"
          disabled={disabled}
          onClick={onClick}
          type="button"
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="app-tooltip" sideOffset={7}>
          {label}
          <Tooltip.Arrow className="app-tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Toolbar({
  activityOpen,
  canUndo,
  canRedo,
  modelLabel,
  modelRuntimeLabel,
  modelReady,
  onNew,
  onImport,
  onExport,
  onUndo,
  onRedo,
  onToggleActivity,
  locked,
}: {
  activityOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  modelLabel: string;
  modelRuntimeLabel: string;
  modelReady: boolean;
  onNew: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleActivity: () => void;
  locked: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <header className="app-toolbar">
      <div className="brand-lockup">
        <span className="brand-mark">
          <GitBranch size={18} />
        </span>
        <span>
          <strong>Planbranch</strong>
          <small>local planning workspace</small>
        </span>
      </div>

      <div className="toolbar-group" aria-label="File actions">
        <ToolbarButton disabled={locked} label="New Tree" onClick={onNew}>
          <FilePlus2 size={17} />
        </ToolbarButton>
        <ToolbarButton
          disabled={locked}
          label="Import JSON"
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={17} />
        </ToolbarButton>
        <ToolbarButton label="Export JSON" onClick={onExport}>
          <Download size={17} />
        </ToolbarButton>
        <input
          accept=".json,application/json"
          className="visually-hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImport(file);
            event.target.value = "";
          }}
          ref={inputRef}
          type="file"
        />
        <span className="toolbar-divider" />
        <ToolbarButton
          disabled={locked || !canUndo}
          label="Undo"
          onClick={onUndo}
        >
          <Undo2 size={17} />
        </ToolbarButton>
        <ToolbarButton
          disabled={locked || !canRedo}
          label="Redo"
          onClick={onRedo}
        >
          <Redo2 size={17} />
        </ToolbarButton>
      </div>

      <div className="toolbar-spacer" />

      <button
        aria-controls="model-activity-panel"
        aria-expanded={activityOpen}
        className="model-status"
        onClick={onToggleActivity}
        type="button"
      >
        <span
          className={`model-status-dot ${modelReady ? "is-ready" : ""}`}
        />
        <span>
          <small>{modelRuntimeLabel}</small>
          <strong>{modelLabel}</strong>
        </span>
        {modelReady ? <Activity size={15} /> : <RotateCcw size={15} />}
      </button>
    </header>
  );
}
