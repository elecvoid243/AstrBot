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
  assert.equal(record.content.isLoading, true);
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

  assert.deepEqual(records[0].content.message, [
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
