// Author: elecvoid243
// Date: 2026-07-25
// Plan: docs/superpowers/plans/2026-07-25-webchat-system-event-stream.md Task 5
//
// Leaf module: webchat system event stream payload → chat record updates.
// No `@/api` imports so the module is testable under node --test.
//
// The system stream carries mirrored webchat payloads for turns that have no
// active primary chat run (goal-loop synthetic turns and future system
// flows). Each orphan turn is keyed by its `message_id`; plain payloads grow
// a live bot record, `complete`/`end` finalize it. The backend persists the
// turn on its side, so on the next history reload the persisted record
// replaces this local one.

export interface SystemMessagePart {
  type: string;
  text?: string;
}

export interface SystemBotRecord {
  id?: string | number;
  created_at?: string;
  content: {
    type: string;
    message: SystemMessagePart[];
    reasoning?: string;
    isLoading?: boolean;
  };
}

export interface SystemStreamState {
  /** sessionId → messageId → live record while its turn is in flight. */
  liveBySession: Record<string, Record<string, SystemBotRecord>>;
}

export function createSystemStreamState(): SystemStreamState {
  return { liveBySession: {} };
}

/**
 * Apply one system stream payload to the session record list.
 *
 * Args:
 *   state: Shared live-turn tracking created by createSystemStreamState().
 *   sessionId: Conversation the payload belongs to.
 *   records: The session's mutable record list (messagesBySession entry).
 *   payload: Raw mirrored webchat payload.
 *
 * Returns:
 *   True when the payload was consumed (caller may notify stream update).
 */
export function processSystemPayload(
  state: SystemStreamState,
  sessionId: string,
  records: SystemBotRecord[],
  payload: any,
): boolean {
  const type = payload?.type;
  if (type !== "plain" && type !== "complete" && type !== "end") return false;
  const messageId = payload?.message_id;
  if (messageId == null || messageId === "") return false;
  const key = String(messageId);

  const live = (state.liveBySession[sessionId] =
    state.liveBySession[sessionId] || {});
  let record = live[key];
  if (!record) {
    record = {
      id: `system-${key}`,
      created_at: new Date().toISOString(),
      content: { type: "bot", message: [], reasoning: "", isLoading: true },
    };
    live[key] = record;
    records.push(record);
  }

  if (type === "plain") {
    const data = typeof payload.data === "string" ? payload.data : "";
    if (!data) return true;
    if (payload.streaming) {
      // Streaming chunks are deltas: append into the trailing plain part.
      let last = record.content.message[record.content.message.length - 1];
      if (!last || last.type !== "plain") {
        last = { type: "plain", text: "" };
        record.content.message.push(last);
      }
      last.text = `${last.text || ""}${data}`;
    } else {
      record.content.message.push({ type: "plain", text: data });
    }
    return true;
  }

  // complete / end: finalize the turn without duplicating already shown text.
  if (
    type === "complete" &&
    record.content.message.length === 0 &&
    typeof payload.data === "string" &&
    payload.data
  ) {
    record.content.message.push({ type: "plain", text: payload.data });
  }
  if (typeof payload.reasoning === "string" && payload.reasoning) {
    record.content.reasoning = payload.reasoning;
  }
  record.content.isLoading = false;
  delete live[key];
  return true;
}

/**
 * Finalize all live turns of a session (stream aborted or session switched).
 */
export function finalizeSystemSession(
  state: SystemStreamState,
  sessionId: string,
): void {
  const live = state.liveBySession[sessionId];
  if (!live) return;
  for (const record of Object.values(live)) {
    record.content.isLoading = false;
  }
  delete state.liveBySession[sessionId];
}
