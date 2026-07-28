# GitDiff 递归目录树渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `GitDiffBodyContent.vue` 的目录分组从"顶级目录"升级为"递归目录树"，承载后端 `git-status` 端点 v2.21.1+ 返回的多级未跟踪文件，让 `new_dir/nested/leaf.txt` 这样的路径以 IDE 风格嵌套显示。

**Architecture:** 抽出 `parseDirectorySections.ts` 提供递归 `buildDirectorySections` 纯函数；新增 `DiffDirectoryNode.vue` 组件做递归渲染；`GitDiffBodyContent.vue` 把 sections 改用 `buildDirectorySections` 并把顶层循环替换为渲染 `<DiffDirectoryNode>`，summary / 选择 / 折叠逻辑全改用 `walkSections` 递归实现。零后端改动，零 prop 签名变化对 `GitDiffFileItem.vue` / `GitDiffSidebar.vue`。

**Tech Stack:** Vue 3 (`<script setup>`) + TypeScript + vue-i18n 11 + Node 内建 `node --test`（用于纯函数单测）+ Vitest 1.6 + happy-dom（用于组件单测）。

**Spec:** `docs/superpowers/specs/2026-07-28-git-diff-recursive-directory-tree-design.md`
**API:** `F:\github\astrbot_plugin_spcode_toolkit\docs\api\webapi-git-status-api.md`

---

## Global Constraints

- **不**修改 spcode 插件代码（端点 v2.21.1+ 已就绪）
- **不**修改 `parseSpcodeGitStatus.ts` / `useSpcodeGitStatus.ts` / `useSpcodeNewFileLineCounts.ts`（解析/状态机/抓取层已正确处理递归路径）
- **不**修改 `GitDiffFileItem.vue`（叶子行不感知嵌套）
- **不**修改 `GitDiffSidebar.vue`（外层包装零变化）
- **不**修改后端 API、build 配置、`package.json` 依赖
- **不**引入新依赖（不引 vue-virtual-scroller 等）
- 沿用现有 `tests/*.test.mjs` 模式（Node `--test` + `--import tsx`）做纯函数单测
- 沿用现有 `src/**/*.spec.ts` 模式（Vitest + happy-dom）做组件单测
- i18n 同步中/英/俄三语（仅 1 个新键：`diffPreview.group.subdirAria`）
- `cd dashboard && pnpm typecheck` 无错
- `cd dashboard && pnpm lint` 无错
- commit message 遵循 conventional commits 格式（`feat:` / `test:` / `chore:` / `fix:`）
- 所有新增文件加作者 elecvoid243 + 日期 2026-07-28 注释
- 中文注释在 spec/plan 之外的代码中保持英文（与现有代码风格一致）

---

## File Structure

**新建文件（5 个）：**

| 文件 | 职责 |
|------|------|
| `dashboard/src/composables/parseDirectorySections.ts` | 纯函数 `buildDirectorySections` + `DiffSection` 类型 + `walkSections` helper |
| `dashboard/src/components/chat/message_list_comps/DiffDirectoryNode.vue` | 递归节点组件，渲染 header + 直接 files + 递归 children |
| `dashboard/tests/buildDirectorySections.test.mjs` | 13 个 `buildDirectorySections` 单测场景 |
| `dashboard/src/components/chat/message_list_comps/DiffDirectoryNode.spec.ts` | 11 个组件 DOM / 折叠 / 选择三态单测 |
| `dashboard/tests/parseSpcodeGitStatus.test.mjs` | 6 个 `parseSpcodeGitStatus` 解析补齐场景 |

**修改文件（4 个）：**

| 文件 | 改动范围 |
|------|----------|
| `dashboard/src/components/chat/message_list_comps/GitDiffBodyContent.vue` | 删除旧 `topLevelDir` + 旧 `buildDirectorySections`；`sections` computed 改用新函数；`summary` 改 `walkSections` 累加；`isSectionFullySelected` / `isSectionPartiallySelected` / `toggleGroupSelect` 递归化；`expandAll` / `collapseAll` 递归遍历；模板顶层循环替换为 `<DiffDirectoryNode>` |
| `dashboard/src/i18n/locales/en-US/features/chat.json` | +1 键 `diffPreview.group.subdirAria` |
| `dashboard/src/i18n/locales/zh-CN/features/chat.json` | +1 键 |
| `dashboard/src/i18n/locales/ru-RU/features/chat.json` | +1 键 |

**未受影响：**
- `GitDiffFileItem.vue` / `GitDiffSidebar.vue` / `parseSpcodeGitStatus.ts` / `useSpcodeGitStatus.ts` / `useSpcodeNewFileLineCounts.ts`

---

## Task 1: 写 `buildDirectorySections` 纯函数（含类型 + walk helper）

**Files:**
- Create: `dashboard/src/composables/parseDirectorySections.ts`
- Test: `dashboard/tests/buildDirectorySections.test.mjs`

**Interfaces:**
- Consumes: `SpcodeGitDiffFile[]`（已有 type from `parseSpcodeGitDiff`）+ `GitDiffScope`（已有 type from `parseSpcodeGitDiff`）
- Produces:
  - `DiffSection` interface（递归）
  - `buildDirectorySections(list, parentPath, scope): DiffSection[]`
  - `walkSections(sections, fn): void`

**Step 1.1: 创建 `tests/buildDirectorySections.test.mjs`，写入 13 个失败场景**

完整内容写入 `dashboard/tests/buildDirectorySections.test.mjs`：

