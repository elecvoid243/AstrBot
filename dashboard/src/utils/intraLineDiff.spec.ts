// Tests for intraLineDiff.ts — word-level intra-line diff used by
// DiffPreview's changed-segment highlight (2026-08-14).
//
// Author: elecvoid243 | 2026-08-14

import { describe, it, expect } from "vitest";
import {
  computeIntraLineSegments,
  INTRA_LINE_MAX_MIDDLE_CHARS,
  type IntraLineSegment,
} from "./intraLineDiff";

function join(segs: IntraLineSegment[]): string {
  return segs.map((s) => s.text).join("");
}

function changedText(segs: IntraLineSegment[]): string {
  return segs
    .filter((s) => s.changed)
    .map((s) => s.text)
    .join("");
}

describe("computeIntraLineSegments", () => {
  it("marks identical lines as fully unchanged", () => {
    const { oldSegments, newSegments } = computeIntraLineSegments(
      "same line",
      "same line",
    );
    expect(oldSegments).toEqual([{ text: "same line", changed: false }]);
    expect(newSegments).toEqual([{ text: "same line", changed: false }]);
  });

  it("isolates a single changed char via prefix/suffix trim", () => {
    const { oldSegments, newSegments } = computeIntraLineSegments(
      "const a = 1;",
      "const a = 2;",
    );
    expect(changedText(oldSegments)).toBe("1");
    expect(changedText(newSegments)).toBe("2");
    expect(join(oldSegments)).toBe("const a = 1;");
    expect(join(newSegments)).toBe("const a = 2;");
  });

  it("isolates a changed word in the middle", () => {
    const { oldSegments, newSegments } = computeIntraLineSegments(
      "a foo b",
      "a bar b",
    );
    expect(changedText(oldSegments)).toBe("foo");
    expect(changedText(newSegments)).toBe("bar");
    // The shared " a "/" b " surroundings stay unchanged.
    expect(oldSegments[0]).toEqual({ text: "a ", changed: false });
    expect(oldSegments[oldSegments.length - 1]).toEqual({
      text: " b",
      changed: false,
    });
  });

  it("handles pure insertions (empty old middle)", () => {
    const { oldSegments, newSegments } = computeIntraLineSegments(
      "a c",
      "a b c",
    );
    expect(changedText(oldSegments)).toBe("");
    expect(changedText(newSegments)).toBe("b ");
    expect(join(oldSegments)).toBe("a c");
    expect(join(newSegments)).toBe("a b c");
  });

  it("handles a fully replaced line", () => {
    const { oldSegments, newSegments } = computeIntraLineSegments(
      "aaa",
      "zzz",
    );
    expect(oldSegments).toEqual([{ text: "aaa", changed: true }]);
    expect(newSegments).toEqual([{ text: "zzz", changed: true }]);
  });

  it("falls back to prefix/suffix trim for very long middles", () => {
    const longA = "x".repeat(INTRA_LINE_MAX_MIDDLE_CHARS + 10);
    const longB = "y".repeat(INTRA_LINE_MAX_MIDDLE_CHARS + 10);
    const { oldSegments, newSegments } = computeIntraLineSegments(
      `head ${longA} tail`,
      `head ${longB} tail`,
    );
    // Whole middle marked changed; affixes unchanged.
    expect(oldSegments[0]).toEqual({ text: "head ", changed: false });
    expect(changedText(oldSegments)).toBe(longA);
    expect(changedText(newSegments)).toBe(longB);
    expect(oldSegments[oldSegments.length - 1]).toEqual({
      text: " tail",
      changed: false,
    });
  });

  it("keeps segments reconstructing the original text", () => {
    const cases: Array<[string, string]> = [
      ["", "new content"],
      ["old content", ""],
      ["  indented = value;", "  indented = otherValue;"],
      ["if (a && b) {", "if (a || b) {"],
    ];
    for (const [a, b] of cases) {
      const { oldSegments, newSegments } = computeIntraLineSegments(a, b);
      expect(join(oldSegments)).toBe(a);
      expect(join(newSegments)).toBe(b);
    }
  });
});
