import type { RunEvent, RunEventType } from "./types";

export function createRunEvent<T>(
  runId: string,
  attempt: number,
  sequence: number,
  type: RunEventType,
  payload: T,
): RunEvent<T> {
  return {
    runId,
    attempt,
    sequence,
    timestamp: new Date().toISOString(),
    type,
    payload,
  };
}