```javascript
// Author: elecvoid243
// Date: 2026-07-28
// Spec: docs/superpowers/specs/2026-07-28-git-diff-recursive-directory-tree-design.md §3.3
// Test runner: node --test (Node v24 strips TS from .ts imports automatically).
// Run: cd dashboard && pnpm exec node --test --import tsx tests/buildDirectorySections.test.mjs
//
// Covers the recursive buildDirectorySections pure function. Mirrors
// tests/parseSpcodeGitDiff.test.mjs style — import directly from
// the .ts source; no Vue / happy-dom needed.

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDirectorySections,
  walkSections,
} from "../src/composables/parseDirectorySections.ts";

/** Minimal SpcodeGitDiffFile fixture factory. */
function file(path, additions = 0, deletions = 0) {
  return {
    path,
    status: "M",
    additions,
    deletions,
    slice: null,
    isBinary: false,
  };
}

// 1. Empty list
test("buildDirectorySections: empty list → []", () => {
  const result = buildDirectorySections([], "", "unstaged");
  assert.deepEqual(result, []);
});

// 2. Single file with no '/' → <root> section
test("buildDirectorySections: single root file → <root> section", () => {
  const result = buildDirectorySections(
    [file("README.md", 1, 0)],
    "",
    "unstaged",
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].label, "<root>");
  assert.equal(result[0].fullPath, "");
  assert.equal(result[0].id, "dir:");
  assert.equal(result[0].fileCount, 1);
  assert.equal(result[0].additions, 1);
  assert.equal(result[0].deletions, 0);
  assert.equal(result[0].files.length, 1);
  assert.equal(result[0].files[0].path, "README.md");
  assert.equal(result[0].children.length, 0);
});

// 3. Multiple files in same top-level dir
test("buildDirectorySections: multiple files in same top dir", () => {
  const result = buildDirectorySections(
    [file("a/x.py"), file("a/y.py")],
    "",
    "unstaged",
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].label, "a");
  assert.equal(result[0].fullPath, "a");
  assert.equal(result[0].id, "dir:a");
  assert.equal(result[0].fileCount, 2);
  assert.equal(result[0].files.length, 2);
  assert.equal(result[0].children.length, 0);
});

// 4. Multi-level nesting
test("buildDirectorySections: multi-level nesting", () => {
  const result = buildDirectorySections(
    [file("a/b/c.py")],
    "",
    "unstaged",
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].label, "a");
  assert.equal(result[0].fileCount, 0);
  assert.equal(result[0].files.length, 0);
  assert.equal(result[0].children.length, 1);
  const b = result[0].children[0];
  assert.equal(b.label, "b");
  assert.equal(b.fullPath, "a/b");
  assert.equal(b.id, "dir:a/b");
  assert.equal(b.fileCount, 0);
  assert.equal(b.children.length, 1);
  const c = b.children[0];
  assert.equal(c.label, "c");
  assert.equal(c.fullPath, "a/b/c");
  assert.equal(c.id, "dir:a/b/c");
  assert.equal(c.fileCount, 1);
  assert.equal(c.files[0].path, "c.py");
  assert.equal(c.children.length, 0);
});

// 5. Mixed: top-level file + nested file
test("buildDirectorySections: mixed top + nested", () => {
  const result = buildDirectorySections(
    [file("a/x.py", 1, 0), file("a/b/y.py", 2, 1)],
    "",
    "unstaged",
  );
  assert.equal(result.length, 1);
  const a = result[0];
  assert.equal(a.fileCount, 1);
  assert.equal(a.files[0].path, "x.py");
  assert.equal(a.additions, 1);
  assert.equal(a.children.length, 1);
  const b = a.children[0];
  assert.equal(b.fileCount, 1);
  assert.equal(b.files[0].path, "y.py");
  assert.equal(b.additions, 2);
});

// 6. Deep nesting chain
test("buildDirectorySections: deep nesting chain", () => {
  const result = buildDirectorySections(
    [file("a/b/c/d/e.txt")],
    "",
    "unstaged",
  );
  // a → b → c → d → e.txt
  let cur = result[0];
  const labels = [cur.label];
  for (;;) {
    if (cur.children.length === 0) break;
    cur = cur.children[0];
    labels.push(cur.label);
  }
  assert.deepEqual(labels, ["a", "b", "c", "d"]);
  assert.equal(cur.fileCount, 1);
  assert.equal(cur.files[0].path, "e.txt");
});

// 7. <root> identifier is set for repo-root files
test("buildDirectorySections: <root> label for repo-root files", () => {
  const result = buildDirectorySections(
    [file("README.md"), file("LICENSE")],
    "",
    "unstaged",
  );
  // Both files in <root> section
  assert.equal(result.length, 1);
  assert.equal(result[0].label, "<root>");
  assert.equal(result[0].files.length, 2);
});

// 8. Idempotence (id stability)
test("buildDirectorySections: same input → same ids", () => {
  const list = [file("a/x.py"), file("b/y.py"), file("a/b/z.py")];
  const run1 = buildDirectorySections(list, "", "unstaged");
  const run2 = buildDirectorySections(list, "", "unstaged");
  function collectIds(sections) {
    const ids = [];
    walkSections(sections, (s) => ids.push(s.id));
    return ids;
  }
  assert.deepEqual(collectIds(run1), collectIds(run2));
});

// 9. fileCount only counts direct files (not children)
test("buildDirectorySections: fileCount is direct-only", () => {
  const result = buildDirectorySections(
    [file("a/x.py"), file("a/b/y.py"), file("a/b/c/z.py")],
    "",
    "unstaged",
  );
  const a = result[0];
  assert.equal(a.fileCount, 1); // only x.py
  assert.equal(a.children[0].fileCount, 1); // only y.py
  assert.equal(a.children[0].children[0].fileCount, 1); // only z.py
});

// 10. additions/deletions only count direct files
test("buildDirectorySections: additions/deletions are direct-only", () => {
  const result = buildDirectorySections(
    [file("a/x.py", 5, 0), file("a/b/y.py", 10, 3)],
    "",
    "unstaged",
  );
  const a = result[0];
  assert.equal(a.additions, 5);
  assert.equal(a.deletions, 0);
  const b = a.children[0];
  assert.equal(b.additions, 10);
  assert.equal(b.deletions, 3);
});

// 11. Bucket order preserved
test("buildDirectorySections: bucket order preserved", () => {
  const result = buildDirectorySections(
    [file("a/x.py"), file("b/y.py"), file("a/z.py")],
    "",
    "unstaged",
  );
  // a appears before b
  assert.equal(result[0].label, "a");
  assert.equal(result[1].label, "b");
});

// 12. scope → badgeKind mapping
test("buildDirectorySections: scope drives badgeKind", () => {
  const r1 = buildDirectorySections([file("a.py")], "", "staged");
  assert.equal(r1[0].badgeKind, "staged");
  const r2 = buildDirectorySections([file("a.py")], "", "unstaged");
  assert.equal(r2[0].badgeKind, "unstaged");
  const r3 = buildDirectorySections([file("a.py")], "", "all");
  assert.equal(r3[0].badgeKind, "neutral");
});

// 13. No infinite recursion on deep trees
test("buildDirectorySections: terminates on deep nesting", () => {
  // Build a 10-level path
  const path = Array.from({ length: 10 }, (_, i) => `lvl${i}`).join("/") + "/file.txt";
  const result = buildDirectorySections([file(path)], "", "unstaged");
  // Walk to leaf
  let cur = result[0];
  for (let i = 0; i < 9; i++) {
    assert.equal(cur.children.length, 1, `level ${i} should have 1 child`);
    cur = cur.children[0];
  }
  assert.equal(cur.fileCount, 1);
  assert.equal(cur.children.length, 0);
});

// 14. walkSections visits all nodes (DFS pre-order)
test("walkSections: visits all nodes depth-first", () => {
  const result = buildDirectorySections(
    [file("a/x.py"), file("a/b/y.py"), file("c/z.py")],
    "",
    "unstaged",
  );
  const labels = [];
  walkSections(result, (s) => labels.push(s.label));
  assert.deepEqual(labels, ["a", "b", "c"]);
});

// 15. parentPath threading
test("buildDirectorySections: parentPath threaded into child id", () => {
  // Simulate a recursion call by passing a non-empty parentPath
  const result = buildDirectorySections(
    [file("inner.py")],
    "outer",
    "unstaged",
  );
  assert.equal(result[0].fullPath, "outer");
  assert.equal(result[0].id, "dir:outer");
});
```

- [ ] **Step 1.2: 跑测试，确认全部失败（红）**

Run: `cd dashboard && pnpm exec node --test --import tsx tests/buildDirectorySections.test.mjs 2>&1 | tail -20`
Expected: 全部 15 个测试 FAIL（`Cannot find module` 或 `function not defined`）

- [ ] **Step 1.3: 创建 `src/composables/parseDirectorySections.ts`**

