"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CirclePlus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

interface InlineTextProps {
  value: string;
  placeholder: string;
  multiline?: boolean;
  className?: string;
  onCommit: (value: string) => void;
}

export function InlineText({
  value,
  placeholder,
  multiline = false,
  className = "",
  onCommit,
}: InlineTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const committed = useRef(false);

  const save = () => {
    if (committed.current) return;
    committed.current = true;
    const next = draft.trim();
    setEditing(false);
    if (next !== value && (multiline || next.length > 0)) onCommit(next);
  };

  const cancel = () => {
    committed.current = true;
    setDraft(value);
    setEditing(false);
  };

  const begin = () => {
    committed.current = false;
    setDraft(value);
    setEditing(true);
  };

  const handleKey = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
    if (event.key === "Enter" && (!multiline || !event.shiftKey)) {
      event.preventDefault();
      save();
    }
  };

  if (editing) {
    const common = {
      autoFocus: true,
      value: draft,
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => setDraft(event.target.value),
      onBlur: save,
      onKeyDown: handleKey,
      "aria-label": placeholder,
      className: `inline-field-input ${className}`,
    };
    return multiline ? (
      <textarea {...common} rows={4} />
    ) : (
      <input {...common} />
    );
  }

  return (
    <button
      className={`inline-field-display ${className}`}
      onClick={begin}
      type="button"
    >
      <span className={value ? "" : "inline-field-placeholder"}>
        {value || placeholder}
      </span>
      <Pencil aria-hidden="true" size={13} />
    </button>
  );
}

interface EditableListProps {
  values: string[];
  emptyLabel: string;
  addLabel: string;
  onCommit: (values: string[]) => void;
}

export function EditableList({
  values,
  emptyLabel,
  addLabel,
  onCommit,
}: EditableListProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const add = () => {
    const next = draft.trim();
    if (next) onCommit([...values, next]);
    setDraft("");
    setAdding(false);
  };

  const revise = (index: number, value: string) => {
    const next = value.trim();
    if (!next) return;
    onCommit(values.map((current, itemIndex) =>
      itemIndex === index ? next : current,
    ));
    setEditingIndex(null);
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= values.length) return;
    const next = [...values];
    [next[index], next[target]] = [next[target], next[index]];
    onCommit(next);
  };

  return (
    <div className="editable-list">
      <div className="editable-list-values">
        {values.length === 0 && !adding ? (
          <span className="editable-list-empty">{emptyLabel}</span>
        ) : null}
        {values.map((value, index) =>
          editingIndex === index ? (
            <input
              aria-label={`Edit ${value}`}
              autoFocus
              className="token-input"
              defaultValue={value}
              key={`${value}-${index}`}
              onBlur={(event) => revise(index, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  revise(index, event.currentTarget.value);
                }
                if (event.key === "Escape") setEditingIndex(null);
              }}
            />
          ) : (
            <span className="editable-token" key={`${value}-${index}`}>
              <button
                className="editable-token-label"
                onClick={() => setEditingIndex(index)}
                type="button"
              >
                {value}
              </button>
              <span className="editable-token-actions">
                <button
                  aria-label={`Move ${value} left`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  type="button"
                >
                  <ArrowLeft size={11} />
                </button>
                <button
                  aria-label={`Move ${value} right`}
                  disabled={index === values.length - 1}
                  onClick={() => move(index, 1)}
                  type="button"
                >
                  <ArrowRight size={11} />
                </button>
                <button
                  aria-label={`Remove ${value}`}
                  onClick={() =>
                    onCommit(values.filter((_, itemIndex) => itemIndex !== index))
                  }
                  type="button"
                >
                  <Trash2 size={11} />
                </button>
              </span>
            </span>
          ),
        )}
        {adding ? (
          <span className="token-add-row">
            <input
              aria-label={addLabel}
              autoFocus
              className="token-input"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
                if (event.key === "Escape") {
                  setAdding(false);
                  setDraft("");
                }
              }}
              placeholder={addLabel}
              value={draft}
            />
            <button aria-label="Save value" onClick={add} type="button">
              <Check size={13} />
            </button>
            <button
              aria-label="Cancel"
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
              type="button"
            >
              <X size={13} />
            </button>
          </span>
        ) : (
          <button
            className="token-add-button"
            onClick={() => setAdding(true)}
            type="button"
          >
            <CirclePlus size={13} />
            {addLabel}
          </button>
        )}
      </div>
    </div>
  );
}
