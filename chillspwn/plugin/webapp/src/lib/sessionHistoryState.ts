export interface SessionHistoryRuntimePayload {
  status?: string;
  isLive?: boolean;
  turnActive?: boolean;
}

export interface SessionHistoryRuntimeState {
  isLive: boolean;
  turnActive: boolean;
}

/**
 * Separate provider-process liveness from active model generation.
 *
 * The fallback preserves compatibility with older dashboard servers that only
 * sent `status: "running"`, where running historically meant both values.
 */
export function resolveSessionHistoryState(
  payload: SessionHistoryRuntimePayload,
): SessionHistoryRuntimeState {
  const isLive = typeof payload.isLive === "boolean"
    ? payload.isLive
    : payload.status === "running";
  const turnActive = typeof payload.turnActive === "boolean"
    ? payload.turnActive
    : isLive;
  return { isLive, turnActive };
}