```typescript
// Author: elecvoid243
// Date: 2026-07-28
// Spec: docs/superpowers/specs/2026-07-28-git-diff-recursive-directory-tree-design.md §3.3
//
// Recursive directory-section builder for the GitDiff sidebar's file
// list. The previous (2026-06-28) implementation grouped by top-level
// directory only, so a new tracked directory like `new_dir/` showed up
// as a single bucket even when it contained many nested files. After
// the spcode v2.21.1 git-status endpoint started returning recursive
// untracked paths (see webapi-git-status-api.md §6), the UI had no
// matching way to render the tree — this module fills that gap by
// splitting each path on the first `/` and recursing into the tail.
//
// Pure function (no Vue, no axios) so it is unit-testable under
// `node --test` (see tests/buildDirectorySections.test.mjs).

import type { SpcodeGitDiffFile, GitDiffScope } from "./parseSpcodeGitDiff";

/**
 * A node in the directory tree rendered by `GitDiffBodyContent`.
 * Each section has either direct files (no further `/` in the path)
 * or child sections (sub-directories), or both.
 */
export interface DiffSection {
  /** Stable id derived from fullPath; used as `collapsedGroups` Set key. */
  id: string;
  /** Header label. Equals the last path segment, or "<root>" for repo-root. */
  label: string;
  /** Repo-relative POSIX path. Empty string for the synthetic <root> section. */
  fullPath: string;
  /** Number of direct files in this section (excludes children). */
  fileCount: number;
  /** Direct-file-only additions. */
  additions: number;
  /** Direct-file-only deletions. */
  deletions: number;
  /** Files that directly live in this section (no '/' in path). */
  files: SpcodeGitDiffFile[];
  /** Sub-directory sections, recursively the same shape. */
  children: DiffSection[];
  /** Visual badge kind, drives section header dot color. */
  badgeKind: "staged" | "unstaged" | "neutral";
}

/** Visual badge kind derived from the active diff scope. */
function scopeBadge(scope: GitDiffScope): DiffSection["badgeKind"] {
  if (scope === "staged") return "staged";
  if (scope === "all") return "neutral";
  return "unstaged";
}

/**
 * Group a flat file list into a tree of `DiffSection` by recursively
 * splitting on the first `/` of each path. Bucket insertion order is
 * preserved (= first-seen order in `list`), matching the previous
 * flat-section behavior so the user sees the same diff sequence.
 *
 * Args:
 *   list:       flat list of files in any scope.
 *   parentPath: accumulated ancestor path; "" means the repo root.
 *   scope:      active diff scope, drives the per-section badge.
 *
 * Returns:
 *   DiffSection[] of (possibly empty) sections, each with its
 *   directly-attached files + nested children. Empty list → [].
 *
 * Idempotent: same input → same output, including ids. No exceptions
 * are thrown on any well-formed input (incl. empty list).
 */
export function buildDirectorySections(
  list: SpcodeGitDiffFile[],
  parentPath: string,
  scope: GitDiffScope,
): DiffSection[] {
  const buckets = new Map<string, SpcodeGitDiffFile[]>();
  for (const f of list) {
    const slash = f.path.indexOf("/");
    const head = slash < 0 ? f.path : f.path.slice(0, slash);
    const rest = slash < 0 ? f.path : f.path.slice(slash + 1);
    // rest already剥皮; recurse with rest as the child's path.
    // Spread to avoid mutating the caller's array.
    const bucket = buckets.get(head) ?? [];
    bucket.push({ ...f, path: rest });
    buckets.set(head, bucket);
  }
  const sections: DiffSection[] = [];
  for (const [head, items] of buckets) {
    const fullPath = parentPath ? `${parentPath}/${head}` : head;
    const directFiles = items.filter((f) => !f.path.includes("/"));
    const nested = items.filter((f) => f.path.includes("/"));
    const children = buildDirectorySections(nested, fullPath, scope);
    let additions = 0;
    let deletions = 0;
    for (const f of directFiles) {
      additions += f.additions;
      deletions += f.deletions;
    }
    sections.push({
      id: `dir:${fullPath}`,
      // Repo-root files (head === "" should not happen given the
      // bucket key always has at least one non-slash char, but the
      // empty-string case is treated as <root> defensively).
      label: fullPath === "" ? "<root>" : head,
      fullPath,
      fileCount: directFiles.length,
      additions,
      deletions,
      files: directFiles,
      children,
      badgeKind: scopeBadge(scope),
    });
  }
  return sections;
}

/**
 * Walk every section in the tree in DFS pre-order, calling `fn` on
 * each. Used by the parent (GitDiffBodyContent) to accumulate the
 * top-bar summary, toggle collapse-all, and prune selection. Pure
 * helper, exposed so the test file can introspect id ordering.
 */
export function walkSections(
  sections: DiffSection[],
  fn: (s: DiffSection) => void,
): void {
  for (const s of sections) {
    fn(s);
    if (s.children.length > 0) walkSections(s.children, fn);
  }
}
```

- [ ] **Step 1.4: 跑测试，确认全部通过（绿）**

Run: `cd dashboard && pnpm exec node --test --import tsx tests/buildDirectorySections.test.mjs 2>&1 | tail -20`
Expected: 全部 15 个测试 PASS

- [ ] **Step 1.5: 跑 typecheck 确认无类型错误**

Run: `cd dashboard && pnpm typecheck 2>&1 | tail -10`
Expected: 0 错误

- [ ] **Step 1.6: 提交**

```bash
git add dashboard/src/composables/parseDirectorySections.ts dashboard/tests/buildDirectorySections.test.mjs
git commit -m "feat(diff): add recursive buildDirectorySections + walkSections"
```

---

## Task 2: 写 `DiffDirectoryNode.vue` 组件（含 spec 测试）

**Files:**
- Create: `dashboard/src/components/chat/message_list_comps/DiffDirectoryNode.vue`
- Test: `dashboard/src/components/chat/message_list_comps/DiffDirectoryNode.spec.ts`

**Interfaces:**
- Consumes: `DiffSection` (from Task 1), `GitDiffFileItem` (existing)
- Produces: emits `toggle` / `stage` / `unstage` / `restore` / `open-file` / `discard-hunk` / `select` (mirrors `GitDiffFileItem`)

- [ ] **Step 2.1: 创建 `DiffDirectoryNode.spec.ts`，写入 11 个失败场景**

完整内容写入 `dashboard/src/components/chat/message_list_comps/DiffDirectoryNode.spec.ts`：

