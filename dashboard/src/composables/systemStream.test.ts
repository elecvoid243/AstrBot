// Author: elecvoid243
// Date: 2026-07-25
// Plan: docs/superpowers/plans/2026-07-25-webchat-system-event-stream.md Task 5
//
// Leaf-module tests for the webchat system event stream payload handler.
// The leaf has no `@/api` dependency so it runs under node --test.
//
// Run: cd dashboard && pnpm exec node --test src/composables/systemStream.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSystemStreamState,
  finalizeSystemSession,
  processSystemPayload,
  type SystemBotRecord,
} from "./systemStream.ts";

function makeRecords(): SystemBotRecord[] {
  return [];
}

test("non-streaming plain creates a live bot record with the text", () => {
  const state = createSystemStreamState();
  const records = makeRecords();

  const consumed = processSystemPayload(state, "s1", records, {
    type: "plain",
    data: "goal turn output",
    streaming: false,
    message_id: "orphan-1",
  });

  assert.equal(consumed, true);
  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(record.content.type, "bot");
  // 2026-07-25 fix: the first content-bearing payload clears the "加载中"
  // placeholder (mirrors `markMessageStarted` in the primary path), so
  // streaming content renders live instead of staying hidden behind the
  // loading div until complete/end.
  assert.equal(record.content.isLoading, false);
  assert.deepEqual(record.content.message, [
    { type: "plain", text: "goal turn output" },
  ]);
  assert.equal(state.liveBySession["s1"]["orphan-1"], record);
});

test("streaming plain chunks append into the same record", () => {
  const state = createSystemStreamState();
  const records = makeRecords();

  for (const chunk of ["Hello, ", "world"]) {
    processSystemPayload(state, "s1", records, {
      type: "plain",
      data: chunk,
      streaming: true,
      message_id: "orphan-2",
    });
  }

  assert.equal(records.length, 1);
  assert.deepEqual(records[0].content.message, [
    { type: "plain", text: "Hello, world" },
  ]);
});

test("first streaming chunk clears isLoading while the turn stays live", () => {
  // 2026-07-25 fix: goal-loop turns previously showed "加载中" for the
  // whole turn (isLoading only cleared on complete/end), hiding the
  // streamed chunks behind the loading div. The first chunk must flip
  // the flag so content renders live; live tracking itself is only
  // released by complete/end.
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "plain",
    data: "partial",
    streaming: true,
    message_id: "orphan-loading",
  });

  assert.equal(records[0].content.isLoading, false);
  assert.ok(state.liveBySession["s1"]["orphan-loading"]);

  // A reasoning chunk after the first plain must not re-arm the flag.
  processSystemPayload(state, "s1", records, {
    type: "plain",
    chain_type: "reasoning",
    data: "thinking",
    streaming: true,
    message_id: "orphan-loading",
  });
  assert.equal(records[0].content.isLoading, false);
});

test("two orphan turns map to separate records by message_id", () => {
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "plain",
    data: "turn A",
    streaming: false,
    message_id: "a",
  });
  processSystemPayload(state, "s1", records, {
    type: "plain",
    data: "turn B",
    streaming: false,
    message_id: "b",
  });

  assert.equal(records.length, 2);
  assert.equal(records[0].content.message[0].text, "turn A");
  assert.equal(records[1].content.message[0].text, "turn B");
});

test("complete finalizes the record and clears live tracking", () => {
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "plain",
    data: "done",
    streaming: false,
    message_id: "orphan-3",
  });
  const consumed = processSystemPayload(state, "s1", records, {
    type: "complete",
    data: "done",
    streaming: false,
    message_id: "orphan-3",
  });

  assert.equal(consumed, true);
  assert.equal(records[0].content.isLoading, false);
  // Text already shown by the plain payload must not be duplicated.
  assert.equal(records[0].content.message.length, 1);
  assert.equal(state.liveBySession["s1"]?.["orphan-3"], undefined);
});

