// Author: elecvoid243
// Date: 2026-08-28
//
// Regression tests for todo summary bar refresh persistence.
//
// The todo summary bar used to disappear on a hard refresh because
// `latestTodoSnapshotBySession` was populated only from live
// tool_call_result events; nothing replayed the todo results that are
// persisted in the session history. The fix folds the persisted records
// through `replayTodoSnapshotFromHistory` (leaf module, node-testable)
// inside `loadSessionMessages`.
//
// These tests pin the fold's contract: last successful call wins,
// todo_clear clears, failed calls keep the previous value, and
// non-todo / malformed parts are ignored.
//
// Run: cd dashboard && pnpm exec node --test src/composables/useMessages.todoHistoryReplay.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TODO_TOOL_NAMES,
  replayTodoSnapshotFromHistory,
} from "./todoHistoryReplay.ts";

/** Minimal realistic parser mirroring useMessages.parseTodoToolResult. */
function stubParse(toolName: string, resultJson: string) {
  if (toolName === "todo_clear") return null;
  let parsed: any;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    return undefined;
  }
  if (parsed?.ok === false) return undefined;
  const data = parsed?.ok === true ? parsed.data : parsed;
  if (!data?.list || !data?.stats) return undefined;
  return { tool: toolName, list: data.list, stats: data.stats };
}

function toolCallPart(calls: unknown[]) {
  return { content: { message: [{ type: "tool_call", tool_calls: calls }] } };
}

function todoResult(name: string, title: string) {
  return {
    name,
    result: JSON.stringify({
      ok: true,
      data: { list: { title }, stats: { done: 0, total: 1 } },
    }),
  };
}

test("TODO_TOOL_NAMES covers the spcode todo tools incl. legacy names", () => {
  for (const name of [
    "todo_create",
    "todo_query",
    "todo_add",
    "todo_update",
    "todo_delete",
    "todo_clear",
    "todo_modify",
    "todo_list",
  ]) {
    assert.ok(TODO_TOOL_NAMES.has(name), `missing ${name}`);
  }
  assert.ok(!TODO_TOOL_NAMES.has("astrbot_file_edit_tool"));
});

test("returns undefined when history has no todo tool results", () => {
  const records = [
    toolCallPart([{ id: "1", name: "astrbot_grep_tool", result: "{}" }]),
    { content: { message: [{ type: "plain", text: "hi" }] } },
    { content: { message: [] } },
  ];
  assert.equal(
    replayTodoSnapshotFromHistory(records, stubParse),
    undefined,
  );
});

test("tolerates malformed records and parts", () => {
  const records = [
    null,
    {},
    { content: {} },
    { content: { message: "not-an-array" } },
    { content: { message: [null, 42, { type: "tool_call" }] } },
    toolCallPart([null, "str", { name: "todo_query" }, { name: "todo_query", result: 7 }]),
  ];
  assert.equal(replayTodoSnapshotFromHistory(records, stubParse), undefined);
});

test("last successful todo call wins", () => {
  const records = [
    toolCallPart([todoResult("todo_create", "first")]),
    { content: { message: [{ type: "plain", text: "working..." }] } },
    toolCallPart([todoResult("todo_update", "second")]),
  ];
  const out = replayTodoSnapshotFromHistory(records, stubParse);
  assert.equal(out?.tool, "todo_update");
  assert.equal(out?.list.title, "second");
});

test("todo_clear as the last call clears the snapshot (null)", () => {
  const records = [
    toolCallPart([todoResult("todo_create", "list")]),
    toolCallPart([{ name: "todo_clear", result: '{"ok": true}' }]),
  ];
  assert.equal(replayTodoSnapshotFromHistory(records, stubParse), null);
});

test("a failed call keeps the previous snapshot", () => {
  const records = [
    toolCallPart([todoResult("todo_create", "good")]),
    toolCallPart([
      { name: "todo_update", result: '{"ok": false, "error": "boom"}' },
    ]),
    toolCallPart([{ name: "todo_update", result: "not-json" }]),
  ];
  const out = replayTodoSnapshotFromHistory(records, stubParse);
  assert.equal(out?.tool, "todo_create");
  assert.equal(out?.list.title, "good");
});

test("interleaved non-todo tools do not disturb the fold", () => {
  const records = [
    toolCallPart([
      todoResult("todo_query", "before"),
      { id: "x", name: "astrbot_file_edit_tool", result: '{"ok": true}' },
    ]),
    toolCallPart([
      { id: "y", name: "astrbot_execute_shell", result: '{"ok": true}' },
      todoResult("todo_add", "after"),
    ]),
  ];
  const out = replayTodoSnapshotFromHistory(records, stubParse);
  assert.equal(out?.tool, "todo_add");
  assert.equal(out?.list.title, "after");
});