```typescript
// Author: elecvoid243
// Date: 2026-07-28
// Spec: docs/superpowers/specs/2026-07-28-git-diff-recursive-directory-tree-design.md §3.5
//
// Component tests for the recursive directory tree node. Uses
// Vitest + happy-dom (matches GitIgnoreEditor.spec.ts style).
// GitDiffFileItem and the i18n composable are stubbed because the
// contract under test is the section header / body / recursion
// behaviour, not the leaf row rendering.

import { describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";

// i18n mock: returns the key + k=v params (same shape as
// GitIgnoreEditor.spec.ts).
const tmMock = vi.fn(
  (key: string, params?: Record<string, string | number>) => {
    if (!params) return key;
    return Object.entries(params).reduce(
      (acc, [k, v]) => `${acc} ${k}=${String(v)}`,
      key,
    );
  },
);
vi.mock("@/i18n/composables", () => ({
  useModuleI18n: () => ({ tm: tmMock, getRaw: vi.fn() }),
}));

// GitDiffFileItem stub: real <div> with a `data-path` attr so the
// test can assert which file rows rendered. Emits the same events
// as the real component (we don't validate leaf rendering here).
vi.mock("./GitDiffFileItem.vue", async () => {
  const { defineComponent, h } = await import("vue");
  const Stub = defineComponent({
    name: "GitDiffFileItem",
    props: ["file"],
    emits: [
      "toggle",
      "stage",
      "unstage",
      "restore",
      "open-file",
      "select",
      "discard-hunk",
    ],
    setup(props, { emit }) {
      return () =>
        h(
          "div",
          {
            "data-path": props.file.path,
            "data-status": props.file.status,
            class: "git-diff-file-item",
            onClick: () => emit("toggle", props.file.path),
          },
          props.file.path,
        );
    },
  });
  return { default: Stub };
});

import DiffDirectoryNode from "./DiffDirectoryNode.vue";
import { buildDirectorySections } from "@/composables/parseDirectorySections";

function file(path: string, additions = 0, deletions = 0) {
  return { path, status: "M", additions, deletions, slice: null, isBinary: false };
}

function mountNode(section, depth = 0, extraProps: Record<string, unknown> = {}) {
  return mount(DiffDirectoryNode, {
    props: {
      section,
      depth,
      expanded: new Set<string>(),
      collapsedGroups: new Set<string>(),
      isDark: false,
      showStage: false,
      showUnstage: false,
      showRestore: false,
      newFilePaths: new Set<string>(),
      isSelected: (_p: string) => false,
      isStagingForPath: (_p: string) => false,
      isUnstagingForPath: (_p: string) => false,
      isDiscardableFor: (_f: unknown) => false,
      isSectionFullySelected: (_s: unknown) => false,
      isSectionPartiallySelected: (_s: unknown) => false,
      selectableAriaLabel: (p: string) => `Select ${p}`,
      onToggleGroup: vi.fn(),
      onToggleSelect: vi.fn(),
      onToggleGroupSelect: vi.fn(),
      onFileToggle: vi.fn(),
      onFileStage: vi.fn(),
      onFileUnstage: vi.fn(),
      onFileRestore: vi.fn(),
      onFileOpen: vi.fn(),
      onFileDiscardHunk: vi.fn(),
      ...extraProps,
    },
  });
}

describe("DiffDirectoryNode", () => {
  // 1. Renders top-level section (depth=0) with no indentation
  it("top-level section renders with no padding", () => {
    const sec = buildDirectorySections([file("a/x.py")], "", "unstaged")[0];
    const w = mountNode(sec, 0);
    const root = w.find(".git-diff-section");
    expect(root.exists()).toBe(true);
    // depth 0 → padding-left should be 0px
    expect(root.attributes("style")).toMatch(/--depth:\s*0/);
  });

  // 2. Renders nested section (depth=1) with indent
  it("nested section renders with depth=1 in style", () => {
    const list = [file("a/b/c.py")];
    const sec = buildDirectorySections(list, "", "unstaged")[0];
    const w = mountNode(sec, 0);
    // Find the inner nested section
    const nested = w.findAll(".git-diff-section").at(1);
    expect(nested).toBeDefined();
    expect(nested!.attributes("style")).toMatch(/--depth:\s*1/);
  });

  // 3. Collapsed parent → child not rendered
  it("collapsed parent hides children", () => {
    const list = [file("a/b/c.py")];
    const sec = buildDirectorySections(list, "", "unstaged")[0];
    const w = mountNode(sec, 0, {
      collapsedGroups: new Set(["dir:a"]),
    });
    // v-show, not v-if, so element exists but display:none
    const body = w.find(".git-diff-section.is-collapsed .git-diff-section-body");
    expect(body.exists()).toBe(true);
    expect(body.attributes("style")).toMatch(/display:\s*none/);
  });

  // 4. Expanded parent → child rendered
  it("expanded parent renders children", () => {
    const list = [file("a/b/c.py")];
    const sec = buildDirectorySections(list, "", "unstaged")[0];
    const w = mountNode(sec, 0);
    const bodies = w.findAll(".git-diff-section-body");
    // 2 sections → 2 bodies
    expect(bodies.length).toBe(2);
    bodies.forEach((b) => {
      expect(b.attributes("style")).not.toMatch(/display:\s*none/);
    });
  });

  // 5. Section checkbox three-state
  it("section checkbox reflects fully-selected state", () => {
    const sec = buildDirectorySections([file("a/x.py")], "", "unstaged")[0];
    const w = mountNode(sec, 0, {
      isSectionFullySelected: (_s: unknown) => true,
      isSectionPartiallySelected: (_s: unknown) => false,
      showStage: true, // gate visibility
    });
    const cb = w.find(".git-diff-section-check input");
    expect(cb.exists()).toBe(true);
    expect(cb.attributes("checked")).toBeDefined();
  });

  it("section checkbox reflects indeterminate state", () => {
    const sec = buildDirectorySections([file("a/x.py")], "", "unstaged")[0];
    const w = mountNode(sec, 0, {
      isSectionFullySelected: (_s: unknown) => false,
      isSectionPartiallySelected: (_s: unknown) => true,
      showStage: true,
    });
    const cb = w.find(".git-diff-section-check input");
    expect(cb.exists()).toBe(true);
    // Vue prop binding produces `indeterminate` attribute
    expect(cb.attributes("indeterminate")).toBeDefined();
  });

  // 6. aria-label includes ancestor path
  it("section checkbox aria-label includes parent and name", () => {
    const list = [file("a/b/c.py")];
    const sec = buildDirectorySections(list, "", "unstaged")[0];
    // Mount the inner nested section
    const inner = sec.children[0];
    const w = mountNode(inner, 1, { showStage: true });
    const cb = w.find(".git-diff-section-check input");
    expect(cb.exists()).toBe(true);
    const aria = cb.attributes("aria-label") ?? "";
    // tmMock renders the key + params; expect both "b" (name) and
    // "a" (parent) to appear in the aria string.
    expect(aria).toMatch(/name=b/);
    expect(aria).toMatch(/parent=a/);
  });

  // 7. emit toggle
  it("clicking the row toggles the section", async () => {
    const sec = buildDirectorySections([file("a/x.py")], "", "unstaged")[0];
    const onToggleGroup = vi.fn();
    const w = mountNode(sec, 0, { onToggleGroup });
    await w.find(".git-diff-section-header").trigger("click");
    expect(onToggleGroup).toHaveBeenCalledWith(sec.id);
  });

  // 8. emit select
  it("emits select when checkbox changes", async () => {
    const sec = buildDirectorySections([file("a/x.py")], "", "unstaged")[0];
    const w = mountNode(sec, 0, { showStage: true });
    const cb = w.find(".git-diff-section-check input");
    expect(cb.exists()).toBe(true);
    // Set the input to checked and dispatch change
    await cb.setValue(true);
    // The component listens via @change which forwards to onToggleGroupSelect
    // (a prop callback), not a Vue emit. We verify the prop was called.
    // Since onToggleGroupSelect is a prop callback, we check it through
    // a wrapper-injected mock. Re-mount with explicit mock:
    const onToggleGroupSelect = vi.fn();
    const w2 = mountNode(sec, 0, {
      showStage: true,
      onToggleGroupSelect,
    });
    await w2.find(".git-diff-section-check input").setValue(true);
    expect(onToggleGroupSelect).toHaveBeenCalled();
  });

  // 9. emit stage / unstage / restore / open-file / discard-hunk
  it("forwards file row events via emit", async () => {
    const sec = buildDirectorySections([file("a/x.py")], "", "unstaged")[0];
    const w = mountNode(sec, 0, { showStage: true });
    // The stubbed GitDiffFileItem renders a <div data-path="x.py">
    // Find it under the section body (NOT under the section header)
    const fileRow = w.find(".git-diff-section-body .git-diff-file-item");
    expect(fileRow.exists()).toBe(true);
    // Trigger each event handler via $emit on the stub
    // The stub is invoked by the parent DiffDirectoryNode which
    // re-emits. We can't reach the stub directly; instead, verify
    // that the stub exists and is wired by clicking it (which the
    // stub handles by emitting toggle).
    await fileRow.trigger("click");
    // Parent should re-emit toggle with the file path
    expect(w.emitted("toggle")).toBeTruthy();
    expect(w.emitted("toggle")![0]).toEqual(["x.py"]);
  });

  // 10. section.files = [] still renders header
  it("section with empty files but children still renders header", () => {
    const list = [file("a/b/c.py")]; // → a has no direct files
    const sec = buildDirectorySections(list, "", "unstaged")[0];
    expect(sec.fileCount).toBe(0);
    expect(sec.children.length).toBe(1);
    const w = mountNode(sec, 0);
    expect(w.find(".git-diff-section-header").exists()).toBe(true);
  });

  // 11. Empty section (no files, no children) hides checkbox
  it("empty section hides checkbox", () => {
    // Build a degenerate section by hand
    const sec = {
      id: "dir:empty",
      label: "empty",
      fullPath: "empty",
      fileCount: 0,
      additions: 0,
      deletions: 0,
      files: [],
      children: [],
      badgeKind: "unstaged" as const,
    };
    const w = mountNode(sec, 0, { showStage: true });
    expect(w.find(".git-diff-section-check").exists()).toBe(false);
  });
});
```

- [ ] **Step 2.2: 跑测试，确认全部失败（红）**

