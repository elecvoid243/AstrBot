// Author: elecvoid243
// Date: 2026-08-13
// Spec: docs/superpowers/specs/2026-08-13-diff-comments-old-side-design.md §3/§6
//
// Verifies the old-side ("del line") comment model: side-aware storage
// in addCommentWithContext and side-aware ">" anchoring in the
// LLM-facing hunk rendering (formatForLLM → renderHunkGroup).

import { describe, it, expect, beforeEach } from "vitest";
import { useFileComments, type DiffHunkContext } from "../useFileComments";

const HUNK: DiffHunkContext = {
  header: "@@ -10,3 +10,3 @@",
  lines: [
    { type: "ctx", content: "ctx_line()", newNo: 10, oldNo: 10 },
    { type: "del", content: "old_line()", newNo: null, oldNo: 11 },
    { type: "add", content: "new_line()", newNo: 11, oldNo: null },
  ],
  newLine: 11,
  side: "new",
  oldLine: null,
};

describe("useFileComments old-side comments (spec 2026-08-13)", () => {
  let store: ReturnType<typeof useFileComments>;

  beforeEach(() => {
    store = useFileComments();
    store.clearAll();
  });

  it("addCommentWithContext stores the side field when provided", () => {
    const c = store.addCommentWithContext({
      filePath: "/p/a.py",
      line: 11,
      text: "删掉这个",
      context: {
        lineContent: "old_line()",
        contextBefore: null,
        contextAfter: null,
      },
      diffHunk: { ...HUNK, side: "old", newLine: null, oldLine: 11 },
      side: "old",
    });
    expect(c).not.toBeNull();
    expect(c!.side).toBe("old");
  });

  it("omits the side field (defaults to new) when not provided", () => {
    const c = store.addCommentWithContext({
      filePath: "/p/a.py",
      line: 11,
      text: "新行评论",
      context: {
        lineContent: "new_line()",
        contextBefore: null,
        contextAfter: null,
      },
      diffHunk: HUNK,
    });
    expect(c!.side).toBeUndefined();
  });

  it("formatForLLM marks the del line with '>' for an old-side comment", () => {
    store.addCommentWithContext({
      filePath: "/p/a.py",
      line: 11,
      text: "删掉这个",
      context: {
        lineContent: "old_line()",
        contextBefore: null,
        contextAfter: null,
      },
      diffHunk: { ...HUNK, side: "old", newLine: null, oldLine: 11 },
      side: "old",
    });
    const out = store.formatForLLM();
    // The del line carries the ">" marker (old-side anchor).
    expect(out.match(/>\s+11 │ -old_line\(\)/)).not.toBeNull();
    // The add line (same display number, new side) must NOT be marked.
    expect(out.match(/>\s+11 │ \+new_line\(\)/)).toBeNull();
    expect(out).toContain("  - line 11 (old): 删掉这个");
  });

  it("formatForLLM keeps marking the add line for a new-side comment (regression)", () => {
    store.addCommentWithContext({
      filePath: "/p/a.py",
      line: 11,
      text: "这里逻辑有问题",
      context: {
        lineContent: "new_line()",
        contextBefore: null,
        contextAfter: null,
      },
      diffHunk: HUNK,
    });
    const out = store.formatForLLM();
    expect(out.match(/>\s+11 │ \+new_line\(\)/)).not.toBeNull();
    expect(out.match(/>\s+11 │ -old_line\(\)/)).toBeNull();
    expect(out).toContain("  - line 11: 这里逻辑有问题");
  });
});
