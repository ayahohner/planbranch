"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  runEventTypes,
  type RunAction,
  type RunEvent,
} from "../../packages/domain/src";
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
}

export function useRuns() {
  const tree = useEditorStore((state) => state.tree);
  const activeRun = useEditorStore((state) => state.activeRun);
  const modelHealth = useEditorStore((state) => state.modelHealth);
  const beginRun = useEditorStore((state) => state.beginRun);
  const applyRunEvent = useEditorStore((state) => state.applyRunEvent);
  const cancelActiveRun = useEditorStore((state) => state.cancelActiveRun);
  const setModelHealth = useEditorStore((state) => state.setModelHealth);
  const setNotice = useEditorStore((state) => state.setNotice);
  const setActivityOpen = useEditorStore((state) => state.setActivityOpen);
  const sourceRef = useRef<EventSource | null>(null);

  const refreshHealth = useCallback(async () => {
    setModelHealth({
      status: "checking",
      name: modelHealth.name,
      runtime: modelHealth.runtime,
      provider: modelHealth.provider,
      reasoningEffort: modelHealth.reasoningEffort,
    });
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (!response.ok) throw new Error(`Health check returned ${response.status}.`);
      const health = (await response.json()) as HealthResponse;
      setModelHealth({
        status: health.ok
          ? "ready"
          : health.runtime.connected
            ? "unavailable"
            : "offline",
        name: health.model.name,
        runtime: health.runtime.name,
        provider: health.provider.name,
        authentication: health.provider.authentication,
        reasoningEffort: health.model.reasoningEffort,
        version: health.runtime.version,
        error:
          health.runtime.error ??
          health.provider.error ??
          (!health.provider.authenticated
            ? `Sign in to ${health.runtime.name}.`
            : !health.model.available
              ? `${health.model.name} is unavailable for this account or provider.`
              : undefined),
      });
    } catch (error) {
      setModelHealth({
        status: "offline",
        name: modelHealth.name,
        runtime: modelHealth.runtime,
        provider: modelHealth.provider,
        reasoningEffort: modelHealth.reasoningEffort,
        error:
          error instanceof Error
            ? error.message
            : "The configured model runtime is unavailable.",
      });
    }
  }, [
    modelHealth.name,
    modelHealth.provider,
    modelHealth.reasoningEffort,
    modelHealth.runtime,
    setModelHealth,
  ]);

  useEffect(() => {
    void refreshHealth();
    const interval = window.setInterval(() => void refreshHealth(), 30_000);
    return () => window.clearInterval(interval);
  }, [refreshHealth]);

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
          body: JSON.stringify({ action, tree, targetTaskId }),
        });
        const body = (await response.json()) as {
          runId?: string;
          error?: string;
        };
        if (!response.ok || !body.runId) {
          throw new Error(body.error ?? "The Run could not be started.");
        }

        beginRun(body.runId, action, targetTaskId);
        sourceRef.current?.close();
        const source = new EventSource(`${API_BASE}/runs/${body.runId}/events`);
        sourceRef.current = source;

        runEventTypes.forEach((type) => {
          source.addEventListener(type, (message) => {
            const event = JSON.parse(
              (message as MessageEvent<string>).data,
            ) as RunEvent;
            applyRunEvent(event);
            if (
              event.type === "run.completed" ||
              event.type === "run.failed" ||
              event.type === "run.cancelled"
            ) {
              source.close();
              sourceRef.current = null;
              void refreshHealth();
            }
          });
        });
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
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? `Cancellation failed: ${error.message}`
            : "The cancellation request could not reach the local service.",
      });
    }
  }, [activeRun, cancelActiveRun, setNotice]);

  return {
    startRun,
    cancelRun,
    refreshHealth,
    modelHealth,
    activeRun,
  };
}