Run: `cd dashboard && pnpm test -- DiffDirectoryNode.spec 2>&1 | tail -20`
Expected: 全部 11 个测试 FAIL（`Failed to resolve import` / component not found）

- [ ] **Step 2.3: 创建 `DiffDirectoryNode.vue` 组件**

完整内容写入 `dashboard/src/components/chat/message_list_comps/DiffDirectoryNode.vue`：

```vue
<!-- Author: elecvoid243, 2026-07-28
     Spec: docs/superpowers/specs/2026-07-28-git-diff-recursive-directory-tree-design.md §3.5
     Recursive directory tree node. One section = one directory in
     the GitDiff sidebar's file list. Self-renders files (leaf rows)
     + children (nested sub-directories). All events bubble up to
     the parent (GitDiffBodyContent), which owns the
     collapsedGroups Set, selectedFiles Set, and refresh logic. -->
<script setup lang="ts">
import { computed, inject, provide } from "vue";
import type { SpcodeGitDiffFile, GitDiffScope } from "@/composables/parseSpcodeGitDiff";
import { useModuleI18n } from "@/i18n/composables";
import type { DiffSection } from "@/composables/parseDirectorySections";
import GitDiffFileItem from "./GitDiffFileItem.vue";

const { tm } = useModuleI18n("features/chat");

/** Ancestor label provider chain. Each child reads the previous
 *  ancestor and overrides it with its own label, so a deeply nested
 *  node can render the FULL path "a/b/c" in its aria-label without
 *  walking the tree from the root. */
const PARENT_LABEL_KEY = "spcode:diffDirectoryNodeParentLabel";
const parentLabel = inject(PARENT_LABEL_KEY, "");
provide(PARENT_LABEL_KEY, props.section.label);

const props = defineProps<{
  section: DiffSection;
  depth: number;
  expanded: Set<string>;
  collapsedGroups: Set<string>;
  isDark: boolean;
  // Gate signals (booleans from parent)
  showStage: boolean;
  showUnstage: boolean;
  showRestore: boolean;
  newFilePaths?: ReadonlySet<string>;
  // Selection helpers
  isSelected: (path: string) => boolean;
  isStagingForPath: (path: string) => boolean;
  isUnstagingForPath: (path: string) => boolean;
  isDiscardableFor: (f: SpcodeGitDiffFile) => boolean;
  isSectionFullySelected: (s: DiffSection) => boolean;
  isSectionPartiallySelected: (s: DiffSection) => boolean;
  // i18n helpers
  selectableAriaLabel: (path: string) => string;
  // Callbacks
  onToggleGroup: (id: string) => void;
  onToggleSelect: (path: string, next: boolean) => void;
  onToggleGroupSelect: (s: DiffSection, next: boolean) => void;
  onFileToggle: (path: string) => void;
  onFileStage: (path: string) => void;
  onFileUnstage: (path: string) => void;
  onFileRestore: (path: string) => void;
  onFileOpen: (path: string) => void;
  onFileDiscardHunk: (params: {
    file: string;
    hunkIndex: number;
    patchText: string;
    scope: GitDiffScope;
  }) => void;
  scope?: GitDiffScope;
}>();

const emit = defineEmits<{
  (e: "toggle", path: string): void;
  (e: "restore", path: string): void;
  (e: "stage", path: string): void;
  (e: "unstage", path: string): void;
  (e: "open-file", path: string): void;
  (e: "discard-hunk", params: {
    file: string;
    hunkIndex: number;
    patchText: string;
    scope: GitDiffScope;
  }): void;
  (e: "select", payload: { path: string; selected: boolean }): void;
}>();

const isCollapsed = computed<boolean>(
  () => props.collapsedGroups.has(props.section.id),
);
const sectionHasContent = computed<boolean>(
  () => props.section.files.length > 0 || props.section.children.length > 0,
);
const anyBulkAffordance = computed<boolean>(
  () => props.showStage || props.showUnstage || props.showRestore,
);

// Recursive counts for the section header badge. Walks the subtree
// in lock-step with GitDiffBodyContent's summary aggregation so
// the per-section meta matches the top-bar total.
function countDescendants(s: DiffSection): number {
  let n = s.fileCount;
  for (const c of s.children) n += countDescendants(c);
  return n;
}
function sumAdditions(s: DiffSection): number {
  let n = s.additions;
  for (const c of s.children) n += sumAdditions(c);
  return n;
}
function sumDeletions(s: DiffSection): number {
  let n = s.deletions;
  for (const c of s.children) n += sumDeletions(c);
  return n;
}
const recursiveFileCount = computed(() => countDescendants(props.section));
const recursiveAdditions = computed(() => sumAdditions(props.section));
const recursiveDeletions = computed(() => sumDeletions(props.section));

// Wrapper helpers that route through the appropriate channel:
// - Header click → onToggleGroup callback (parent owns collapsedGroups)
// - File row events → re-emit (parent owns stagedFiles / dialogs)
function onHeaderClick(): void {
  props.onToggleGroup(props.section.id);
}
function onSectionCheckChange(e: Event): void {
  const checked = (e.target as HTMLInputElement).checked;
  props.onToggleGroupSelect(props.section, checked);
}
</script>

<template>
  <div
    class="git-diff-section is-dir"
    :class="[
      `is-${section.badgeKind}`,
      { 'is-collapsed': isCollapsed },
    ]"
    :style="{ '--depth': depth }"
  >
    <button
      type="button"
      class="git-diff-section-header"
      :aria-expanded="!isCollapsed"
      @click="onHeaderClick"
    >
      <v-icon
        size="14"
        class="git-diff-section-chevron"
        :class="{ expanded: !isCollapsed }"
      >mdi-chevron-right</v-icon>

      <!-- per-section "select all" checkbox -->
      <span
        v-if="anyBulkAffordance && sectionHasContent"
        class="git-diff-section-check"
        @click.stop
      >
        <input
          type="checkbox"
          :checked="isSectionFullySelected(section)"
          :indeterminate.prop="isSectionPartiallySelected(section)"
          :aria-label="tm('spcodeProjectLoad.diffPreview.group.subdirAria', { parent: parentLabel, name: section.label })"
          @change="onSectionCheckChange"
        />
      </span>

      <span class="git-diff-section-dot" :class="`is-${section.badgeKind}`" />
      <span class="git-diff-section-label">{{ section.label }}</span>
      <span class="git-diff-section-meta">
        <span class="git-diff-section-count">{{ recursiveFileCount }}</span>
        <span class="git-diff-section-stats">
          <span class="git-diff-add">+{{ recursiveAdditions }}</span>
          <span class="git-diff-del">−{{ recursiveDeletions }}</span>
        </span>
      </span>
    </button>

    <div v-show="!isCollapsed" class="git-diff-section-body">
      <!-- Direct leaf files -->
      <GitDiffFileItem
        v-for="f in section.files"
        :key="f.path + ':' + f.status"
        :file="f"
        :expanded="expanded.has(f.path)"
        :is-dark="isDark"
        :show-stage="showStage"
        :show-unstage="showUnstage"
        :on-stage="(p: string) => emit('stage', p)"
        :on-unstage="(p: string) => emit('unstage', p)"
        :on-restore="(p: string) => emit('restore', p)"
        :on-open-file="(p: string) => emit('open-file', p)"
        :is-staging="isStagingForPath(f.path)"
        :is-unstaging="isUnstagingForPath(f.path)"
        :is-new-file="newFilePaths?.has(f.path) ?? false"
        :selectable="anyBulkAffordance"
        :is-selected="isSelected(f.path)"
        :selectable-aria-label="selectableAriaLabel(f.path)"
        :on-discard-hunk="onFileDiscardHunk"
        :discardable="isDiscardableFor(f)"
        :scope="scope"
        @toggle="emit('toggle', $event)"
        @restore="emit('restore', $event)"
        @stage="emit('stage', $event)"
        @unstage="emit('unstage', $event)"
        @open-file="emit('open-file', $event)"
        @discard-hunk="emit('discard-hunk', $event)"
        @select="(selected: boolean) => emit('select', { path: f.path, selected })"
      />

      <!-- Recursive children: same component instance, depth+1 -->
      <DiffDirectoryNode
        v-for="child in section.children"
        :key="child.id"
        :section="child"
        :depth="depth + 1"
        :expanded="expanded"
        :collapsed-groups="collapsedGroups"
        :is-dark="isDark"
        :show-stage="showStage"
        :show-unstage="showUnstage"
        :show-restore="showRestore"
        :new-file-paths="newFilePaths"
        :is-selected="isSelected"
        :is-staging-for-path="isStagingForPath"
        :is-unstaging-for-path="isUnstagingForPath"
        :is-discardable-for="isDiscardableFor"
        :is-section-fully-selected="isSectionFullySelected"
        :is-section-partially-selected="isSectionPartiallySelected"
        :selectable-aria-label="selectableAriaLabel"
        :on-toggle-group="onToggleGroup"
        :on-toggle-select="onToggleSelect"
        :on-toggle-group-select="onToggleGroupSelect"
        :on-file-toggle="onFileToggle"
        :on-file-stage="onFileStage"
        :on-file-unstage="onFileUnstage"
        :on-file-restore="onFileRestore"
        :on-file-open="onFileOpen"
        :on-file-discard-hunk="onFileDiscardHunk"
        :scope="scope"
        @toggle="emit('toggle', $event)"
        @restore="emit('restore', $event)"
        @stage="emit('stage', $event)"
        @unstage="emit('unstage', $event)"
        @open-file="emit('open-file', $event)"
        @discard-hunk="emit('discard-hunk', $event)"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.git-diff-section {
  /* depth 缩进: per-level +16px */
  padding-left: calc(var(--depth, 0) * 16px);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.git-diff-section:last-of-type {
  border-bottom: 0;
}
.git-diff-section.is-collapsed {
  /* v-show controls body visibility; header stays visible */
}
.git-diff-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 14px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.75);
  background: rgba(var(--v-theme-on-surface), 0.025);
  border: 0;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  cursor: pointer;
  text-align: left;
  user-select: none;
  transition: background 0.12s ease;
}
.git-diff-section-header:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.git-diff-section-header:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}
.git-diff-section-chevron {
  color: rgba(var(--v-theme-on-surface), 0.5);
  flex-shrink: 0;
  transition: transform 0.15s ease;
}
.git-diff-section-chevron.expanded {
  transform: rotate(90deg);
}
.git-diff-section-check {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.git-diff-section-check input {
  cursor: pointer;
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: rgb(var(--v-theme-primary));
}
.git-diff-section-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.git-diff-section-dot.is-staged {
  background: rgba(76, 175, 80, 0.85);
}
.git-diff-section-dot.is-unstaged {
  background: rgba(var(--v-theme-secondary), 0.85);
}
.git-diff-section-dot.is-neutral {
  background: rgba(var(--v-theme-on-surface), 0.35);
}
.git-diff-section-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.git-diff-section-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  flex-shrink: 0;
}
.git-diff-section-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10.5px;
}
.git-diff-section-stats {
  display: inline-flex;
  gap: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.git-diff-section-stats .git-diff-add {
  color: rgb(46, 160, 67);
}
.git-diff-section-stats .git-diff-del {
  color: rgb(248, 81, 73);
}
.git-diff-section.is-dir.is-staged {
  border-left: 2px solid rgba(76, 175, 80, 0.45);
}
</style>
```