test("complete with reasoning synthesises a think part when none exists", () => {
  // 2026-07-25 fix: webchat's `send_streaming` accumulates the full
  // reasoning string into the final `complete` payload's `reasoning`
  // field. Previously the leaf only mirrored it into `content.reasoning`
  // without creating a `think` part, so `messageBlocks` had no thinking
  // block to render and the ReasoningTimeline never opened. Synthesise
  // the missing think part so goal-loop turns surface their reasoning.
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "complete",
    data: "final answer",
    reasoning: "thinking about the poem",
    streaming: true,
    message_id: "orphan-complete-reasoning",
  });

  const parts = records[0].content.message;
  const thinkParts = parts.filter(
    (p) => p.type === "think",
  );
  assert.equal(thinkParts.length, 1);
  assert.equal(thinkParts[0].think, "thinking about the poem");
  // Final answer is still pushed as a plain part.
  assert.equal(records[0].content.message.some(
    (p) => p.type === "plain" && p.text === "final answer",
  ), true);
  assert.equal(records[0].content.isLoading, false);
});

test("complete with reasoning does not duplicate an existing think part", () => {
  // If the per-chain reasoning payload already created a think part
  // (e.g. the LLM streamed reasoning), the `complete` payload's
  // aggregated reasoning must NOT append a duplicate. The record also
  // shows the pre-existing dedup: the `complete` payload's plain data
  // is dropped when the record is non-empty (the streaming path
  // already delivered the text).
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "plain",
    chain_type: "reasoning",
    data: "thinking about the poem",
    streaming: false,
    message_id: "orphan-dup",
  });
  processSystemPayload(state, "s1", records, {
    type: "complete",
    data: "final answer",
    reasoning: "thinking about the poem",
    streaming: true,
    message_id: "orphan-dup",
  });

  const thinkParts = records[0].content.message.filter(
    (p) => p.type === "think",
  );
  assert.equal(thinkParts.length, 1);
  assert.equal(records[0].content.message.length, 1);
  assert.equal(records[0].content.isLoading, false);
});

test("complete without preceding plain still surfaces the final text", () => {
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "complete",
    data: "late subscriber text",
    reasoning: "thoughts",
    streaming: true,
    message_id: "orphan-4",
  });

  // 2026-07-25 fix: a `complete` carrying reasoning now also synthesises
  // a `think` part so the ReasoningTimeline can render it (see the
  // "complete with reasoning synthesises a think part" test).
  assert.deepEqual(records[0].content.message, [
    { type: "think", think: "thoughts" },
    { type: "plain", text: "late subscriber text" },
  ]);
  assert.equal(records[0].content.reasoning, "thoughts");
  assert.equal(records[0].content.isLoading, false);
});

test("unrelated payload types are ignored without creating records", () => {
  const state = createSystemStreamState();
  const records = makeRecords();

  for (const payload of [
    { type: "run_started", data: { run_id: "x" }, message_id: "x" },
    { type: "audio_chunk", data: "b64", message_id: "x" },
    { type: "plain", data: "no id" },
  ]) {
    assert.equal(processSystemPayload(state, "s1", records, payload), false);
  }
  assert.equal(records.length, 0);
});

test("finalizeSystemSession stops spinners of interrupted turns", () => {
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "plain",
    data: "partial",
    streaming: true,
    message_id: "orphan-5",
  });
  finalizeSystemSession(state, "s1");

  assert.equal(records[0].content.isLoading, false);
  assert.equal(state.liveBySession["s1"], undefined);
});

// ── 2026-07-25 chain_type dispatch (Bug fix, see user report)
// Before this fix, the leaf only recognised `type ∈ {"plain","complete",
// "end"}` and appended every payload as plain text. Goal-loop turns that
// emit tool_call / tool_call_result / reasoning / agent_stats /
// interactive_choice events therefore rendered their JSON wire payloads
// inline in the chat bubble, never forming the "思考了 X 次，使用了 Y 次
// 工具" reasoning block. The tests below cover the new dispatch.

