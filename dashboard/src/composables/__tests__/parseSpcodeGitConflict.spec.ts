// Author: elecvoid243 @ 2026-08-01
// Spec: docs/superpowers/specs/2026-08-01-git-merge-cherrypick-conflict-frontend-design.md §3.2
import { describe, it, expect } from "vitest";
import {
  parseSpcodeConflictStatus,
  parseSpcodeConflictResolve,
  parseSpcodeConflictContinue,
  parseSpcodeConflictAbort,
  buildResolveBody,
  classifyConflictReason,
} from "../parseSpcodeGitConflict";

function env(data: Record<string, unknown>) {
  return { status: "ok", data };
}

const STATUS_OK = {
  in_conflict: true,
  operation: "merge",
  operation_ref: "abc123",
  operation_subject: "feat: x",
  conflicted_files: [
    {
      path: "src/a.ts",
      status: "UU",
      hunks: [
        {
          index: 0,
          start_line: 3,
          end_line: 9,
          ours: "const x = 1;\n",
          theirs: "const x = 2;\n",
          base: "const x = 0;\n",
          ours_label: "HEAD",
          theirs_label: "feature/x",
        },
        {
          index: 1,
          start_line: 20,
          end_line: 24,
          ours: "a\n",
          theirs: "b\n",
          base: null,
          ours_label: "HEAD",
          theirs_label: "feature/x",
        },
      ],
      three_way: { base: "base-content", ours: "ours-content", theirs: null },
      binary: false,
      truncated: false,
    },
    {
      path: "logo.png",
      status: "AA",
      hunks: [],
      three_way: { base: null, ours: null, theirs: null },
      binary: true,
      truncated: false,
    },
  ],
  resolved_files: ["src/done.ts"],
  total_conflicted: 2,
  total_resolved: 1,
  all_resolved: false,
  directory: "D:/repo",
  umo: "umo",
  worktree: "D:/repo",
  reason: null,
  stderr: "",
  elapsed_ms: 15,
};

describe("parseSpcodeConflictStatus", () => {
  it("parses a full in-conflict snapshot", () => {
    const s = parseSpcodeConflictStatus(env(STATUS_OK));
    expect(s.inConflict).toBe(true);
    expect(s.operation).toBe("merge");
    expect(s.operationRef).toBe("abc123");
    expect(s.operationSubject).toBe("feat: x");
    expect(s.conflictedFiles).toHaveLength(2);
    const f = s.conflictedFiles[0];
    expect(f.path).toBe("src/a.ts");
    expect(f.hunks).toHaveLength(2);
    expect(f.hunks[0]).toMatchObject({
      index: 0,
      startLine: 3,
      endLine: 9,
      ours: "const x = 1;\n",
      theirs: "const x = 2;\n",
      base: "const x = 0;\n",
      oursLabel: "HEAD",
      theirsLabel: "feature/x",
    });
    expect(f.hunks[1].base).toBeNull();
    expect(f.threeWay).toEqual({
      base: "base-content",
      ours: "ours-content",
      theirs: null,
    });
    expect(s.conflictedFiles[1].binary).toBe(true);
    expect(s.resolvedFiles).toEqual(["src/done.ts"]);
    expect(s.totalConflicted).toBe(2);
    expect(s.totalResolved).toBe(1);
    expect(s.allResolved).toBe(false);
  });

  it("parses the no-conflict shape", () => {
    const s = parseSpcodeConflictStatus(
      env({
        in_conflict: false,
        operation: null,
        operation_ref: null,
        operation_subject: null,
        conflicted_files: [],
        resolved_files: [],
        total_conflicted: 0,
        total_resolved: 0,
        all_resolved: true,
        directory: "D:/repo",
        umo: "umo",
        worktree: "D:/repo",
        reason: null,
        stderr: "",
        elapsed_ms: 3,
      }),
    );
    expect(s).toMatchObject({
      inConflict: false,
      operation: null,
      operationRef: null,
      operationSubject: null,
      conflictedFiles: [],
      resolvedFiles: [],
      totalConflicted: 0,
      totalResolved: 0,
      allResolved: true,
    });
  });

  it("maps unknown operation strings to null", () => {
    const s = parseSpcodeConflictStatus(env({ ...STATUS_OK, operation: "rebase" }));
    expect(s.operation).toBeNull();
  });

  it("throws on malformed envelopes", () => {
    expect(() => parseSpcodeConflictStatus(undefined)).toThrow();
    expect(() => parseSpcodeConflictStatus({ status: "ok" })).toThrow();
  });
});