- [ ] **Step 2.4: 跑测试，确认全部通过（绿）**

Run: `cd dashboard && pnpm test -- DiffDirectoryNode.spec 2>&1 | tail -20`
Expected: 全部 11 个测试 PASS

- [ ] **Step 2.5: 跑 typecheck**

Run: `cd dashboard && pnpm typecheck 2>&1 | tail -10`
Expected: 0 错误

- [ ] **Step 2.6: 提交**

```bash
git add dashboard/src/components/chat/message_list_comps/DiffDirectoryNode.vue dashboard/src/components/chat/message_list_comps/DiffDirectoryNode.spec.ts
git commit -m "feat(diff): add DiffDirectoryNode recursive tree component"
```

---

## Task 3: 改 `GitDiffBodyContent.vue` 接入递归树

**Files:**
- Modify: `dashboard/src/components/chat/message_list_comps/GitDiffBodyContent.vue`

**Interfaces:**
- Consumes: `parseDirectorySections` 的 `buildDirectorySections` / `walkSections` (Task 1)
- Consumes: `DiffDirectoryNode` (Task 2)
- 不变: 对 `GitDiffSidebar.vue` 的 prop / emit 签名

- [ ] **Step 3.1: 删除旧实现（4 处）**

在 `GitDiffBodyContent.vue` 的 `<script setup>` 顶部附近（import 区下方）：

**删除：**
```typescript
function topLevelDir(path: string): string {
  // Top-level directory: the first path segment. Files at the repo
  // root (no '/') get the literal "<root>" bucket so they group
  // together instead of spreading across the "/" bucket.
  const idx = path.indexOf("/");
  if (idx < 0) return "<root>";
  return path.slice(0, idx);
}
```

**删除整个 `function buildDirectorySections(list, scope)` 函数**（约 35 行）—— 旧实现只分组顶级目录，被 `parseDirectorySections.ts` 的递归实现替代。

- [ ] **Step 3.2: 添加 import**

在现有 `import` 区追加：

```typescript
import {
  buildDirectorySections,
  walkSections,
  type DiffSection,
} from "@/composables/parseDirectorySections";
import DiffDirectoryNode from "@/components/chat/message_list_comps/DiffDirectoryNode.vue";
```

- [ ] **Step 3.3: 修改 `sections` computed（使用新函数）**

找到现有的 `const sections = computed<DiffSection[]>(() => { ... })` 块（约 line 270-280，调用旧 `buildDirectorySections(list, props.selectedScope ?? "unstaged")`），替换为：

```typescript
const sections = computed<DiffSection[]>(() => {
  const list = files.value;
  if (list.length === 0) return [];
  return buildDirectorySections(list, "", props.selectedScope ?? "unstaged");
});
```

- [ ] **Step 3.4: 修改 `summary` computed（递归累加）**

找到 `const summary = computed(() => { ... })`（约 line 200-215），替换为：

```typescript
const summary = computed(() => {
  const list = files.value;
  let fileCount = 0;
  let additions = 0;
  let deletions = 0;
  walkSections(sections.value, (s) => {
    fileCount += s.fileCount;
    additions += s.additions;
    deletions += s.deletions;
  });
  return {
    fileCount,
    additions,
    deletions,
    dirCount: uniqueTopLevelDirCount(list),
  };
});
```

注意：`dirCount` 仍用 `uniqueTopLevelDirCount(list)` 保持顶级 section 数量（即 spec 决策 11：dirCount 仅顶级数）；不要改成递归计数。

- [ ] **Step 3.5: 修改 `expandAll` / `collapseAll`（递归）**

找到 `function expandAll()` 和 `function collapseAll()`（约 line 314-340），替换为：

```typescript
function expandAll(): void {
  collapsedGroups.value = new Set();
  for (const f of files.value) {
    if (!props.expanded.has(f.path)) emit("toggle", f.path);
  }
}

function collapseAll(): void {
  const ids = new Set<string>();
  walkSections(sections.value, (s) => ids.add(s.id));
  collapsedGroups.value = ids;
  for (const f of files.value) {
    if (props.expanded.has(f.path)) emit("toggle", f.path);
  }
}
```

- [ ] **Step 3.6: 修改 `isSectionFullySelected` / `isSectionPartiallySelected`（递归）**

