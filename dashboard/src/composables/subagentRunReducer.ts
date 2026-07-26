// Author: elecvoid243
// Date: 2026-07-26
// Plan: docs/superpowers/plans/2026-07-26-subagent-chatui-progress.md (Task 5)
// Live reducer for structured `subagent_event` stream payloads. The part is
// pushed at first-seen position and mutated in place so Vue reactivity
// updates the SubAgentRunBlock as tokens arrive.
import type { MessagePart } from "./normalizeMessageParts.ts";

export interface SubAgentToolCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
  result?: string;
  [key: string]: unknown;
}

export type SubAgentActivity =
  | { kind: "think"; text: string }
  | { kind: "tool_call"; call: SubAgentToolCall };

export interface SubAgentRunPart {
  type: "subagent_run";
  subagent_run_id: string;
  agent_name: string;
  status: "running" | "completed" | "failed" | "timeout";
  input_preview: string;
  input_full?: string;
  text: string;
  reasoning: string;
  tool_calls: SubAgentToolCall[];
  activity: SubAgentActivity[];
  started_ts?: number;
  execution_time?: number | null;
  error?: string;
  [key: string]: unknown;
}

export interface SubAgentEventData {
  subagent_run_id?: string;
  agent_name?: string;
  kind?: string;
  payload?: Record<string, unknown>;
  ts?: number;
}

export function applySubAgentEvent(parts: MessagePart[], data: unknown): void {
  if (!data || typeof data !== "object") return;
  const event = data as SubAgentEventData;
  const runId = String(event.subagent_run_id || "");
  if (!runId) return;
  const kind = String(event.kind || "");
  const payload =
    event.payload && typeof event.payload === "object" ? event.payload : {};

  let part: SubAgentRunPart | undefined;
  for (const p of parts) {
    if (p.type === "subagent_run" && p.subagent_run_id === runId) {
      part = p as unknown as SubAgentRunPart;
      break;
    }
  }
  if (!part) {
    const created: SubAgentRunPart = {
      type: "subagent_run",
      subagent_run_id: runId,
      agent_name: String(event.agent_name || ""),
      status: "running",
      input_preview: "",
      text: "",
      reasoning: "",
      tool_calls: [],
      activity: [],
      started_ts: event.ts,
      execution_time: null,
    };
    parts.push(created as MessagePart);
    part = created;
  }

  if (!Array.isArray(part.activity)) part.activity = [];

  if (kind === "started") {
    part.input_preview = String(payload.input_preview || "");
    part.input_full = String(payload.input_full || "");
  } else if (kind === "text_delta") {
    part.text += String(payload.text || "");
  } else if (kind === "reasoning_delta") {
    const text = String(payload.text || "");
    part.reasoning += text;
    // Append to the current think block, or open a new one when a tool
    // call happened in between — this preserves the chronological
    // think -> tool_call -> think -> tool_call order of the LLM loop.
    const last = part.activity[part.activity.length - 1];
    if (last && last.kind === "think") {
      last.text += text;
    } else {
      part.activity.push({ kind: "think", text });
    }
  } else if (kind === "tool_call") {
    const callId = payload.id;
    if (callId != null) {
      const existing = part.tool_calls.find((t) => t.id === callId);
      if (existing) {
        Object.assign(existing, payload);
      } else {
        const call = { ...payload } as SubAgentToolCall;
        part.tool_calls.push(call);
        part.activity.push({ kind: "tool_call", call });
      }
    }
  } else if (kind === "tool_call_result") {
    const callId = payload.id;
    const existing = part.tool_calls.find((t) => t.id === callId);
    if (existing) {
      existing.result = String(payload.result ?? "");
    } else if (callId != null) {
      const call = { ...payload } as SubAgentToolCall;
      part.tool_calls.push(call);
      part.activity.push({ kind: "tool_call", call });
    }
  } else if (kind === "completed") {
    part.status = "completed";
    if (!part.text && payload.result_text) {
      part.text = String(payload.result_text);
    }
    if (typeof payload.execution_time === "number") {
      part.execution_time = payload.execution_time;
    }
  } else if (kind === "failed" || kind === "timeout") {
    part.status = kind;
    if (payload.error) part.error = String(payload.error);
  }
}
