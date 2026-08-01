// Author: elecvoid243 @ 2026-08-01
// Spec: docs/superpowers/specs/2026-08-01-git-merge-cherrypick-conflict-frontend-design.md §3.1
import { describe, it, expect } from "vitest";
import {
  parseSpcodeGitMerge,
  parseSpcodeCherryPick,
  buildMergeBody,
  buildCherryPickBody,
  classifyMergeReason,
  classifyCherryPickReason,
} from "../parseSpcodeGitMerge";

function env(data: Record<string, unknown>) {
  return { status: "ok", data };
}

describe("parseSpcodeGitMerge", () => {
  it("parses a fast-forward merge success", () => {
    const r = parseSpcodeGitMerge(
      env({
        merged: true,
        source: "feature/x",
        merge_sha: "abc123",
        merge_message: "Merge branch 'feature/x'",
        fast_forward: true,
        squash: false,
        files_touched: ["a.ts", "b.ts"],
        reason: null,
        stderr: "",
        elapsed_ms: 12,
      }),
    );
    expect(r).toEqual({
      ok: true,
      merged: true,
      mergeSha: "abc123",
      mergeMessage: "Merge branch 'feature/x'",
      fastForward: true,
      squash: false,
      filesTouched: ["a.ts", "b.ts"],
    });
  });

  it("parses a squash success (merged=false, staged only)", () => {
    const r = parseSpcodeGitMerge(
      env({
        merged: false,
        source: "feature/x",
        squash: true,
        files_touched: ["a.ts"],
        reason: null,
        stderr: "",
        elapsed_ms: 9,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.merged).toBe(false);
      expect(r.squash).toBe(true);
      expect(r.mergeSha).toBe("");
    }
  });

  it("parses merge_conflict with conflicted files", () => {
    const r = parseSpcodeGitMerge(
      env({
        merged: false,
        source: "feature/x",
        reason: "merge_conflict",
        conflict: true,
        operation: "merge",
        conflicted_files: ["src/a.ts"],
        stderr: "CONFLICT (content)",
        elapsed_ms: 30,
      }),
    );
    expect(r).toEqual({
      ok: false,
      reason: "merge_conflict",
      conflict: true,
      conflictedFiles: ["src/a.ts"],
      stderr: "CONFLICT (content)",
    });
  });

  it("parses already-up-to-date and dirty rejections", () => {
    const upToDate = parseSpcodeGitMerge(
      env({
        merged: false,
        source: "main",
        reason: "merge_already_up_to_date",
        stderr: "",
        elapsed_ms: 5,
      }),
    );
    expect(upToDate.ok).toBe(false);
    if (!upToDate.ok) expect(upToDate.conflict).toBe(false);

    const dirty = parseSpcodeGitMerge(
      env({
        merged: false,
        source: "main",
        reason: "worktree_dirty",
        stderr: "",
        elapsed_ms: 5,
      }),
    );
    expect(dirty.ok).toBe(false);
    if (!dirty.ok) expect(dirty.reason).toBe("worktree_dirty");
  });

  it("throws on malformed envelopes", () => {
    expect(() => parseSpcodeGitMerge(null)).toThrow();
    expect(() => parseSpcodeGitMerge({ status: "error" })).toThrow();
  });
});

describe("parseSpcodeCherryPick", () => {
  it("parses a cherry-pick success", () => {
    const r = parseSpcodeCherryPick(
      env({
        picked: true,
        ref: "deadbeef",
        new_sha: "cafe01",
        original_message: "fix: thing",
        files_touched: ["x.ts"],
        reason: null,
        stderr: "",
        elapsed_ms: 20,
      }),
    );
    expect(r).toEqual({
      ok: true,
      newSha: "cafe01",
      originalMessage: "fix: thing",
      filesTouched: ["x.ts"],
    });
  });

  it("parses cherry_pick_conflict / cherry_pick_empty / commit_not_found", () => {
    const conflict = parseSpcodeCherryPick(
      env({
        picked: false,
        ref: "a",
        reason: "cherry_pick_conflict",
        conflict: true,
        conflicted_files: ["f.ts"],
        stderr: "",
        elapsed_ms: 1,
      }),
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.reason).toBe("cherry_pick_conflict");
      expect(conflict.conflict).toBe(true);
      expect(conflict.conflictedFiles).toEqual(["f.ts"]);
    }
    const empty = parseSpcodeCherryPick(
      env({
        picked: false,
        ref: "a",
        reason: "cherry_pick_empty",
        stderr: "",
        elapsed_ms: 1,
      }),
    );
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toBe("cherry_pick_empty");
    const notFound = parseSpcodeCherryPick(
      env({
        picked: false,
        ref: "zzz",
        reason: "commit_not_found",
        stderr: "",
        elapsed_ms: 1,
      }),
    );
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) expect(notFound.reason).toBe("commit_not_found");
  });
});

describe("body builders", () => {
  it("buildMergeBody maps camelCase flags to snake_case", () => {
    expect(buildMergeBody({ source: "f/x", noFf: true, message: "msg" })).toEqual({
      source: "f/x",
      no_ff: true,
      ff_only: false,
      squash: false,
      message: "msg",
    });
    expect(buildMergeBody({ source: "f/x" })).toEqual({
      source: "f/x",
      no_ff: false,
      ff_only: false,
      squash: false,
    });
  });

  it("buildCherryPickBody omits mainline unless it is a number", () => {
    expect(buildCherryPickBody({ ref: "abc" })).toEqual({ ref: "abc" });
    expect(buildCherryPickBody({ ref: "abc", mainline: 1 })).toEqual({
      ref: "abc",
      mainline: 1,
    });
  });
});

describe("reason classification", () => {
  it("maps known merge reasons, falls back to unknown", () => {
    expect(classifyMergeReason("merge_conflict").color).toBe("warning");
    expect(classifyMergeReason("merge_already_up_to_date").color).toBe("info");
    expect(classifyMergeReason("worktree_dirty").i18nKey).toContain(
      "merge.error.worktree_dirty",
    );
    expect(classifyMergeReason("bogus").i18nKey).toContain("merge.error.unknown");
    expect(classifyMergeReason(null).i18nKey).toContain("merge.error.unknown");
  });

  it("maps known cherry-pick reasons", () => {
    expect(classifyCherryPickReason("cherry_pick_conflict").color).toBe("warning");
    expect(classifyCherryPickReason("cherry_pick_empty").color).toBe("info");
    expect(classifyCherryPickReason("commit_not_found").i18nKey).toContain(
      "cherryPick.error.commit_not_found",
    );
    expect(classifyCherryPickReason(undefined).i18nKey).toContain(
      "cherryPick.error.unknown",
    );
  });
});