describe("parseSpcodeConflictResolve", () => {
  it("parses whole-file success", () => {
    const r = parseSpcodeConflictResolve(
      env({
        resolved: true,
        file: "src/a.ts",
        mode: "whole_file",
        hunks_resolved: null,
        hunks_total: null,
        partial: false,
        remaining_conflicts: [],
        all_resolved: true,
        reason: null,
        stderr: "",
        elapsed_ms: 8,
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      resolved: true,
      partial: false,
      hunksResolved: null,
      hunksTotal: null,
      remainingConflicts: [],
      allResolved: true,
    });
  });

  it("parses partial hunk resolution (success envelope, resolved=false)", () => {
    const r = parseSpcodeConflictResolve(
      env({
        resolved: false,
        file: "src/a.ts",
        mode: "hunks",
        hunks_resolved: 1,
        hunks_total: 2,
        partial: true,
        unresolved_hunks: [{ index: 1, start_line: 20, end_line: 24 }],
        remaining_conflicts: [{ path: "src/a.ts", status: "UU" }],
        all_resolved: false,
        reason: null,
        stderr: "",
        elapsed_ms: 8,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolved).toBe(false);
      expect(r.partial).toBe(true);
      expect(r.hunksResolved).toBe(1);
      expect(r.hunksTotal).toBe(2);
      expect(r.unresolvedHunks).toEqual([{ index: 1, startLine: 20, endLine: 24 }]);
      expect(r.allResolved).toBe(false);
    }
  });

  it("parses failures", () => {
    const r = parseSpcodeConflictResolve(
      env({
        resolved: false,
        reason: "file_not_conflicted",
        file: "x.ts",
        stderr: "",
        elapsed_ms: 2,
      }),
    );
    expect(r).toEqual({ ok: false, reason: "file_not_conflicted", stderr: undefined });
  });
});

describe("parseSpcodeConflictContinue / parseSpcodeConflictAbort", () => {
  it("parses continue success", () => {
    const r = parseSpcodeConflictContinue(
      env({
        continued: true,
        operation: "merge",
        commit_sha: "feed99",
        commit_message: "Merge branch 'f/x'",
        files_touched: ["a.ts"],
        reason: null,
        stderr: "",
        elapsed_ms: 40,
      }),
    );
    expect(r).toEqual({
      ok: true,
      operation: "merge",
      commitSha: "feed99",
      commitMessage: "Merge branch 'f/x'",
    });
  });

  it("parses continue blocked by unresolved conflicts", () => {
    const r = parseSpcodeConflictContinue(
      env({
        continued: false,
        operation: "merge",
        reason: "unresolved_conflicts_remain",
        remaining_conflicts: [{ path: "a.ts", status: "UU" }],
        stderr: "",
        elapsed_ms: 4,
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("unresolved_conflicts_remain");
      expect(r.remainingConflicts).toEqual([{ path: "a.ts", status: "UU" }]);
    }
  });

  it("parses abort success and no-conflict failure", () => {
    const ok = parseSpcodeConflictAbort(
      env({
        aborted: true,
        operation: "cherry_pick",
        operation_ref: "abc",
        reason: null,
        stderr: "",
        elapsed_ms: 6,
      }),
    );
    expect(ok).toEqual({
      ok: true,
      operation: "cherry_pick",
      commitSha: "",
      commitMessage: "",
    });
    const fail = parseSpcodeConflictAbort(
      env({
        aborted: false,
        reason: "no_conflict_in_progress",
        stderr: "",
        elapsed_ms: 2,
      }),
    );
    expect(fail.ok).toBe(false);
  });
});

describe("buildResolveBody", () => {
  it("serializes all four modes", () => {
    expect(
      buildResolveBody({ mode: "hunks", file: "a.ts", hunks: [{ index: 0, choice: "ours" }] }),
    ).toEqual({ file: "a.ts", hunks: [{ index: 0, choice: "ours" }] });
    expect(buildResolveBody({ mode: "whole", file: "a.ts", resolution: "theirs" })).toEqual({
      file: "a.ts",
      resolution: "theirs",
    });
    expect(buildResolveBody({ mode: "custom", file: "a.ts", content: "hello" })).toEqual({
      file: "a.ts",
      resolution: "custom",
      content: "hello",
    });
    expect(buildResolveBody({ mode: "all", resolution: "ours" })).toEqual({
      all: true,
      resolution: "ours",
    });
  });
});

describe("classifyConflictReason", () => {
  it("maps known reasons, falls back to unknown", () => {
    expect(classifyConflictReason("unresolved_conflicts_remain").i18nKey).toContain(
      "conflict.error.unresolved_conflicts_remain",
    );
    expect(classifyConflictReason("no_conflict_in_progress").color).toBe("warning");
    expect(classifyConflictReason("bogus").i18nKey).toContain("conflict.error.unknown");
    expect(classifyConflictReason(null).i18nKey).toContain("conflict.error.unknown");
  });
});
