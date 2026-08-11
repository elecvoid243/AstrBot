// Tests for the reasoning activity summary counters — in particular the
// 2026-08-11 file-change count appended to the collapsed reasoning bar
// title ("Thought N times, used M tools, changed K files").
//
// Author: elecvoid243 | 2026-08-11

import { describe, it, expect } from "vitest";
import {
  reasoningActivityCounts,
  reasoningActivityTitle,
} from "@/composables/useMessages";

/** Minimal tm stub: returns the key with the count interpolated. */
function tmStub(
  key: string,
  params?: Record<string, string | number>,
): string {
  return params ? `${key}(${params.count})` : key;
}

const FILE_EDIT = {
  id: "e1",
  name: "astrbot_file_edit_tool",
  args: { path: "a.py" },
  result: "Edited a.py. Replaced 1 occurrence(s).",
  finished_ts: 2,
};
const FILE_WRITE = {
  id: "w1",
  name: "astrbot_file_write_tool",
  args: { path: "b.txt", content: "x" },
  result: "File written successfully: b.txt",
  finished_ts: 2,
};
const FILE_REMOVE = {
  id: "r1",
  name: "astrbot_file_remove_tool",
  args: { path: "c.txt" },
  result: "File removed: c.txt",
  finished_ts: 2,
};
const SHELL = {
  id: "s1",
  name: "astrbot_execute_shell",
  args: { command: "dir" },
  result: "{}",
  finished_ts: 3,
};

describe("reasoningActivityCounts", () => {
  it("counts file-change tool calls separately from other tools", () => {
    const counts = reasoningActivityCounts([
      { type: "think", think: "hmm" },
      {
        type: "tool_call",
        tool_calls: [FILE_EDIT, FILE_WRITE, SHELL, FILE_REMOVE],
      },
    ]);
    expect(counts).toEqual({ thinkCount: 1, toolCount: 4, fileChangeCount: 3 });
  });

  it("returns zero file changes when none are present", () => {
    const counts = reasoningActivityCounts([
      { type: "tool_call", tool_calls: [SHELL] },
    ]);
    expect(counts.fileChangeCount).toBe(0);
  });
});

describe("reasoningActivityTitle", () => {
  it("appends the file-change segment when files were changed", () => {
    const title = reasoningActivityTitle(
      { thinkCount: 1, toolCount: 2, fileChangeCount: 2 },
      tmStub,
    );
    expect(title).toContain("reasoning.thinkSummary(1)");
    expect(title).toContain("reasoning.toolSummary(2)");
    expect(title).toContain("reasoning.fileChangeSummary(2)");
  });

  it("omits the file-change segment when nothing changed", () => {
    const title = reasoningActivityTitle(
      { thinkCount: 1, toolCount: 0, fileChangeCount: 0 },
      tmStub,
    );
    expect(title).not.toContain("fileChangeSummary");
  });
});