test("tool_call chain_type produces a tool_call part with the parsed JSON", () => {
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "plain",
    chain_type: "tool_call",
    data: JSON.stringify({
      id: "call_019f98283c347770a06a7835",
      name: "astrbot_file_write_tool",
      args: { content: "hello" },
      ts: 1784964201.97,
    }),
    streaming: false,
    message_id: "orphan-tool",
  });

  const parts = records[0].content.message;
  assert.equal(parts.length, 1);
  const part = parts[0] as {
    type: string;
    tool_calls?: Array<Record<string, unknown>>;
  };
  assert.equal(part.type, "tool_call");
  assert.ok(Array.isArray(part.tool_calls));
  const tc0 = part.tool_calls![0];
  assert.equal(tc0.id, "call_019f98283c347770a06a7835");
  assert.equal(tc0.name, "astrbot_file_write_tool");
  assert.deepEqual(tc0.args, { content: "hello" });
});

test("tool_call_result merges into the matching tool_call by id", () => {
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "plain",
    chain_type: "tool_call",
    data: JSON.stringify({
      id: "call_1",
      name: "read_file",
      args: { path: "/tmp/x" },
      ts: 1.0,
    }),
    streaming: false,
    message_id: "orphan-merge",
  });
  processSystemPayload(state, "s1", records, {
    type: "plain",
    chain_type: "tool_call_result",
    data: JSON.stringify({
      id: "call_1",
      result: "contents",
      ts: 1.5,
    }),
    streaming: false,
    message_id: "orphan-merge",
  });
  processSystemPayload(state, "s1", records, {
    type: "complete",
    streaming: false,
    message_id: "orphan-merge",
  });

  const parts = records[0].content.message;
  // The single tool_call part carries both args and result. No raw JSON
  // plain text leaks through.
  assert.equal(parts.length, 1);
  const part = parts[0] as {
    type: string;
    tool_calls?: Array<Record<string, unknown>>;
  };
  assert.equal(part.type, "tool_call");
  assert.equal(part.tool_calls!.length, 1);
  const tc0 = part.tool_calls![0];
  assert.equal(tc0.id, "call_1");
  assert.equal(tc0.result, "contents");
  assert.equal(tc0.finished_ts, 1.5);
});

test("tool_call_result without a prior tool_call still produces a part", () => {
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "plain",
    chain_type: "tool_call_result",
    data: JSON.stringify({
      id: "call_orphan",
      result: "still rendered",
      ts: 2.0,
    }),
    streaming: false,
    message_id: "orphan-orphan-result",
  });
  processSystemPayload(state, "s1", records, {
    type: "complete",
    streaming: false,
    message_id: "orphan-orphan-result",
  });

  const parts = records[0].content.message;
  assert.equal(parts.length, 1);
  const part = parts[0] as {
    type: string;
    tool_calls?: Array<Record<string, unknown>>;
  };
  assert.equal(part.type, "tool_call");
  const tc0 = part.tool_calls![0];
  assert.equal(tc0.id, "call_orphan");
  assert.equal(tc0.result, "still rendered");
});

test("reasoning chain_type produces a think part and sets the side-bar field", () => {
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "plain",
    chain_type: "reasoning",
    data: "thinking about the poem",
    streaming: false,
    message_id: "orphan-reasoning",
  });
  processSystemPayload(state, "s1", records, {
    type: "plain",
    chain_type: "reasoning",
    data: " (continued)",
    streaming: true,
    message_id: "orphan-reasoning",
  });

  const parts = records[0].content.message;
  // Multiple reasoning chunks should merge into a single `think` part so
  // the "思考了 X 次" counter stays at 1.
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "think");
  assert.equal(parts[0].think, "thinking about the poem (continued)");
  assert.equal(
    records[0].content.reasoning,
    "thinking about the poem (continued)",
  );
});