找到这两个函数（约 line 525-560），替换为：

```typescript
function isSectionFullySelected(section: DiffSection): boolean {
  // 1) all direct files selected
  for (const f of section.files) {
    if (!selectedFiles.value.has(f.path)) return false;
  }
  // 2) all child sections fully selected
  for (const c of section.children) {
    if (!isSectionFullySelected(c)) return false;
  }
  // 3) Empty section (no files, no children) is "not selected"
  return section.files.length + section.children.length > 0;
}

function isSectionPartiallySelected(section: DiffSection): boolean {
  let any = false;
  let all = true;
  for (const c of section.children) {
    if (isSectionFullySelected(c)) {
      any = true;
    } else if (isSectionPartiallySelected(c)) {
      any = true;
      all = false;
    } else {
      all = false;
    }
  }
  for (const f of section.files) {
    if (selectedFiles.value.has(f.path)) any = true;
    else all = false;
  }
  return any && !all;
}
```

- [ ] **Step 3.7: 修改 `toggleGroupSelect`（递归）**

找到 `function toggleGroupSelect(section: DiffSection, next: boolean): void`（约 line 503-512），替换为：

```typescript
function toggleGroupSelect(section: DiffSection, next: boolean): void {
  const updated = new Set(selectedFiles.value);
  walkSections([section], (s) => {
    for (const f of s.files) {
      if (next) updated.add(f.path);
      else updated.delete(f.path);
    }
  });
  selectedFiles.value = updated;
}
```

- [ ] **Step 3.8: 模板顶层循环替换（关键改动）**

在 `<template>` 内找到 `<div v-for="section in sections" :key="section.id" class="git-diff-section is-dir" :class="[...]"> ... </div>` 块（整段 section 渲染，约 line 720-810），整段替换为：

```vue
<DiffDirectoryNode
  v-for="section in sections"
  :key="section.id"
  :section="section"
  :depth="0"
  :expanded="expanded"
  :collapsed-groups="collapsedGroups"
  :is-dark="isDark"
  :show-stage="showStageButton"
  :show-unstage="showUnstageButton"
  :show-restore="showRestoreButton"
  :new-file-paths="newFilePaths"
  :is-selected="(p: string) => selectedFiles.has(p)"
  :is-staging-for-path="isStagingForPath"
  :is-unstaging-for-path="isUnstagingForPath"
  :is-discardable-for="discardableFor"
  :is-section-fully-selected="isSectionFullySelected"
  :is-section-partially-selected="isSectionPartiallySelected"
  :selectable-aria-label="(p: string) => tm('spcodeProjectLoad.diffPreview.toolbar.selectFile', { path: p })"
  :on-toggle-group="toggleGroup"
  :on-toggle-select="toggleSelect"
  :on-toggle-group-select="toggleGroupSelect"
  :on-file-toggle="(p: string) => emit('toggle', p)"
  :on-file-stage="(p: string) => emit('stage', p)"
  :on-file-unstage="(p: string) => emit('unstage', p)"
  :on-file-restore="(p: string) => emit('restore', p)"
  :on-file-open="(p: string) => emit('open-file', p)"
  :on-file-discard-hunk="onDiscardHunk"
  :scope="selectedScope"
  @stage="emit('stage', $event)"
  @unstage="emit('unstage', $event)"
  @restore="emit('restore', $event)"
  @open-file="emit('open-file', $event)"
  @toggle="emit('toggle', $event)"
  @discard-hunk="emit('discard-hunk', $event)"
  @select="(p: { path: string; selected: boolean }) => toggleSelect(p.path, p.selected)"
/>
```

- [ ] **Step 3.9: 删除模板里的旧 section CSS（已迁移到 DiffDirectoryNode）**

找到 `<style scoped>` 块中的所有 `.git-diff-section` 相关规则（约 line 1240-1480），整段删除（`.git-diff-section` / `.git-diff-section:last-of-type` / `.git-diff-section-header` / `.git-diff-section-header:hover` / `.git-diff-section-header:focus-visible` / `.git-diff-section-chevron` / `.git-diff-section-chevron.expanded` / `.git-diff-section-check` / `.git-diff-section-check input` / `.git-diff-section-dot` / `.git-diff-section-dot.is-staged` / `.git-diff-section-dot.is-unstaged` / `.git-diff-section-dot.is-neutral` / `.git-diff-section-label` / `.git-diff-section-meta` / `.git-diff-section-count` / `.git-diff-section-stats` / `.git-diff-section-stats .git-diff-add` / `.git-diff-section-stats .git-diff-del` / `.git-diff-section.is-dir.is-staged`）。

保留：`.git-diff-sticky-header` / `.git-diff-summary` / `.git-diff-summary-line` / `.git-diff-summary-count` / `.git-diff-summary-stats` / `.git-diff-summary-add` / `.git-diff-summary-del` / `.git-diff-toolbar` / `.git-diff-toolbar-group` / `.git-diff-toolbar-btn` / `.git-diff-toolbar-btn:hover` / `.git-diff-toolbar-btn:focus-visible` / `.git-diff-toolbar-btn:disabled` / `.git-diff-toolbar-btn.is-stage` / `.git-diff-toolbar-btn.is-unstage` / `.git-diff-toolbar-btn.is-restore` / `.git-diff-toolbar-btn.is-active` / `.git-diff-toolbar-selected` / `.git-diff-center` / `.git-diff-center-text` / `.git-diff-error-title` / `.git-diff-error-detail` / `.git-diff-banner-error` / `.git-diff-banner-retry`。

- [ ] **Step 3.10: 跑全部测试，确认无回归**

Run: `cd dashboard && pnpm test 2>&1 | tail -30`
Expected: 全部测试 PASS（包括新加的 15 + 11 个）

- [ ] **Step 3.11: 跑 typecheck**

Run: `cd dashboard && pnpm typecheck 2>&1 | tail -10`
Expected: 0 错误

- [ ] **Step 3.12: 跑 lint**

Run: `cd dashboard && pnpm exec eslint src/components/chat/message_list_comps/GitDiffBodyContent.vue src/components/chat/message_list_comps/DiffDirectoryNode.vue src/composables/parseDirectorySections.ts 2>&1 | tail -10`
Expected: 0 错误

- [ ] **Step 3.13: 提交**

```bash
git add dashboard/src/components/chat/message_list_comps/GitDiffBodyContent.vue
git commit -m "feat(diff): wire recursive directory tree into GitDiffBodyContent"
```

---

## Task 4: 补 i18n 键（3 语言）

**Files:**
- Modify: `dashboard/src/i18n/locales/en-US/features/chat.json`
- Modify: `dashboard/src/i18n/locales/zh-CN/features/chat.json`
- Modify: `dashboard/src/i18n/locales/ru-RU/features/chat.json`

- [ ] **Step 4.1: en-US 补 `diffPreview.group.subdirAria`**

打开 `dashboard/src/i18n/locales/en-US/features/chat.json`，找到 `"diffPreview": { "group": { "root": "..." } }`，在 `root` 之后补：

```json
"subdirAria": "Select all files in {parent}/{name}"
```

- [ ] **Step 4.2: zh-CN 补键**

打开 `dashboard/src/i18n/locales/zh-CN/features/chat.json`，同样位置补：

```json
"subdirAria": "全选 {parent}/{name} 下的所有文件"
```

- [ ] **Step 4.3: ru-RU 补键**

打开 `dashboard/src/i18n/locales/ru-RU/features/chat.json`，同样位置补：

```json
"subdirAria": "Выбрать все файлы в {parent}/{name}"
```

- [ ] **Step 4.4: 跑 i18n completeness 测试**

Run: `cd dashboard && pnpm test -- i18n.completeness 2>&1 | tail -10`
Expected: 0 错误（所有键三种语言齐）

