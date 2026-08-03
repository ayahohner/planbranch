"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  runEventTypes,
  type ModelOption,
  type RunAction,
  type RunEvent,
} from "../../packages/domain/src";
import {
  MODEL_SELECTION_STORAGE_KEY,
  parsePersistedModelSelection,
  serializeModelSelection,
} from "./persistence";
import { useEditorStore } from "./store";

const API_BASE =
  process.env.NEXT_PUBLIC_MODEL_API ?? "http://127.0.0.1:8787/api";

interface HealthResponse {
  ok: boolean;
  runtime: {
    id: string;
    name: string;
    connected: boolean;
    version?: string;
    error?: string;
  };
  provider: {
    name: string;
    authenticated: boolean;
    authentication?: string;
    authenticationMode?: string;
    requiredAuthenticationMode?: string;
    error?: string;
  };
  model: {
    name: string;
    available: boolean;
    reasoningEffort?: string;
  };
  models: ModelOption[];
}

interface RunSnapshotResponse {
  id: string;
  state: "running" | "completed" | "failed" | "cancelled";
  events: RunEvent[];
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function useRuns() {
  const tree = useEditorStore((state) => state.tree);
  const activeRun = useEditorStore((state) => state.activeRun);
  const modelHealth = useEditorStore((state) => state.modelHealth);
  const beginRun = useEditorStore((state) => state.beginRun);
  const applyRunEvent = useEditorStore((state) => state.applyRunEvent);
  const cancelActiveRun = useEditorStore((state) => state.cancelActiveRun);
  const failActiveRun = useEditorStore((state) => state.failActiveRun);
  const setModelHealth = useEditorStore((state) => state.setModelHealth);
  const setModelCatalog = useEditorStore((state) => state.setModelCatalog);
  const restoreModelSelection = useEditorStore(
    (state) => state.restoreModelSelection,
  );
  const setNotice = useEditorStore((state) => state.setNotice);
  const setActivityOpen = useEditorStore((state) => state.setActivityOpen);
  const sourceRef = useRef<EventSource | null>(null);
  const lastSequenceRef = useRef(0);
  const recoveringRef = useRef(false);

  const refreshHealth = useCallback(async () => {
    const current = useEditorStore.getState().modelHealth;
    setModelHealth({
      status: "checking",
      name: current.name,
      runtime: current.runtime,
      provider: current.provider,
      reasoningEffort: current.reasoningEffort,
    });
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (!response.ok) throw new Error(`Health check returned ${response.status}.`);
      const health = (await response.json()) as HealthResponse;
      setModelCatalog(
        health.models,
        health.model.name,
        health.model.reasoningEffort,
      );
      const selection = useEditorStore.getState().modelHealth;
      const selectedAvailable = health.models.some(
        (option) => option.model === selection.name,
      );
      const ready =
        health.runtime.connected &&
        health.provider.authenticated &&
        selectedAvailable;
      setModelHealth({
        status: ready
          ? "ready"
          : health.runtime.connected
            ? "unavailable"
            : "offline",
        name: selection.name,
        runtime: health.runtime.name,
        provider: health.provider.name,
        authentication: health.provider.authentication,
        reasoningEffort: selection.reasoningEffort,
        version: health.runtime.version,
        error:
          health.runtime.error ??
          health.provider.error ??
          (!health.provider.authenticated
            ? `Sign in to ${health.runtime.name}.`
            : !selectedAvailable
              ? `${selection.name} is unavailable for this account or provider.`
              : undefined),
      });
    } catch (error) {
      const fallback = useEditorStore.getState().modelHealth;
      setModelHealth({
        status: "offline",
        name: fallback.name,
        runtime: fallback.runtime,
        provider: fallback.provider,
        reasoningEffort: fallback.reasoningEffort,
        error:
          error instanceof Error
            ? error.message
            : "The configured model runtime is unavailable.",
      });
    }
  }, [setModelCatalog, setModelHealth]);