test("agent_stats chain_type stores on the record and does not leak JSON", () => {
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "plain",
    chain_type: "agent_stats",
    data: JSON.stringify({
      token_usage: { input_other: 227, output: 50 },
    }),
    streaming: false,
    message_id: "orphan-stats",
  });
  processSystemPayload(state, "s1", records, {
    type: "plain",
    data: "response text",
    streaming: false,
    message_id: "orphan-stats",
  });

  // agent_stats must NOT create a plain part containing the raw JSON.
  assert.equal(records[0].content.message.length, 1);
  assert.equal(records[0].content.message[0].type, "plain");
  assert.equal(records[0].content.message[0].text, "response text");
  assert.deepEqual(records[0].content.agentStats, {
    token_usage: { input_other: 227, output: 50 },
  });
});

test("top-level agent_stats event sets the same field", () => {
  // The primary consumer republishes agent_stats as
  // `{type: "agent_stats", data: {...}}` (no chain_type). Make sure the
  // leaf accepts that shape too.
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "agent_stats",
    data: { token_usage: { input_other: 999 } },
    message_id: "orphan-stats-top",
  });

  assert.equal(records[0].content.message.length, 0);
  assert.deepEqual(records[0].content.agentStats, {
    token_usage: { input_other: 999 },
  });
});

test("interactive_choice chain_type pushes an interactive_choice part", () => {
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "plain",
    chain_type: "interactive_choice",
    data: JSON.stringify({
      request_id: "req-123",
      spec: {
        type: "interactive_choice",
        prompt: "Pick a color",
        options: [
          { id: "red", label: "Red" },
          { id: "blue", label: "Blue" },
        ],
      },
      expires_at: 1800000000,
    }),
    streaming: false,
    message_id: "orphan-choice",
  });

  const parts = records[0].content.message;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "interactive_choice");
  assert.equal(parts[0].request_id, "req-123");
  assert.equal(parts[0].prompt, "Pick a color");
});

test("ask_user_choice tool_call is filtered and its result is dropped", () => {
  // Mirrors the primary-path filter (Plan 2026-07-05 §2.4 Amendment F).
  // Without this, the dashboard shows a phantom "tool" entry next to the
  // InteractiveChoiceBox because `mergeToolCallResult` would synthesise a
  // name-less part on miss.
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "plain",
    chain_type: "tool_call",
    data: JSON.stringify({
      id: "call_ask_1",
      name: "ask_user_choice",
      args: { prompt: "Pick", options: [] },
      ts: 1.0,
    }),
    streaming: false,
    message_id: "orphan-ask",
  });
  processSystemPayload(state, "s1", records, {
    type: "plain",
    chain_type: "tool_call_result",
    data: JSON.stringify({
      id: "call_ask_1",
      result: "ok",
      ts: 1.5,
    }),
    streaming: false,
    message_id: "orphan-ask",
  });
  processSystemPayload(state, "s1", records, {
    type: "complete",
    streaming: false,
    message_id: "orphan-ask",
  });

  // Both filtered — no plain JSON, no synthesised tool_call part.
  assert.equal(records[0].content.message.length, 0);
});

test("plain text flushes before a non-plain part so the order matches the wire", () => {
  // Plain text arrives before a tool_call. The plain part should be
  // pushed first, then the tool_call part. This is what the rendering
  // code expects (text → tool card).
  const state = createSystemStreamState();
  const records = makeRecords();

  processSystemPayload(state, "s1", records, {
    type: "plain",
    data: "I'll write a poem",
    streaming: false,
    message_id: "orphan-order",
  });
  processSystemPayload(state, "s1", records, {
    type: "plain",
    chain_type: "tool_call",
    data: JSON.stringify({ id: "c1", name: "write", args: {}, ts: 1 }),
    streaming: false,
    message_id: "orphan-order",
  });

  const parts = records[0].content.message;
  assert.equal(parts.length, 2);
  const plain = parts[0] as { type: string; text?: string };
  assert.equal(plain.type, "plain");
  assert.equal(plain.text, "I'll write a poem");
  const toolPart = parts[1] as {
    type: string;
    tool_calls?: Array<Record<string, unknown>>;
  };
  assert.equal(toolPart.type, "tool_call");
  assert.equal(toolPart.tool_calls![0].id, "c1");
});