- [ ] **Step 4.5: 验证 JSON 合法**

Run: `cd dashboard && node -e "['en-US','zh-CN','ru-RU'].forEach(l=>JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'/features/chat.json','utf8')))" && echo OK`
Expected: `OK`

- [ ] **Step 4.6: 提交**

```bash
git add dashboard/src/i18n/locales/en-US/features/chat.json dashboard/src/i18n/locales/zh-CN/features/chat.json dashboard/src/i18n/locales/ru-RU/features/chat.json
git commit -m "feat(i18n): add diffPreview.group.subdirAria in en/zh/ru"
```

---

## Task 5: 补 `parseSpcodeGitStatus` 单测

**Files:**
- Create: `dashboard/tests/parseSpcodeGitStatus.test.mjs`

**Step 5.1: 写测试文件**

完整内容写入 `dashboard/tests/parseSpcodeGitStatus.test.mjs`：

```javascript
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
  assert.equal(snap.meta.upstream!.branch, "origin/main");
  assert.equal(snap.meta.upstream!.ahead, 1);
  assert.equal(snap.meta.upstream!.behind, 0);
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
```

- [ ] **Step 5.2: 跑测试，确认全部通过**

Run: `cd dashboard && pnpm exec node --test --import tsx tests/parseSpcodeGitStatus.test.mjs 2>&1 | tail -20`
Expected: 全部 8 个测试 PASS（parser 已有实现，仅补覆盖）

- [ ] **Step 5.3: 提交**

```bash
git add dashboard/tests/parseSpcodeGitStatus.test.mjs
git commit -m "test: add parseSpcodeGitStatus coverage"
```

---

## Task 6: 端到端手测 + lint + 最终提交

**Files:** (无新增)

- [ ] **Step 6.1: 启动 dashboard**

Run: `cd dashboard && pnpm dev`
Expected: 启动日志显示 Vite 监听端口

- [ ] **Step 6.2: 加载 spcode 项目**

在浏览器中加载一个带 git 仓库的 spcode 项目。等待 git-status 拉取完成。

- [ ] **Step 6.3: 创建多级未跟踪文件**

在终端（项目根目录）执行：

```bash
mkdir -p new_dir/nested
echo "root content" > new_dir/root.txt
echo "leaf content" > new_dir/nested/leaf.txt
mkdir -p src/sub
echo "x" > src/foo.py
echo "y" > src/sub/bar.py
echo "R" > README.md
```

- [ ] **Step 6.4: 验证树形渲染**

切到 GitDiff 侧栏，scope = unstaged。

预期：看到嵌套结构：
- `▶ new_dir`（fileCount: 1）
  - `root.txt`（叶子）
  - `▶ new_dir/nested`（fileCount: 1）
    - `leaf.txt`（叶子）
- `▶ src`（fileCount: 1）
  - `foo.py`（叶子）
  - `▶ src/sub`（fileCount: 1）
    - `bar.py`（叶子）
- `▶ <root>`（fileCount: 1）
  - `README.md`（叶子）

- [ ] **Step 6.5: 验证折叠**

点击 `new_dir` section header → 子 section 消失（v-show → display:none）。再点 → 出现。

- [ ] **Step 6.6: 验证批量选择**

勾选 `new_dir` 复选框 → toolbar 显示 "已选 2"（root.txt + leaf.txt 都进 selectedFiles）。点击 "暂存" → 两条都进入 stagedFiles。

- [ ] **Step 6.7: 验证 summary 累加**

顶部 sticky summary 显示 `2` 个文件、`+2 −0` 之类（与所有叶子一致）。切到 staged view → 这两条消失，summary 变为其他文件。

- [ ] **Step 6.8: 验证 expandAll / collapseAll**

点击 "Collapse all" → 所有 section 折叠（每个 header 都可见，body 都隐藏）。点击 "Expand all" → 全部展开。

- [ ] **Step 6.9: 验证 i18n aria-label**

打开浏览器 DevTools，定位 `new_dir/nested` section 的复选框，查看 aria-label 属性。预期：含 `name=nested parent=new_dir` 字段（en-US 渲染为 `"Select all files in a name=nested parent=new_dir"` 形式，tmMock 风格）。

- [ ] **Step 6.10: 停止 dev server**

按 Ctrl+C 停止 `pnpm dev`。

- [ ] **Step 6.11: 全量测试**

Run: `cd dashboard && pnpm test 2>&1 | tail -30`
Expected: 全部测试 PASS

- [ ] **Step 6.12: 全量 typecheck**

Run: `cd dashboard && pnpm typecheck 2>&1 | tail -10`
Expected: 0 错误

- [ ] **Step 6.13: 全量 lint**

Run: `cd dashboard && pnpm lint 2>&1 | tail -20`
Expected: 0 错误（autofix 已应用）

- [ ] **Step 6.14: 最终提交（如有 lint 修改）**

```bash
git status
# 如果有 lint 修改：
git add -u
git commit -m "chore(diff): apply lint fixes from recursive tree"
```

---

## Plan Self-Review

**1. Spec coverage（spec §-任务映射）：**

| Spec 章节 | 实现任务 |
|---|---|
| §3.3.1 `DiffSection` 接口 | Task 1 (Step 1.3) |
| §3.3.2 `buildDirectorySections` 算法 | Task 1 (Step 1.3) + 13 场景单测 (Step 1.1) |
| §3.4 `GitDiffBodyContent.vue` 改造（5 个子节）| Task 3（Steps 3.1-3.9） |
| §3.5 `DiffDirectoryNode.vue` 全部内容 | Task 2（Steps 2.1-2.3） |
| §4 i18n `subdirAria` | Task 4（Steps 4.1-4.3） |
| §5 错误处理 | 通过 §3 实现的防御性 fallback 覆盖（空 list、缺 prop） |
| §6.1 单元测试 13 场景 | Task 1 Step 1.1（覆盖 13 场景） |
| §6.2 组件测试 11 场景 | Task 2 Step 2.1（覆盖 11 场景） |
| §6.3 解析补齐 6 场景 | Task 5 Step 5.1（覆盖 8 场景，超过 spec） |
| §6.4 回归 | Task 6 Steps 6.11-6.12 |
| §7 端到端验收 16 步 | Task 6 Steps 6.1-6.10（10 步核心场景） |
| §8 风险与缓解 | 通过 `v-show` / `walkSections` 单一路径 / 0 业务逻辑变更 |
| §9 实施顺序 | 严格遵循 TDD：纯函数 → 组件 → 集成 → i18n → 解析补齐 → 手测 |

**2. Placeholder scan：** 全文搜索" TBD / TODO / 类似 Task N / fill in"——0 命中。每步都有具体代码 + 具体路径 + 具体命令。

**3. Type consistency：**
- `DiffSection` 在 `parseDirectorySections.ts` 定义，Task 2 / 3 都按此 import ✓
- `walkSections` 在 `parseDirectorySections.ts` 定义并 export，Task 3 正确 import ✓
- `buildDirectorySections` 签名 `(list, parentPath, scope): DiffSection[]`，Task 1 / 3 调用一致 ✓
- `DiffDirectoryNode` Props 中所有 prop 名与 Task 3 Step 3.8 模板绑定一致 ✓
- 组件 emits 名与 `GitDiffFileItem` 对齐（`toggle` / `stage` / `unstage` / `restore` / `open-file` / `discard-hunk` / `select`）✓

**4. Type/import cross-check:**
- `parseDirectorySections.ts` import 自 `./parseSpcodeGitDiff`（已有 `SpcodeGitDiffFile` / `GitDiffScope`）✓
- `DiffDirectoryNode.vue` import 自 `./GitDiffFileItem.vue`（已有组件）✓
- `GitDiffBodyContent.vue` import 自 `../composables/parseDirectorySections`（路径正确）✓

Plan 通过自审。
