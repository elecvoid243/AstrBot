// Author: elecvoid243
// Date: 2026-07-28
// Spec: docs/superpowers/specs/2026-07-28-git-diff-recursive-directory-tree-design.md §6.3
// Test runner: node --test (Node v24 strips TS from .ts imports automatically).
// Run: cd dashboard && pnpm exec node --test --import tsx tests/parseSpcodeGitStatus.test.mjs
//
// Covers the git-status envelope parser. Mirrors
// tests/parseSpcodeGitDiff.test.mjs style — import directly from
// the .ts source; Node v24 strips types at import time.

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSpcodeGitStatus,
  normalizeStatusScope,
  isNewFileScope,
} from "../src/composables/parseSpcodeGitStatus.ts";

// 1. scope normalization: valid scopes pass through
test("normalizeStatusScope: valid scopes", () => {
  assert.equal(normalizeStatusScope("modified_both"), "modified_both");
  assert.equal(normalizeStatusScope("untracked"), "untracked");
  assert.equal(normalizeStatusScope("intent_to_add"), "intent_to_add");
  assert.equal(normalizeStatusScope("staged"), "staged");
  assert.equal(normalizeStatusScope("unstaged"), "unstaged");
  assert.equal(normalizeStatusScope("conflict"), "conflict");
});

// 2. scope normalization: invalid → null
test("normalizeStatusScope: invalid → null", () => {
  assert.equal(normalizeStatusScope("bogus"), null);
  assert.equal(normalizeStatusScope(""), null);
  assert.equal(normalizeStatusScope(null), null);
  assert.equal(normalizeStatusScope(42), null);
});

// 3. isNewFileScope: untracked / intent_to_add
test("isNewFileScope: only new-file scopes", () => {
  assert.equal(isNewFileScope("untracked"), true);
  assert.equal(isNewFileScope("intent_to_add"), true);
  assert.equal(isNewFileScope("staged"), false);
  assert.equal(isNewFileScope("unstaged"), false);
  assert.equal(isNewFileScope("modified_both"), false);
  assert.equal(isNewFileScope("conflict"), false);
  assert.equal(isNewFileScope(null), false);
  assert.equal(isNewFileScope(undefined), false);
});

// 4. parseSpcodeGitStatus: recursive untracked paths
test("parseSpcodeGitStatus: recursive untracked paths", () => {
  const data = {
    loaded: true,
    directory: "C:/repo",
    umo: "webchat-1",
    worktree: "C:/repo",
    branch: "main",
    upstream: null,
    files: [
      { path: "new_dir/root.txt", x_status: "?", y_status: "?", scope: "untracked" },
      { path: "new_dir/nested/leaf.txt", x_status: "?", y_status: "?", scope: "untracked" },
    ],
    summary: { staged: 0, unstaged: 0, untracked: 2, conflicts: 0, total: 2 },
    truncated: false,
    max_files: 1000,
    reason: null,
    elapsed_ms: 5,
  };
  const snap = parseSpcodeGitStatus(data);
  assert.equal(snap.files.length, 2);
  assert.equal(snap.files[0].path, "new_dir/root.txt");
  assert.equal(snap.files[0].scope, "untracked");
  assert.equal(snap.files[1].path, "new_dir/nested/leaf.txt");
  assert.equal(snap.files[1].scope, "untracked");
  assert.equal(snap.summary.untracked, 2);
  assert.equal(snap.summary.total, 2);
  assert.equal(snap.truncated, false);
});

// 5. parseSpcodeGitStatus: truncated flag
test("parseSpcodeGitStatus: truncated preserved", () => {
  const data = {
    loaded: true,
    directory: "C:/repo",
    umo: "webchat-1",
    worktree: "C:/repo",
    files: Array.from({ length: 1000 }, (_, i) => ({
      path: `f${i}.txt`,
      x_status: "?",
      y_status: "?",
      scope: "untracked",
    })),
    summary: { staged: 0, unstaged: 0, untracked: 1000, conflicts: 0, total: 1000 },
    truncated: true,
    max_files: 1000,
    reason: null,
  };
  const snap = parseSpcodeGitStatus(data);
  assert.equal(snap.truncated, true);
  assert.equal(snap.maxFiles, 1000);
});

// 6. parseSpcodeGitStatus: upstream parsing
test("parseSpcodeGitStatus: upstream parsed", () => {
  const data = {
    loaded: true,
    directory: "C:/repo",
    umo: "webchat-1",
    worktree: "C:/repo",
    branch: "main",
    upstream: { branch: "origin/main", ahead: 1, behind: 0 },
    files: [],
    summary: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0, total: 0 },
    truncated: false,
    max_files: 1000,
    reason: null,
  };
  const snap = parseSpcodeGitStatus(data);
  assert.ok(snap.meta.upstream);
  assert.equal(snap.meta.upstream.branch, "origin/main");
  assert.equal(snap.meta.upstream.ahead, 1);
  assert.equal(snap.meta.upstream.behind, 0);
});

// 7. parseSpcodeGitStatus: failure reason
test("parseSpcodeGitStatus: failure reason preserved", () => {
  const data = {
    loaded: false,
    directory: null,
    umo: null,
    worktree: null,
    files: [],
    summary: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0, total: 0 },
    truncated: false,
    max_files: 1000,
    reason: "no_project_loaded",
  };
  const snap = parseSpcodeGitStatus(data);
  assert.equal(snap.meta.loaded, false);
  assert.equal(snap.meta.reason, "no_project_loaded");
});

// 8. parseSpcodeGitStatus: x_status / y_status passthrough
test("parseSpcodeGitStatus: x_status/y_status passthrough", () => {
  const data = {
    loaded: true,
    directory: "C:/repo",
    umo: "webchat-1",
    worktree: "C:/repo",
    files: [
      { path: "u.txt", x_status: "?", y_status: "?", scope: "untracked" },
      { path: "m.txt", x_status: "M", y_status: " ", scope: "staged" },
    ],
    summary: { staged: 1, unstaged: 0, untracked: 1, conflicts: 0, total: 2 },
    truncated: false,
    max_files: 1000,
    reason: null,
  };
  const snap = parseSpcodeGitStatus(data);
  assert.equal(snap.files[0].x_status, "?");
  assert.equal(snap.files[0].y_status, "?");
  assert.equal(snap.files[1].x_status, "M");
  assert.equal(snap.files[1].y_status, " ");
});