  useEffect(() => {
    try {
      const source = window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY);
      if (source) {
        const selection = parsePersistedModelSelection(source);
        restoreModelSelection(selection.model, selection.reasoningEffort);
      }
    } catch {
      try {
        window.localStorage.removeItem(MODEL_SELECTION_STORAGE_KEY);
      } catch {
        // Storage can be unavailable in restricted browser contexts.
      }
    }

    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (
        state.modelHealth.name === previous.modelHealth.name &&
        state.modelHealth.reasoningEffort ===
          previous.modelHealth.reasoningEffort
      ) {
        return;
      }
      if (!state.modelHealth.reasoningEffort) return;
      try {
        window.localStorage.setItem(
          MODEL_SELECTION_STORAGE_KEY,
          serializeModelSelection({
            model: state.modelHealth.name,
            reasoningEffort: state.modelHealth.reasoningEffort,
          }),
        );
      } catch {
        // A blocked preference write should not interrupt planning work.
      }
    });

    void refreshHealth();
    const interval = window.setInterval(() => void refreshHealth(), 30_000);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [refreshHealth, restoreModelSelection]);

  useEffect(
    () => () => {
      sourceRef.current?.close();
    },
    [],
  );

  const startRun = useCallback(
    async (action: RunAction, targetTaskId: string) => {
      if (activeRun) return;
      if (modelHealth.status !== "ready") {
        setActivityOpen(true);
        setNotice({
          kind: "error",
          message:
            modelHealth.error ??
            `${modelHealth.name} is not ready through ${modelHealth.runtime}.`,
        });
        return;
      }

      try {
        const response = await fetch(`${API_BASE}/runs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            tree,
            targetTaskId,
            model: modelHealth.name,
            reasoningEffort: modelHealth.reasoningEffort,
          }),
        });
        const body = (await response.json()) as {
          runId?: string;
          error?: string;
        };
        if (!response.ok || !body.runId) {
          throw new Error(body.error ?? "The Run could not be started.");
        }

        beginRun(body.runId, action, targetTaskId);
        lastSequenceRef.current = 0;
        recoveringRef.current = false;
        sourceRef.current?.close();
        const source = new EventSource(`${API_BASE}/runs/${body.runId}/events`);
        sourceRef.current = source;

        const acceptEvent = (event: RunEvent) => {
          if (event.runId !== body.runId) return;
          if (event.sequence <= lastSequenceRef.current) return;
          lastSequenceRef.current = event.sequence;
          applyRunEvent(event);
          if (
            event.type === "run.completed" ||
            event.type === "run.failed" ||
            event.type === "run.cancelled"
          ) {
            source.close();
            if (sourceRef.current === source) sourceRef.current = null;
            recoveringRef.current = false;
            void refreshHealth();
          }
        };

        runEventTypes.forEach((type) => {
          source.addEventListener(type, (message) => {
            try {
              acceptEvent(
                JSON.parse((message as MessageEvent<string>).data) as RunEvent,
              );
            } catch {
              source.close();
              if (sourceRef.current === source) sourceRef.current = null;
              failActiveRun(
                "The local model service sent an invalid Run event.",
              );
              void refreshHealth();
            }
          });
        });

        source.onerror = () => {
          if (sourceRef.current !== source || recoveringRef.current) return;
          recoveringRef.current = true;
          void (async () => {
            let lastError = "The local model service stopped responding.";
            for (let attempt = 1; attempt <= 3; attempt += 1) {
              if (sourceRef.current !== source) return;
              try {
                const response = await fetch(
                  `${API_BASE}/runs/${body.runId}`,
                  { cache: "no-store" },
                );
                if (!response.ok) {
                  throw new Error(
                    response.status === 404
                      ? "The model service no longer has this Run."
                      : `Run recovery returned ${response.status}.`,
                  );
                }
                const snapshot =
                  (await response.json()) as RunSnapshotResponse;
                snapshot.events
                  .filter(
                    (event) => event.sequence > lastSequenceRef.current,
                  )
                  .sort((left, right) => left.sequence - right.sequence)
                  .forEach(acceptEvent);
                recoveringRef.current = false;
                return;
              } catch (error) {
                lastError =
                  error instanceof Error ? error.message : lastError;
                if (attempt < 3) await wait(250 * attempt);
              }
            }
            if (sourceRef.current !== source) return;
            source.close();
            sourceRef.current = null;
            recoveringRef.current = false;
            failActiveRun(
              `The Run stream disconnected. ${lastError}`,
            );
            void refreshHealth();
          })();
        };
      } catch (error) {
        setActivityOpen(true);
        setNotice({
          kind: "error",
          message:
            error instanceof Error ? error.message : "The Run could not start.",
        });
      }
    },
    [
      activeRun,
      applyRunEvent,
      beginRun,
      failActiveRun,
      modelHealth,
      refreshHealth,
      setActivityOpen,
      setNotice,
      tree,
    ],
  );

  const cancelRun = useCallback(async () => {
    if (!activeRun) return;
    try {
      const response = await fetch(`${API_BASE}/runs/${activeRun.id}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          body?.error ?? `Cancellation returned ${response.status}.`,
        );
      }
      sourceRef.current?.close();
      sourceRef.current = null;
      cancelActiveRun();
    } catch (error) {
      sourceRef.current?.close();
      sourceRef.current = null;
      cancelActiveRun();
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? `The service could not confirm cancellation (${error.message}). The local draft was undone.`
            : "The service could not confirm cancellation. The local draft was undone.",
      });
      void refreshHealth();
    }
  }, [activeRun, cancelActiveRun, refreshHealth, setNotice]);

  return {
    startRun,
    cancelRun,
    refreshHealth,
    modelHealth,
    activeRun,
  };
}
