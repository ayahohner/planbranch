"use client";

import { Bot, Braces, Check, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { Executor, Operator } from "../../packages/domain/src";

interface OperatorEditorProps {
  operator?: Operator;
  disabled?: boolean;
  onCommit: (operator: Operator) => void;
  onClear: () => void;
}

export function OperatorEditor({
  operator,
  disabled,
  onCommit,
  onClear,
}: OperatorEditorProps) {
  const [editing, setEditing] = useState(false);
  const [executor, setExecutor] = useState<Executor>(
    operator?.executor ?? "llm",
  );
  const [name, setName] = useState(operator?.name ?? "");

  const begin = () => {
    setExecutor(operator?.executor ?? "llm");
    setName(operator?.name ?? "");
    setEditing(true);
  };

  if (disabled) {
    return (
      <div className="compound-operator-note">
        <Braces size={14} />
        Fulfilled by ordered subtasks
      </div>
    );
  }

  if (editing) {
    const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
    return (
      <div className="operator-form">
        <select
          aria-label="Executor"
          onChange={(event) => setExecutor(event.target.value as Executor)}
          value={executor}
        >
          <option value="llm">LLM</option>
          <option value="deterministic">Deterministic</option>
        </select>
        <input
          aria-label="Operator"
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
            if (event.key === "Enter" && valid) {
              onCommit({ executor, name });
              setEditing(false);
            }
          }}
          placeholder="direct-action-name"
          value={name}
        />
        <button
          aria-label="Save Operator"
          disabled={!valid}
          onClick={() => {
            onCommit({ executor, name });
            setEditing(false);
          }}
          type="button"
        >
          <Check size={14} />
        </button>
        <button
          aria-label="Cancel Operator edit"
          onClick={() => setEditing(false)}
          type="button"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  if (!operator) {
    return (
      <button className="define-operator" onClick={begin} type="button">
        <Bot size={14} />
        Define a direct Operator
      </button>
    );
  }

  return (
    <div className="operator-value">
      <span className={`executor-badge executor-${operator.executor}`}>
        {operator.executor === "llm" ? <Bot size={12} /> : <Braces size={12} />}
        {operator.executor === "llm" ? "LLM" : "Deterministic"}
      </span>
      <button className="operator-name" onClick={begin} type="button">
        <code>{operator.name}</code>
        <Pencil size={12} />
      </button>
      <button
        aria-label="Clear Operator"
        className="operator-clear"
        onClick={onClear}
        type="button"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
