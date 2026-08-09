// Author: elecvoid243
// Date: 2026-08-09
// Spec: docs/superpowers/specs/2026-08-09-changelog-generate-design.md §5.3
//
// Verifies the changelog prompt builder (three-part assembly), version
// normalization, latest-changelog picker and reply cleaner.
// Imports the .ts source directly; Node v24 strips types at import time.

import assert from "node:assert/strict";
import test from "node:test";

import {
  CHANGELOG_DIR,
  DEFAULT_CHANGELOG_INSTRUCTION,
  DIFF_PER_COMMIT_CHAR_BUDGET,
  REFERENCE_CHAR_BUDGET,
  buildChangelogPrompt,
  changelogFilename,
  cleanChangelogReply,
  isSemver,
  normalizeVersion,
  pickLatestChangelog,
} from "../src/composables/changelogPrompt.ts";

const commits = [
  {
    sha: "aaa1111aaa1111",
    subject: "feat: 新增扫码登录",
    body: null,
    patch: "diff --git a/login.py b/login.py\n+qr",
    patchTruncated: false,
    patchFailed: false,
  },
  {
    sha: "bbb2222bbb2222",
    subject: "fix: 修复超时",
    body: "详细说明",
    patch: "diff --git a/net.py b/net.py\n+timeout",
    patchTruncated: false,
    patchFailed: false,
  },
];

test("normalizeVersion: pure numeric gets v prefix", () => {
  assert.equal(normalizeVersion("4.25.0"), "v4.25.0");
  assert.equal(normalizeVersion("  v4.25.0  "), "v4.25.0");
  assert.equal(normalizeVersion("release-x"), "release-x");
});

test("isSemver: accepts X.Y.Z with optional v", () => {
  assert.equal(isSemver("4.25.0"), true);
  assert.equal(isSemver("v4.25.0"), true);
  assert.equal(isSemver("release-x"), false);
  assert.equal(isSemver("4.25"), false);
});

test("changelogFilename", () => {
  assert.equal(changelogFilename("4.25.0"), "v4.25.0.md");
  assert.equal(changelogFilename("v4.25.0"), "v4.25.0.md");
});

test("pickLatestChangelog: semver desc, unparseable last", () => {
  const entries = [
    { name: "notes.md", type: "file" },
    { name: "v4.9.0.md", type: "file" },
    { name: "v4.25.0.md", type: "file" },
    { name: "v4.10.0.md", type: "file" },
    { name: "subdir", type: "directory" },
  ];
  assert.equal(pickLatestChangelog(entries), "v4.25.0.md");
  assert.equal(
    pickLatestChangelog([{ name: "notes.md", type: "file" }]),
    "notes.md",
  );
  assert.equal(pickLatestChangelog([]), null);
});

test("buildChangelogPrompt: three-part assembly order", () => {
  const p = buildChangelogPrompt({
    instruction: "CUSTOM_INSTRUCTION",
    commits,
    reference: { filename: "v4.24.0.md", content: "# v4.24.0\n..." },
  });
  const i1 = p.indexOf("CUSTOM_INSTRUCTION");
  const i2 = p.indexOf("aaa1111");
  const i3 = p.indexOf("v4.24.0.md");
  assert.ok(i1 !== -1 && i2 !== -1 && i3 !== -1);
  assert.ok(i1 < i2 && i2 < i3);
  // body 也进 prompt
  assert.ok(p.includes("详细说明"));
  // 短 sha 标注
  assert.ok(p.includes("aaa1111"));
});

test("buildChangelogPrompt: reference omitted when null", () => {
  const p = buildChangelogPrompt({
    instruction: "X",
    commits,
    reference: null,
  });
  assert.ok(!p.includes("最近一次更新日志"));
});

test("buildChangelogPrompt: failed patch degrades to message-only", () => {
  const p = buildChangelogPrompt({
    instruction: "X",
    commits: [{ ...commits[0], patch: null, patchFailed: true }],
    reference: null,
  });
  assert.ok(p.includes("diff 获取失败"));
});

test("buildChangelogPrompt: per-commit diff cap", () => {
  const big = "x".repeat(DIFF_PER_COMMIT_CHAR_BUDGET + 5000);
  const p = buildChangelogPrompt({
    instruction: "X",
    commits: [{ ...commits[0], patch: big }],
    reference: null,
  });
  assert.ok(p.includes("diff 过大，已省略"));
  assert.ok(p.length < big.length + 4000);
});

test("buildChangelogPrompt: reference cap", () => {
  const bigRef = "y".repeat(REFERENCE_CHAR_BUDGET + 5000);
  const p = buildChangelogPrompt({
    instruction: "X",
    commits,
    reference: { filename: "v1.md", content: bigRef },
  });
  assert.ok(!p.includes(bigRef));
});

test("cleanChangelogReply: strips fences and think blocks", () => {
  assert.equal(
    cleanChangelogReply("```markdown\n# v1\n\n- 条目\n```"),
    "# v1\n\n- 条目",
  );
  assert.equal(cleanChangelogReply("<think>hmm</think># v1"), "# v1");
  assert.equal(cleanChangelogReply("  # v1  "), "# v1");
});

test("CHANGELOG_DIR constant", () => {
  assert.equal(CHANGELOG_DIR, "changelogs");
});

test("default instruction mentions the three fixed categories", () => {
  assert.ok(DEFAULT_CHANGELOG_INSTRUCTION.includes("## 新功能"));
  assert.ok(DEFAULT_CHANGELOG_INSTRUCTION.includes("## 优化"));
  assert.ok(DEFAULT_CHANGELOG_INSTRUCTION.includes("## 修复"));
});
