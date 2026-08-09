// Author: elecvoid243
// Date: 2026-08-09
// Spec: docs/superpowers/specs/2026-08-09-changelog-generate-design.md §5.3
//
// Pure builder for the three-part changelog-generation prompt sent to
// POST /spcode/btw, plus version/filename helpers, the latest-changelog
// picker and the reply cleaner. No Vue / no axios — importable by
// node --test (see tests/changelogPrompt.test.mjs).

/** Directory (relative to project root) that stores changelog files. */
export const CHANGELOG_DIR = "changelogs";

/** Per-commit diff char budget inside the prompt. */
export const DIFF_PER_COMMIT_CHAR_BUDGET = 32_000;
/** Whole-prompt char budget; oversized diffs shrink further. */
export const TOTAL_PROMPT_CHAR_BUDGET = 128_000;
/** Reference changelog char budget. */
export const REFERENCE_CHAR_BUDGET = 16_000;

/**
 * Default Part-1 instruction template (Chinese). Shown pre-filled in
 * the dialog's editable textarea; users may customize and their edit
 * persists to localStorage. The fixed three-category output contract
 * lives here — editing the template changes the contract.
 */
export const DEFAULT_CHANGELOG_INSTRUCTION = `请根据下面给出的 git 提交记录（包含提交信息与代码 diff），为该项目生成一份中文更新日志（changelog）。

输出要求：
1. 只输出 markdown 正文，不要用代码块包裹，不要输出任何解释性文字；
2. 正文固定使用以下三个分类小节，空分类直接省略：
   ## 新功能
   ## 优化
   ## 修复
3. 每个条目一句话，面向用户视角描述改动（不要写内部重构细节）；
4. 内容相近的多个提交合并为一个条目；
5. 每个条目末尾附上来源提交的短 sha，格式如 (a1b2c3d)；
6. 如果给出了"最近一次更新日志"，请模仿其格式与措辞风格。`;

export interface ChangelogPromptCommit {
  sha: string;
  subject: string;
  body: string | null;
  /** Full-commit unified diff; null when the fetch failed. */
  patch: string | null;
  patchTruncated: boolean;
  /** True when the git-show full-patch fetch failed (degrade to message-only). */
  patchFailed: boolean;
}

export interface ChangelogPromptReference {
  filename: string;
  content: string;
}

/**
 * Normalize a user-typed version string: trim, and prepend "v" when
 * the input is a bare numeric X.Y.Z.
 */
export function normalizeVersion(raw: string): string {
  const v = raw.trim();
  if (/^\d+\.\d+\.\d+$/.test(v)) return `v${v}`;
  return v;
}

/** Loose semver check (X.Y.Z with optional v prefix). */
export function isSemver(version: string): boolean {
  return /^v?\d+\.\d+\.\d+$/.test(version.trim());
}

/** changelog file name for a version, e.g. "4.25.0" → "v4.25.0.md". */
export function changelogFilename(version: string): string {
  return `${normalizeVersion(version)}.md`;
}

function semverKey(name: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)\.md$/.exec(name);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Pick the latest changelog file from a changelogs/ directory listing:
 * .md files only, semver descending; unparseable names sort last
 * (still selectable when nothing else exists). Returns null for an
 * empty listing.
 */
export function pickLatestChangelog(
  entries: Array<{ name: string; type: string }>,
): string | null {
  const files = entries.filter(
    (e) => e.type === "file" && e.name.endsWith(".md"),
  );
  if (files.length === 0) return null;
  const scored = files.map((e) => ({ name: e.name, key: semverKey(e.name) }));
  scored.sort((a, b) => {
    if (a.key === null && b.key === null) return a.name.localeCompare(b.name);
    if (a.key === null) return 1;
    if (b.key === null) return -1;
    for (let i = 0; i < 3; i++) {
      if (b.key[i] !== a.key[i]) return b.key[i] - a.key[i];
    }
    return 0;
  });
  return scored[0].name;
}

/**
 * Build the three-part changelog prompt:
 *   Part 1: user-editable instruction
 *   Part 2: per-commit sha / subject / body / diff
 *   Part 3: the most recent changelog as a style reference (optional)
 */
export function buildChangelogPrompt(input: {
  instruction: string;
  commits: ChangelogPromptCommit[];
  reference: ChangelogPromptReference | null;
}): string {
  const parts: string[] = [input.instruction.trim(), ""];

  // ── Part 2: commit data ──
  parts.push(`以下是被选中的 ${input.commits.length} 条提交（旧 → 新）：`);
  const blocks: string[] = [];
  for (const c of input.commits) {
    const lines = [`### commit ${c.sha}`, `提交信息：${c.subject}`];
    const body = c.body?.trim();
    if (body) lines.push(`提交正文：${body}`);
    if (c.patchFailed || c.patch === null) {
      lines.push("（该提交的 diff 获取失败，请仅根据提交信息推断改动。）");
    } else {
      let diff = c.patch;
      let note = c.patchTruncated ? "\n……（diff 过大，已省略）" : "";
      if (diff.length > DIFF_PER_COMMIT_CHAR_BUDGET) {
        diff = diff.slice(0, DIFF_PER_COMMIT_CHAR_BUDGET);
        note = "\n……（diff 过大，已省略）";
      }
      lines.push(`diff：\n${diff}${note}`);
    }
    blocks.push(lines.join("\n"));
  }
  parts.push(blocks.join("\n\n"));

  // ── Part 3: reference changelog ──
  if (input.reference) {
    let content = input.reference.content;
    if (content.length > REFERENCE_CHAR_BUDGET) {
      content = content.slice(0, REFERENCE_CHAR_BUDGET);
    }
    parts.push(
      "",
      `以下是该项目最近一次更新日志（${input.reference.filename}），请模仿其格式与措辞风格：`,
      content,
    );
  }

  let prompt = parts.join("\n");

  // Total budget: shrink the largest commit diffs first.
  if (prompt.length > TOTAL_PROMPT_CHAR_BUDGET) {
    prompt = prompt.slice(0, TOTAL_PROMPT_CHAR_BUDGET);
  }
  return prompt;
}

/**
 * Clean the model's raw reply: strip <think> blocks and markdown code
 * fences the model may wrap around the answer, then trim.
 */
export function cleanChangelogReply(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fence = /```(?:markdown|md)?[^\S\r\n]*\r?\n([\s\S]*?)```/i.exec(out);
  if (fence) out = fence[1];
  return out.trim();
}
