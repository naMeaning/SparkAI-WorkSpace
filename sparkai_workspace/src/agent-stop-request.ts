export type AgentStopBridgeResponse = {
  ok?: unknown;
  stopped?: unknown;
  error?: unknown;
  [key: string]: unknown;
};

export type ConfirmedAgentStopResult =
  | { ok: true; response: AgentStopBridgeResponse & { ok: true } }
  | { ok: false; error: string };

function stopFailureDetail(value: unknown) {
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const error = (value as AgentStopBridgeResponse).error;
    if (typeof error === "string" && error.trim()) return error.trim();
  }
  return "底层没有返回有效的结束确认。";
}

/**
 * Commits Renderer cleanup only after Main has authoritatively accepted stop.
 * Rejections and malformed responses intentionally leave all local run state
 * untouched so the user can retry without a false idle transition.
 */
export async function confirmAgentStopRequest(
  request: () => Promise<unknown>,
  commit: (response: AgentStopBridgeResponse & { ok: true }) => void
): Promise<ConfirmedAgentStopResult> {
  let response: unknown;
  try {
    response = await request();
  } catch (error) {
    return { ok: false, error: stopFailureDetail(error) };
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return { ok: false, error: stopFailureDetail(response) };
  }
  const snapshot = response as AgentStopBridgeResponse;
  if (snapshot.ok !== true) return { ok: false, error: stopFailureDetail(snapshot) };
  const confirmed = snapshot as AgentStopBridgeResponse & { ok: true };
  commit(confirmed);
  return { ok: true, response: confirmed };
}
