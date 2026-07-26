import { describe, expect, it } from "vitest";
import {
  findSystemNoticeIndex,
  splitSystemNotice,
} from "@/utils/systemNotice";

const REPEATED_L1 =
  "[SYSTEM NOTICE] By the way, you have executed the same tool " +
  "`astrbot_execute_shell` with the same arguments 3 times consecutively. " +
  "Double-check whether another tool, different arguments, or a summary would " +
  "move the task forward better.";

const REPEATED_L2 =
  "[SYSTEM NOTICE] Important: you have executed the same tool " +
  "`astrbot_execute_shell` with the same arguments 5 times consecutively. " +
  "Unless this repetition is clearly necessary, stop repeating the same action.";

const FOLLOW_UP =
  "[SYSTEM NOTICE] User sent follow-up messages while tool execution " +
  "was in progress. Prioritize these follow-up instructions in your next " +
  "actions. In your very next action, briefly acknowledge to the user " +
  "that their follow-up message(s) were received before continuing.";

const OVERFLOW =
  "Truncated tool output preview shown above. " +
  "The tool output was too large to include directly and was written to " +
  "`F:\\tmp\\overflow.txt`. Use astrbot_file_read_tool to inspect it. " +
  "Use a narrower window when reading large files.";

describe("findSystemNoticeIndex", () => {
  it("returns -1 when there is no notice", () => {
    expect(findSystemNoticeIndex("plain tool output\nwith lines")).toBe(-1);
  });

  it("detects a genuine repeated-tool notice suffix", () => {
    const text = `file content here\n\n${REPEATED_L1}`;
    expect(findSystemNoticeIndex(text)).toBe(text.indexOf(REPEATED_L1));
  });

  it("detects a chained repeated + follow-up notice from the earliest one", () => {
    const chain = `${REPEATED_L1}\n\n${FOLLOW_UP}\n1. first message\n2. second message`;
    const text = `some output\n\n${chain}`;
    expect(findSystemNoticeIndex(text)).toBe(text.indexOf(REPEATED_L1));
    const { content, notice } = splitSystemNotice(text);
    expect(content).toBe("some output");
    expect(notice).toBe(chain);
  });

  it("detects the overflow notice suffix", () => {
    const text = `preview content\n\n${OVERFLOW}`;
    expect(findSystemNoticeIndex(text)).toBe(text.indexOf(OVERFLOW));
  });

  it("allows free-form body lines inside a follow-up notice", () => {
    const chain = `${FOLLOW_UP}\n1. do this\nwith a continuation line\n\nand more after a blank`;
    const text = `output\n\n${chain}`;
    expect(findSystemNoticeIndex(text)).toBe(text.indexOf(FOLLOW_UP));
  });

  it("accepts a notice-like line at the very end of the text", () => {
    const text = `log line one\nlog line two\n${REPEATED_L2}`;
    expect(findSystemNoticeIndex(text)).toBe(text.indexOf(REPEATED_L2));
  });

  // ── false-positive regressions ──────────────────────────────────────

  it("ignores a quoted notice followed by more content without blank lines", () => {
    // A log file quoting a notice-like line: everything after the marker is
    // real content, so nothing may be treated as a notice suffix.
    const text =
      "2026-07-26 INFO start\n" +
      `${REPEATED_L2}\n` +
      "2026-07-26 INFO more log lines follow\n" +
      "2026-07-26 INFO even more";
    expect(findSystemNoticeIndex(text)).toBe(-1);
  });

  it("ignores a quoted notice followed by a blank line and more content", () => {
    const text = `header\n${REPEATED_L2}\n\nparagraph two of the file\nstill file content`;
    expect(findSystemNoticeIndex(text)).toBe(-1);
  });

  it("ignores numbered lists that are not preceded by a follow-up notice", () => {
    const text = `shopping list\n1. apples\n2. oranges`;
    expect(findSystemNoticeIndex(text)).toBe(-1);
  });

  it("ignores overflow-like text embedded in real content", () => {
    const text = `${OVERFLOW}\n\nbut this is actually the file being read\nwith more lines`;
    expect(findSystemNoticeIndex(text)).toBe(-1);
  });
});
