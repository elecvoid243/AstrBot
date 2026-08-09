# 更新日志生成（Changelog Generate）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Git 历史页「更多功能」菜单新增「生成更新日志」：选择连续 commit 区段 → 编辑任务指引 + 版本号 + provider → 调 `/spcode/btw` 生成中文 changelog → 预览编辑后保存到 `项目根/changelogs/`。

**Architecture:** 后端仅扩展 `GET /spcode/git-show` 加 `full_patch=1`（整提交纯 diff）；前端逐 commit 取 patch，由纯函数 `changelogPrompt.ts` 组装三段式 prompt（任务指引 / 提交数据 / 最近一次 changelog 参考），经 `useSpcodeBtw` 调 LLM，`useSpcodeFileWrite` 落盘（已验证：新文件自动创建父目录，无需后端改动）。

**Tech Stack:** Python 3.10+（aiohttp web 插件）、Vue 3 `<script setup>` + Vuetify 3、TypeScript、node --test（.mjs 纯函数测试）、pytest（插件测试）。

**Spec:** `docs/superpowers/specs/2026-08-09-changelog-generate-design.md`（已批准）

## Global Constraints

- 所有修改仅本地提交，**禁止推送远端、禁止 PR**。
- 代码注释与日志用**英文**；prompt 模板与 changelog 内容用**中文**。
- Python 代码遵循 ruff（插件仓库 `ruff format .` / `ruff check .`）；前端遵循 Prettier（`npx prettier --write`）。
- 新文件标注作者 `elecvoid243` 与日期 `2026-08-09`。
- 后端响应**向后兼容**：不传 `full_patch` 时响应不得出现 `patch` / `patch_truncated` 字段。
- 前端 composer 函数必须是**纯函数**（无 Vue / axios 依赖），可被 `node --test` 直接 import。
- Google-style docstrings（Python）/ JSDoc 风格块注释（TS 纯函数导出）。

## Interfaces 总表（跨 Task 一致性契约）

| 名称 | 定义处 | 签名 |
|---|---|---|
| query param | 插件 git_show.py | `full_patch=1`，与 `path` 互斥 |
| 响应字段 | 插件 git_show.py | `data.patch: str`、`data.patch_truncated: bool`（仅请求时存在） |
| `GitShowData.patch` / `.patchTruncated` | Task 2 parseSpcodeGitShow.ts | `string \| null` / `boolean` |
| `fetchFullPatch` | Task 2 useSpcodeGitShow.ts | `(refName: string) => Promise<void>` |
| `getFullPatchData` / `getFullPatchState` / `isFullPatchLoading` | Task 2 useSpcodeGitShow.ts | `(refName: string) => GitShowData \| null` / `GitShowFetchState` / `boolean` |
| `SquashPayloadCommit` | 已存在于 GitLogView.vue | `{ sha: string; subject: string; body: string \| null }`（本计划复用） |
| `DEFAULT_CHANGELOG_INSTRUCTION` | Task 3 changelogPrompt.ts | `string` 常量 |
| `normalizeVersion` / `isSemver` / `changelogFilename` | Task 3 | `(raw: string) => string` 等 |
| `pickLatestChangelog` | Task 3 | `(entries: Array<{name: string; type: string}>) => string \| null` |
| `ChangelogPromptCommit` | Task 3 | `{ sha, subject, body, patch, patchTruncated, patchFailed }` |
| `buildChangelogPrompt` | Task 3 | `(input: { instruction: string; commits: ChangelogPromptCommit[]; reference: { filename: string; content: string } \| null }) => string` |
| `cleanChangelogReply` | Task 3 | `(text: string) => string` |
| `changelog` emit | Task 6 GitLogView.vue | `(e: "changelog", payload: { commits: SquashPayloadCommit[] })` |
| `changelogResetToken` prop | Task 6 GitLogView.vue | `number \| undefined` |
| GitChangelogDialog props | Task 5 | `{ modelValue: boolean; commits: SquashPayloadCommit[]; worktree: string \| null }` |
| GitChangelogDialog emits | Task 5 | `update:modelValue` / `saved(path: string)` / `close` |
| localStorage key | Task 5 | `astrbot.spcode.gitDiffSidebar.changelogInstruction` |

---

### Task 1: 插件 git-show `full_patch` 扩展（TDD）

**Files:**
- Modify: `F:\github\astrbot_plugin_spcode_toolkit\tools\webapi\git_show.py`
- Test: `F:\github\astrbot_plugin_spcode_toolkit\tests\test_git_show.py`

**Interfaces:**
- Consumes: 现有 `_git_endpoint_preflight` / `_run_git_async` / `_make_envelope` / `ReasonCode`
- Produces: query param `full_patch=1`；响应字段 `data.patch` / `data.patch_truncated`

- [ ] **Step 1: 写失败测试（4 个，追加到 test_git_show.py 末尾）**

```python
# ──────────────────────────────────────────────────────────
# full_patch 视图(2026-08-09, changelog 生成)
# ──────────────────────────────────────────────────────────


async def test_show_full_patch_returns_pure_diff(
    monkeypatch, plugin, tmp_path: Path
):
    """full_patch=1 → data.patch 含 diff --git 段,不含 commit header。"""
    shas = _init_repo_simple(tmp_path, n=2)
    _load_project(plugin, "u:m", str(tmp_path))

    result = await _call_with_query(monkeypatch, plugin, full_patch="1")
    assert result["data"]["reason"] is None
    patch = result["data"]["patch"]
    assert isinstance(patch, str)
    assert "diff --git a/file1.txt b/file1.txt" in patch
    # --pretty=format: 空格式 → 无 commit header
    assert "Author:" not in patch
    assert "commit " not in patch.splitlines()[0]
    assert result["data"]["patch_truncated"] is False


async def test_show_full_patch_and_path_returns_invalid_param(
    monkeypatch, plugin, tmp_path: Path
):
    """full_patch 与 path 互斥,同传 → invalid_param。"""
    _init_repo_simple(tmp_path, n=1)
    _load_project(plugin, "u:m", str(tmp_path))

    result = await _call_with_query(
        monkeypatch, plugin, full_patch="1", path="file0.txt"
    )
    assert result["data"]["reason"] == ReasonCode.INVALID_PARAM


async def test_show_full_patch_truncation_flag(
    monkeypatch, plugin, tmp_path: Path
):
    """patch 超上限 → 截断且 patch_truncated=True(不报错)。"""
    _init_repo_simple(tmp_path, n=1)
    _load_project(plugin, "u:m", str(tmp_path))
    monkeypatch.setattr(_gs, "MAX_SHOW_FULL_PATCH_BYTES", 32)

    result = await _call_with_query(monkeypatch, plugin, full_patch="1")
    assert result["data"]["reason"] is None
    assert result["data"]["patch_truncated"] is True
    assert len(result["data"]["patch"]) == 32


async def test_show_without_full_patch_has_no_patch_field(
    monkeypatch, plugin, tmp_path: Path
):
    """不传 full_patch → 响应无 patch 字段(向后兼容)。"""
    _init_repo_simple(tmp_path, n=1)
    _load_project(plugin, "u:m", str(tmp_path))

    result = await _call_with_query(monkeypatch, plugin)
    assert "patch" not in result["data"]
    assert "patch_truncated" not in result["data"]
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd F:\github\astrbot_plugin_spcode_toolkit; python -m pytest tests/test_git_show.py -k full_patch -v`
Expected: 4 个 FAIL（`patch` KeyError / reason 不为 invalid_param / `MAX_SHOW_FULL_PATCH_BYTES` AttributeError）

- [ ] **Step 3: 实现（git_show.py 三处修改）**

修改 1 — 常量区（`MAX_SHOW_FILE_BYTES` 之后）追加：

```python
# 2026-08-09 (elecvoid243): full-commit patch view (?full_patch=1) for
# changelog generation. Truncate-not-fail: a single huge commit must
# not block the whole changelog flow.
MAX_SHOW_FULL_PATCH_BYTES = 256 * 1024  # 256 KB full-commit patch cap
```

修改 2 — handler 的 `?path=` 解析块（Step 「1b」注释块）之后追加：

```python
    # ── 1c. 可选 ?full_patch=1 整提交 patch 视图(2026-08-09, changelog) ──
    # 与 ?path= 互斥(两者同传无意义,直接 invalid_param)。
    full_patch_raw = _qget("full_patch")
    full_patch = full_patch_raw is not None and full_patch_raw.strip().lower() in (
        "1",
        "true",
    )
    if full_patch and target_path is not None:
        return _make_envelope(
            success=False,
            reason=ReasonCode.INVALID_PARAM,
            elapsed_ms=_elapsed(),
            loaded=False,
            umo=umo,
            worktree=worktree,
        )
```

修改 3 — Step「8b」单文件 patch 块之后追加「8c」，并在响应构造后附加字段：

```python
    # ── 8c. 可选:整提交 patch 视图(?full_patch=1 时, 2026-08-09) ──
    # --pretty=format: 空格式 → stdout 为纯 diff(无 commit header),
    # 前端可直接嵌入 LLM prompt。超限截断而非报错(spec §4.1)。
    # 子调用失败不致命:patch_view=None → 响应不带 patch 字段,前端按
    # "该 commit diff 获取失败" 降级(仅 message 进 prompt)。
    patch_view: dict | None = None
    if full_patch:
        fp_args = list(git_prefix) + [
            "show",
            "--no-color",
            "--no-ext-diff",
            "--pretty=format:",
            ref,
        ]
        fp_result = await _run_git_async(fp_args, encoding="utf-8")
        if fp_result["ok"]:
            stdout_fp = fp_result["stdout"]
            fp_truncated = len(stdout_fp) > MAX_SHOW_FULL_PATCH_BYTES
            if fp_truncated:
                # stdout 已是解码后的 str,按字符截断安全(不会切断字节序列)
                stdout_fp = stdout_fp[:MAX_SHOW_FULL_PATCH_BYTES]
            patch_view = {"patch": stdout_fp, "patch_truncated": fp_truncated}
        else:
            logger.warning(
                "git show --pretty=format: %s (full_patch) 失败: %s",
                ref,
                fp_result.get("stderr", ""),
            )
            patch_view = None
```

并在文件末尾响应构造处（现有 `if file_view is not None:` 块之后）追加：

```python
    # 2026-08-09: 透传整提交 patch(仅在 ?full_patch=1 且子调用成功时)
    if patch_view is not None:
        response_data["data"]["patch"] = patch_view["patch"]
        response_data["data"]["patch_truncated"] = patch_view["patch_truncated"]
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `cd F:\github\astrbot_plugin_spcode_toolkit; python -m pytest tests/test_git_show.py -v`
Expected: 全部 PASS（含 4 个新测试 + 既有测试无回归）

- [ ] **Step 5: ruff + 提交**

Run: `cd F:\github\astrbot_plugin_spcode_toolkit; ruff format tools/webapi/git_show.py tests/test_git_show.py; ruff check tools/webapi/git_show.py tests/test_git_show.py`
Expected: 无错误

```bash
cd F:\github\astrbot_plugin_spcode_toolkit
git add tools/webapi/git_show.py tests/test_git_show.py
git commit -m "feat: add full_patch view to git-show endpoint for changelog generation"
```

---

### Task 2: 前端 parser + useSpcodeGitShow 扩展

**Files:**
- Modify: `F:\github\Astrbot\dashboard\src\composables\parseSpcodeGitShow.ts`
- Modify: `F:\github\Astrbot\dashboard\src\composables\useSpcodeGitShow.ts`

**Interfaces:**
- Consumes: Task 1 的 `data.patch` / `data.patch_truncated`
- Produces: `GitShowData.patch: string | null`、`GitShowData.patchTruncated: boolean`；`fetchFullPatch` / `getFullPatchData` / `getFullPatchState` / `isFullPatchLoading`

- [ ] **Step 1: parseSpcodeGitShow.ts 三处修改**

修改 1 — `SpcodeGitShowRawData` 接口（`file?:` 字段后）追加：

```ts
  // 2026-08-09 (elecvoid243): full-commit patch view (optional; only
  // present when ?full_patch=1 was requested and the git call succeeded)
  patch?: string | null;
  patch_truncated?: boolean;
```

修改 2 — `GitShowData` 接口（`file: GitShowFileView | null;` 后）追加：

```ts
  // 2026-08-09: full-commit patch (null unless requested + successful)
  patch: string | null;
  patchTruncated: boolean;
```

修改 3 — `parseSpcodeGitShow` 返回对象（`file: fileView,` 后）追加：

```ts
      patch: asStringOrNull(d.patch),
      patchTruncated: asBoolean(d.patch_truncated),
```

- [ ] **Step 2: useSpcodeGitShow.ts 扩展（镜像 fetchFile 模式）**

修改 1 — `UseSpcodeGitShow` 接口（`isFileLoading` 声明后）追加：

```ts
  /** 2026-08-09: Fetch (or no-op) for a commit's full patch
   *  (?full_patch=1). Idempotent; per-ref cached in dedicated maps
   *  so the commit-level and per-file caches stay untouched. */
  fetchFullPatch: (refName: string) => Promise<void>;
  /** 2026-08-09: Read cached full-patch snapshot (read .patch /
   *  .patchTruncated off the returned GitShowData). */
  getFullPatchData: (refName: string) => GitShowData | null;
  /** 2026-08-09: Read per-ref full-patch state. */
  getFullPatchState: (refName: string) => GitShowFetchState;
  /** 2026-08-09: True while a full-patch fetch is in flight. */
  isFullPatchLoading: (refName: string) => boolean;
```

修改 2 — composable 内（`fileInflight` 声明后）追加状态：

```ts
  // 2026-08-09: per-ref full-patch state (changelog generation).
  const patchStateMap = ref<Map<string, GitShowFetchState>>(new Map());
  const patchDataMap = ref<Map<string, GitShowData>>(new Map());
  const patchEtagMap = new Map<string, string>();
  const patchInflight = new Map<string, AbortController>();
```

修改 3 — `fetchFile` 函数之后追加 `fetchFullPatch` 及读取器：

```ts
  // ──────────────────────────────────────────────────────────
  // 2026-08-09: per-ref full-commit patch fetch (?full_patch=1)
  // Mirrors fetchFile but keyed on ref alone. Used by the changelog
  // dialog to gather per-commit diffs for the LLM prompt.
  // ──────────────────────────────────────────────────────────
  async function fetchFullPatch(refName: string): Promise<void> {
    if (!isMounted) return;
    if (!refName) return;
    if (patchInflight.has(refName)) return;
    const current = patchStateMap.value.get(refName);
    if (current?.kind === "ok") return;

    const umo = spcodeStatus.status.value.umo;
    if (!umo) {
      setPatchState(refName, { kind: "error", reason: "no_project_loaded" });
      return;
    }

    const ctrl = new AbortController();
    patchInflight.set(refName, ctrl);
    setPatchState(refName, { kind: "loading" });

    const worktree = toValue(worktreeRef);
    const key = `${etagKey({ umo, worktree, ref: refName })}|full`;
    const etag = patchEtagMap.get(key);

    try {
      const resp = await pluginExtensionApi.get<unknown>(
        "spcode/git-show",
        {
          params: {
            umo,
            ...(worktree ? { worktree } : {}),
            ref: refName,
            full_patch: "1",
            max_files: 1, // patch 视图不需要完整文件列表
          },
          headers: etag ? { "If-None-Match": etag } : {},
          validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
          signal: ctrl.signal,
        },
      );
      if (!isMounted) return;
      patchInflight.delete(refName);

      if (resp.status === 304) {
        const prev = patchDataMap.value.get(refName);
        if (prev) {
          setPatchState(refName, { kind: "ok", data: prev, notModified: true });
        }
        return;
      }

      const parsed: ParseResult<GitShowData> = parseSpcodeGitShow(resp.data);
      if (parsed.kind !== "ok") {
        setPatchState(refName, { kind: "error", reason: "unknown" });
        return;
      }
      const snap = parsed.snapshot;
      if (!snap.success) {
        setPatchState(refName, {
          kind: "error",
          reason: snap.reason ?? "unknown",
        });
        return;
      }

      const headers = resp.headers as Record<string, string> | undefined;
      const newEtag = headers?.["etag"] ?? headers?.["ETag"];
      if (newEtag) patchEtagMap.set(key, newEtag);

      setPatchData(refName, snap);
      setPatchState(refName, { kind: "ok", data: snap, notModified: false });
    } catch (err) {
      if (!isMounted) return;
      patchInflight.delete(refName);
      if ((err as { name?: string })?.name === "CanceledError") {
        return;
      }
      const anyErr = err as { code?: string; message?: string };
      const reason =
        anyErr.code === "ERR_NETWORK" || /network/i.test(anyErr.message ?? "")
          ? "network"
          : "unknown";
      setPatchState(refName, { kind: "error", reason });
    }
  }

  function setPatchState(refName: string, next: GitShowFetchState): void {
    const m = new Map(patchStateMap.value);
    m.set(refName, next);
    patchStateMap.value = m;
  }
  function setPatchData(refName: string, next: GitShowData): void {
    const m = new Map(patchDataMap.value);
    m.set(refName, next);
    patchDataMap.value = m;
  }
  function getFullPatchData(refName: string): GitShowData | null {
    return patchDataMap.value.get(refName) ?? null;
  }
  function getFullPatchState(refName: string): GitShowFetchState {
    return patchStateMap.value.get(refName) ?? { kind: "idle" };
  }
  function isFullPatchLoading(refName: string): boolean {
    return getFullPatchState(refName).kind === "loading";
  }
```

修改 4 — `invalidateAll` / `invalidateEtag` / `dispose` 中追加对应清理（跟随各函数内 v3.9 file 段之后）：

`invalidateAll` 内追加：

```ts
    // 2026-08-09: full-patch caches
    patchStateMap.value = new Map();
    patchDataMap.value = new Map();
    patchEtagMap.clear();
```

`invalidateEtag` 内追加：

```ts
    patchEtagMap.clear();
```

`dispose` 内追加：

```ts
    for (const ctrl of patchInflight.values()) ctrl.abort();
    patchInflight.clear();
    patchEtagMap.clear();
    patchStateMap.value = new Map();
    patchDataMap.value = new Map();
```

修改 5 — return 对象追加：

```ts
    fetchFullPatch,
    getFullPatchData,
    getFullPatchState,
    isFullPatchLoading,
```

- [ ] **Step 3: typecheck + 提交**

Run: `cd F:\github\Astrbot\dashboard; pnpm typecheck`
Expected: 无错误

```bash
cd F:\github\Astrbot
git add dashboard/src/composables/parseSpcodeGitShow.ts dashboard/src/composables/useSpcodeGitShow.ts
git commit -m "feat(chat): add full-commit patch fetch to useSpcodeGitShow"
```

---

### Task 3: changelogPrompt.ts 纯函数 + 单测（TDD）

**Files:**
- Create: `F:\github\Astrbot\dashboard\src\composables\changelogPrompt.ts`
- Test: `F:\github\Astrbot\dashboard\tests\changelogPrompt.test.mjs`

**Interfaces:**
- Consumes: 无（纯函数）
- Produces: `CHANGELOG_DIR` / `DEFAULT_CHANGELOG_INSTRUCTION` / `normalizeVersion` / `isSemver` / `changelogFilename` / `pickLatestChangelog` / `ChangelogPromptCommit` / `buildChangelogPrompt` / `cleanChangelogReply` / `DIFF_PER_COMMIT_CHAR_BUDGET` / `TOTAL_PROMPT_CHAR_BUDGET` / `REFERENCE_CHAR_BUDGET`

- [ ] **Step 1: 写失败测试**

Create `F:\github\Astrbot\dashboard\tests\changelogPrompt.test.mjs`:

```js
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
  assert.equal(pickLatestChangelog([{ name: "notes.md", type: "file" }]), "notes.md");
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd F:\github\Astrbot\dashboard; node --test tests/changelogPrompt.test.mjs`
Expected: FAIL（`Cannot find module '../src/composables/changelogPrompt.ts'`）

- [ ] **Step 3: 实现 changelogPrompt.ts**

Create `F:\github\Astrbot\dashboard\src\composables\changelogPrompt.ts`:

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd F:\github\Astrbot\dashboard; node --test tests/changelogPrompt.test.mjs`
Expected: 全部 PASS

- [ ] **Step 5: Prettier + 提交**

Run: `cd F:\github\Astrbot\dashboard; npx prettier --write src/composables/changelogPrompt.ts tests/changelogPrompt.test.mjs`

```bash
cd F:\github\Astrbot
git add dashboard/src/composables/changelogPrompt.ts dashboard/tests/changelogPrompt.test.mjs
git commit -m "feat(chat): add changelog prompt builder with three-part assembly"
```

---

### Task 4: i18n 文案（三语言）

**Files:**
- Modify: `F:\github\Astrbot\dashboard\src\i18n\locales\zh-CN\features\chat.json`
- Modify: `F:\github\Astrbot\dashboard\src\i18n\locales\en-US\features\chat.json`
- Modify: `F:\github\Astrbot\dashboard\src\i18n\locales\ru-RU\features\chat.json`

**Interfaces:**
- Produces: `spcodeProjectLoad.diffSidebar.changelog.*`（Task 5/6 消费，键名逐字如下）

- [ ] **Step 1: zh-CN — 在 `"squash": {` 块之后插入同级 `"changelog"` 块**

```json
      "changelog": {
        "menu": "生成更新日志",
        "menuAria": "选择提交并生成更新日志",
        "selectionHint": "请选择连续的一段提交（1-50 条）",
        "rowSelectTitle": "选中以生成日志",
        "rowSelectAria": "选中提交 {sha} 以生成日志",
        "cancelSelection": "取消",
        "dialogTitle": "生成更新日志",
        "versionLabel": "版本号",
        "versionWarning": "版本号不符合 X.Y.Z 格式",
        "providerLabel": "LLM Provider",
        "providerAuto": "自动（跟随会话）",
        "instructionLabel": "任务指引（可编辑）",
        "instructionReset": "恢复默认",
        "referenceSome": "格式参考：{file}",
        "referenceNone": "未找到历史 changelog，使用默认格式",
        "diffFailedWarning": "{count} 个提交的 diff 获取失败，将仅使用提交信息",
        "generate": "生成",
        "regenerate": "重新生成",
        "generatingHint": "正在生成更新日志…",
        "cancel": "取消",
        "save": "保存",
        "saveSuccess": "已保存到 {path}",
        "overwriteTitle": "覆盖确认",
        "overwriteMessage": "{file} 已存在，确定覆盖？",
        "overwriteOk": "覆盖",
        "error": {
          "no_provider": "无可用 LLM Provider",
          "provider_not_found": "指定的 Provider 不存在",
          "provider_type_invalid": "指定的 Provider 不是对话模型",
          "llm_error": "LLM 调用失败",
          "empty_response": "LLM 返回空内容",
          "network": "网络连接失败",
          "unknown": "生成失败（{reason}）"
        },
        "saveError": {
          "network": "网络错误，保存失败",
          "unknown": "保存失败（{reason}）"
        }
      },
```

- [ ] **Step 2: en-US — 同位置插入**

```json
      "changelog": {
        "menu": "Generate changelog",
        "menuAria": "Select commits and generate a changelog",
        "selectionHint": "Select a contiguous range of commits (1-50)",
        "rowSelectTitle": "Select for changelog",
        "rowSelectAria": "Select commit {sha} for changelog",
        "cancelSelection": "Cancel",
        "dialogTitle": "Generate changelog",
        "versionLabel": "Version",
        "versionWarning": "Version does not match X.Y.Z format",
        "providerLabel": "LLM Provider",
        "providerAuto": "Auto (follow session)",
        "instructionLabel": "Instruction (editable)",
        "instructionReset": "Reset to default",
        "referenceSome": "Style reference: {file}",
        "referenceNone": "No previous changelog found — default format",
        "diffFailedWarning": "Failed to fetch diffs for {count} commit(s); messages only",
        "generate": "Generate",
        "regenerate": "Regenerate",
        "generatingHint": "Generating changelog…",
        "cancel": "Cancel",
        "save": "Save",
        "saveSuccess": "Saved to {path}",
        "overwriteTitle": "Confirm overwrite",
        "overwriteMessage": "{file} already exists. Overwrite?",
        "overwriteOk": "Overwrite",
        "error": {
          "no_provider": "No LLM provider available",
          "provider_not_found": "Provider not found",
          "provider_type_invalid": "Provider is not a chat model",
          "llm_error": "LLM call failed",
          "empty_response": "LLM returned empty content",
          "network": "Network error",
          "unknown": "Generation failed ({reason})"
        },
        "saveError": {
          "network": "Network error while saving",
          "unknown": "Save failed ({reason})"
        }
      },
```

- [ ] **Step 3: ru-RU — 同位置插入**

```json
      "changelog": {
        "menu": "Создать changelog",
        "menuAria": "Выбрать коммиты и создать changelog",
        "selectionHint": "Выберите непрерывный диапазон коммитов (1-50)",
        "rowSelectTitle": "Выбрать для changelog",
        "rowSelectAria": "Выбрать коммит {sha} для changelog",
        "cancelSelection": "Отмена",
        "dialogTitle": "Создать changelog",
        "versionLabel": "Версия",
        "versionWarning": "Версия не соответствует формату X.Y.Z",
        "providerLabel": "LLM-провайдер",
        "providerAuto": "Авто (как в сессии)",
        "instructionLabel": "Инструкция (редактируемая)",
        "instructionReset": "Сбросить",
        "referenceSome": "Образец стиля: {file}",
        "referenceNone": "Прошлый changelog не найден — формат по умолчанию",
        "diffFailedWarning": "Не удалось получить diff для {count} коммит(ов); только сообщения",
        "generate": "Создать",
        "regenerate": "Пересоздать",
        "generatingHint": "Создание changelog…",
        "cancel": "Отмена",
        "save": "Сохранить",
        "saveSuccess": "Сохранено в {path}",
        "overwriteTitle": "Подтвердить перезапись",
        "overwriteMessage": "{file} уже существует. Перезаписать?",
        "overwriteOk": "Перезаписать",
        "error": {
          "no_provider": "Нет доступного LLM-провайдера",
          "provider_not_found": "Провайдер не найден",
          "provider_type_invalid": "Провайдер не является чат-моделью",
          "llm_error": "Ошибка вызова LLM",
          "empty_response": "LLM вернул пустой ответ",
          "network": "Ошибка сети",
          "unknown": "Ошибка создания ({reason})"
        },
        "saveError": {
          "network": "Ошибка сети при сохранении",
          "unknown": "Ошибка сохранения ({reason})"
        }
      },
```

- [ ] **Step 4: JSON 校验 + Prettier + 提交**

Run: `cd F:\github\Astrbot\dashboard; npx prettier --write src/i18n/locales/zh-CN/features/chat.json src/i18n/locales/en-US/features/chat.json src/i18n/locales/ru-RU/features/chat.json`
Expected: 无 JSON 语法错误

```bash
cd F:\github\Astrbot
git add dashboard/src/i18n/locales/zh-CN/features/chat.json dashboard/src/i18n/locales/en-US/features/chat.json dashboard/src/i18n/locales/ru-RU/features/chat.json
git commit -m "feat(chat): add changelog generation i18n strings"
```

---

### Task 5: GitChangelogDialog.vue 新组件

**Files:**
- Create: `F:\github\Astrbot\dashboard\src\components\chat\GitChangelogDialog.vue`

**Interfaces:**
- Consumes: Task 2（`useSpcodeGitShow.fetchFullPatch` 等）、Task 3（changelogPrompt 全部导出）、Task 4（i18n 键）、已有 `useSpcodeBtw` / `useSpcodeFileWrite` / `useSpcodeFileBrowser`
- Produces: props `{ modelValue: boolean; commits: SquashPayloadCommit[]; worktree: string | null }`；emits `update:modelValue` / `saved(path)` / `close`

- [ ] **Step 1: 创建组件（完整代码）**

```vue
<!-- Author: elecvoid243
     Date: 2026-08-09
     Spec: docs/superpowers/specs/2026-08-09-changelog-generate-design.md §5.2
     Changelog generation dialog: version + provider + editable
     instruction → btw LLM call → editable preview → save to
     <project>/changelogs/vX.Y.Z.md via /spcode/file-write. -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { listProviders } from "@/api";
import { useSpcodeBtw } from "@/composables/useSpcodeBtw";
import { useSpcodeFileBrowser } from "@/composables/useSpcodeFileBrowser";
import { useSpcodeFileWrite } from "@/composables/useSpcodeFileWrite";
import { useSpcodeGitShow } from "@/composables/useSpcodeGitShow";
import {
  CHANGELOG_DIR,
  DEFAULT_CHANGELOG_INSTRUCTION,
  buildChangelogPrompt,
  changelogFilename,
  cleanChangelogReply,
  isSemver,
  pickLatestChangelog,
  type ChangelogPromptCommit,
  type ChangelogPromptReference,
} from "@/composables/changelogPrompt";
import type { SquashPayloadCommit } from "@/components/chat/message_list_comps/GitLogView.vue";

const props = defineProps<{
  modelValue: boolean;
  /** Selected commits, oldest → newest. */
  commits: SquashPayloadCommit[];
  worktree: string | null;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  /** Fired after a successful save; payload is the repo-relative path. */
  (e: "saved", path: string): void;
  /** Fired on ANY close path (save / cancel / scrim) so the parent can
   *  exit the log-view selection mode. */
  (e: "close"): void;
}>();

const { tm } = useI18n();
const I18N = "spcodeProjectLoad.diffSidebar.changelog";

// ── Version ──
const version = ref("");
const versionInvalid = computed(
  () => version.value.trim().length > 0 && !isSemver(version.value),
);

// ── Provider selector (mirrors GitCommitDialog) ──
const AUTO_PROVIDER = "__auto__";
const providerId = ref<string>(AUTO_PROVIDER);
interface ProviderOption {
  id: string;
  label: string;
}
const providerOptions = ref<ProviderOption[]>([]);

async function loadProviders(): Promise<void> {
  try {
    const resp = await listProviders({
      query: { capability: "chat", enabled: true },
    });
    const providers = (resp.data?.data as { providers?: any[] } | undefined)
      ?.providers;
    if (!Array.isArray(providers)) {
      providerOptions.value = [];
      return;
    }
    providerOptions.value = providers
      .filter((p) => p && typeof p.id === "string")
      .map((p) => ({
        id: p.id,
        label: `${p.name || p.id}${typeof p.model === "string" && p.model ? ` (${p.model})` : ""}`,
      }));
  } catch {
    providerOptions.value = [];
  }
}

// ── Instruction (editable, persisted) ──
const INSTRUCTION_KEY = "astrbot.spcode.gitDiffSidebar.changelogInstruction";
const instruction = ref(loadInstruction());

function loadInstruction(): string {
  try {
    const v = localStorage.getItem(INSTRUCTION_KEY);
    return v && v.trim() ? v : DEFAULT_CHANGELOG_INSTRUCTION;
  } catch {
    return DEFAULT_CHANGELOG_INSTRUCTION;
  }
}
watch(instruction, (v) => {
  try {
    localStorage.setItem(INSTRUCTION_KEY, v);
  } catch {
    /* storage unavailable — session-only */
  }
});
function onResetInstruction(): void {
  instruction.value = DEFAULT_CHANGELOG_INSTRUCTION;
}

// ── Reference changelog (Part 3) — fetched once per dialog open ──
const fileBrowser = useSpcodeFileBrowser(ref(CHANGELOG_DIR));
const reference = ref<ChangelogPromptReference | null>(null);

async function loadReference(): Promise<void> {
  reference.value = null;
  await fileBrowser.refresh(CHANGELOG_DIR);
  const st = fileBrowser.state.value;
  if (st.kind !== "directory") return; // missing dir / error → no reference
  const name = pickLatestChangelog(st.snapshot.entries);
  if (!name) return;
  await fileBrowser.refresh(`${CHANGELOG_DIR}/${name}`);
  const fst = fileBrowser.state.value;
  if (fst.kind === "file" && typeof fst.snapshot.content === "string") {
    reference.value = { filename: `${CHANGELOG_DIR}/${name}`, content: fst.snapshot.content };
  }
}

// ── Generation ──
const btw = useSpcodeBtw();
const gitShow = useSpcodeGitShow(computed(() => props.worktree));
const content = ref("");
const generateErrorKey = ref<string | null>(null);
const diffFailedCount = ref(0);

async function onGenerate(): Promise<void> {
  generateErrorKey.value = null;
  diffFailedCount.value = 0;

  // 1. Fetch every commit's full patch in parallel; failures degrade.
  const results = await Promise.allSettled(
    props.commits.map((c) => gitShow.fetchFullPatch(c.sha)),
  );
  const promptCommits: ChangelogPromptCommit[] = props.commits.map((c, i) => {
    const settled = results[i];
    const data =
      settled.status === "fulfilled" ? gitShow.getFullPatchData(c.sha) : null;
    const failed = !data || data.patch === null;
    if (failed) diffFailedCount.value++;
    return {
      sha: c.sha,
      subject: c.subject,
      body: c.body ?? null,
      patch: data?.patch ?? null,
      patchTruncated: data?.patchTruncated ?? false,
      patchFailed: failed,
    };
  });

  // 2. Assemble the three-part prompt and ask btw (no umo: pure prompt).
  const prompt = buildChangelogPrompt({
    instruction: instruction.value,
    commits: promptCommits,
    reference: reference.value,
  });
  const result = await btw.ask({ prompt, providerId: providerId.value });
  if (!result.ok) {
    if (result.reason !== "aborted") {
      generateErrorKey.value = result.reason in ERROR_KEYS
        ? result.reason
        : "unknown";
    }
    return;
  }
  const cleaned = cleanChangelogReply(result.reply);
  if (!cleaned) {
    generateErrorKey.value = "empty_response";
    return;
  }
  content.value = cleaned;
}

const ERROR_KEYS: Record<string, true> = {
  no_provider: true,
  provider_not_found: true,
  provider_type_invalid: true,
  llm_error: true,
  empty_response: true,
  network: true,
};

// ── Save (existence probe → overwrite confirm → file-write) ──
const fileWrite = useSpcodeFileWrite(computed(() => props.worktree));
const overwriteConfirmOpen = ref(false);
const saveErrorKey = ref<string | null>(null);

const targetPath = computed(
  () => `${CHANGELOG_DIR}/${changelogFilename(version.value)}`,
);
const canSave = computed(
  () =>
    content.value.trim().length > 0 &&
    version.value.trim().length > 0 &&
    !btw.isGenerating.value,
);

async function onSave(): Promise<void> {
  saveErrorKey.value = null;
  await fileBrowser.refresh(targetPath.value);
  if (fileBrowser.state.value.kind === "file") {
    overwriteConfirmOpen.value = true;
    return;
  }
  await doSave();
}

async function doSave(): Promise<void> {
  overwriteConfirmOpen.value = false;
  const r = await fileWrite.save({
    path: targetPath.value,
    content: content.value.trimEnd() + "\n",
  });
  if (r.ok) {
    emit("saved", targetPath.value);
    close();
    return;
  }
  if (r.reason === "aborted") return;
  saveErrorKey.value = r.reason === "network" ? "network" : "unknown";
}

// ── Lifecycle ──
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    // Fresh state on every open; instruction persists via localStorage.
    version.value = "";
    providerId.value = AUTO_PROVIDER;
    content.value = "";
    generateErrorKey.value = null;
    saveErrorKey.value = null;
    diffFailedCount.value = 0;
    void loadProviders();
    void loadReference();
  },
);

function close(): void {
  // Generation never blocks closing (btw is side-effect-free).
  btw.cancel();
  emit("update:modelValue", false);
  emit("close");
}

onBeforeUnmount(() => {
  btw.dispose();
  gitShow.dispose();
  fileBrowser.dispose();
  fileWrite.dispose();
});
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    scrollable
    @update:model-value="(v) => (v ? null : close())"
  >
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">
        {{ tm(`${I18N}.dialogTitle`) }}
      </v-card-title>
      <v-card-text>
        <!-- Selected commits (oldest → newest, read-only) -->
        <div class="changelog-dialog-list">
          <div v-for="c in commits" :key="c.sha" class="changelog-dialog-item">
            <span class="changelog-dialog-sha">{{ c.sha.slice(0, 7) }}</span>
            <span class="changelog-dialog-subject">{{ c.subject }}</span>
          </div>
        </div>

        <v-text-field
          v-model="version"
          :label="tm(`${I18N}.versionLabel`)"
          density="compact"
          variant="outlined"
          hide-details="auto"
          :messages="versionInvalid ? tm(`${I18N}.versionWarning`) : []"
          :warning="versionInvalid"
          class="mb-3"
        />

        <v-select
          v-if="providerOptions.length > 0"
          v-model="providerId"
          :items="[
            { id: AUTO_PROVIDER, label: tm(`${I18N}.providerAuto`) },
            ...providerOptions,
          ]"
          item-value="id"
          item-title="label"
          :label="tm(`${I18N}.providerLabel`)"
          density="compact"
          variant="outlined"
          hide-details
          class="mb-3"
        />

        <div class="changelog-dialog-label-row">
          <label class="changelog-dialog-label">
            {{ tm(`${I18N}.instructionLabel`) }}
          </label>
          <v-btn size="x-small" variant="text" @click="onResetInstruction">
            {{ tm(`${I18N}.instructionReset`) }}
          </v-btn>
        </div>
        <v-textarea
          v-model="instruction"
          density="compact"
          variant="outlined"
          hide-details
          rows="6"
          auto-grow
          max-rows="14"
          class="mb-2"
        />

        <div class="changelog-dialog-reference">
          {{
            reference
              ? tm(`${I18N}.referenceSome`, { file: reference.filename })
              : tm(`${I18N}.referenceNone`)
          }}
        </div>

        <div v-if="diffFailedCount > 0" class="changelog-dialog-warning">
          {{ tm(`${I18N}.diffFailedWarning`, { count: diffFailedCount }) }}
        </div>
        <div v-if="generateErrorKey" class="changelog-dialog-error">
          {{
            generateErrorKey === "unknown"
              ? tm(`${I18N}.error.unknown`, { reason: "unknown" })
              : tm(`${I18N}.error.${generateErrorKey}`)
          }}
        </div>

        <v-btn
          size="small"
          variant="tonal"
          :loading="btw.isGenerating.value"
          :disabled="btw.isGenerating.value"
          class="mt-2"
          @click="onGenerate"
        >
          {{
            tm(
              content
                ? `${I18N}.regenerate`
                : `${I18N}.generate`,
            )
          }}
        </v-btn>
        <div v-if="btw.isGenerating.value" class="changelog-dialog-hint">
          {{ tm(`${I18N}.generatingHint`) }}
        </div>

        <v-textarea
          v-model="content"
          density="compact"
          variant="outlined"
          hide-details
          rows="10"
          auto-grow
          class="changelog-dialog-content mt-3"
        />

        <div v-if="saveErrorKey" class="changelog-dialog-error">
          {{
            saveErrorKey === "network"
              ? tm(`${I18N}.saveError.network`)
              : tm(`${I18N}.saveError.unknown`, { reason: "unknown" })
          }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">
          {{ tm(`${I18N}.cancel`) }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :disabled="!canSave"
          :loading="fileWrite.isSaving.value"
          @click="onSave"
        >
          {{ tm(`${I18N}.save`) }}
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Overwrite confirmation -->
    <v-dialog v-model="overwriteConfirmOpen" max-width="420">
      <v-card>
        <v-card-title class="text-h3 pa-4 pb-0 pl-6">
          {{ tm(`${I18N}.overwriteTitle`) }}
        </v-card-title>
        <v-card-text>
          {{ tm(`${I18N}.overwriteMessage`, { file: targetPath }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="overwriteConfirmOpen = false">
            {{ tm(`${I18N}.cancel`) }}
          </v-btn>
          <v-btn variant="tonal" color="warning" @click="doSave">
            {{ tm(`${I18N}.overwriteOk`) }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<style scoped>
.changelog-dialog-list {
  max-height: 120px;
  overflow-y: auto;
  margin-bottom: 12px;
  font-size: 12px;
}
.changelog-dialog-item {
  display: flex;
  gap: 8px;
  padding: 2px 0;
}
.changelog-dialog-sha {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: rgb(var(--v-theme-primary));
  flex: 0 0 auto;
}
.changelog-dialog-subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.changelog-dialog-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.changelog-dialog-label {
  font-size: 12px;
  opacity: 0.7;
}
.changelog-dialog-reference {
  font-size: 12px;
  opacity: 0.6;
  margin-bottom: 4px;
}
.changelog-dialog-warning {
  font-size: 12px;
  color: rgb(var(--v-theme-warning));
  margin: 4px 0;
}
.changelog-dialog-error {
  font-size: 12px;
  color: rgb(var(--v-theme-error));
  margin: 4px 0;
}
.changelog-dialog-hint {
  font-size: 12px;
  opacity: 0.6;
  margin-top: 4px;
}
.changelog-dialog-content :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
</style>
```

注意（实现时自查点）：
- `listProviders` 的 import 路径以 `GitCommitDialog.vue` 中的实际 import 为准照抄。
- `useSpcodeFileBrowser` 的 file snapshot 若实际字段名不是 `content`，以 `parseSpcodeFileBrowser.ts` 的 `SpcodeFileBrowserFileSnapshot` 为准修正。

- [ ] **Step 2: Prettier + typecheck（此时 GitLogView/Sidebar 尚未接线，组件未被引用，typecheck 应通过）**

Run: `cd F:\github\Astrbot\dashboard; npx prettier --write src/components/chat/GitChangelogDialog.vue; pnpm typecheck`
Expected: 无错误（`SquashPayloadCommit` 从 GitLogView.vue import —— 该类型已 export）

```bash
cd F:\github\Astrbot
git add dashboard/src/components/chat/GitChangelogDialog.vue
git commit -m "feat(chat): add changelog generation dialog component"
```

---

### Task 6: GitLogView.vue 选择模式 + 菜单项

**Files:**
- Modify: `F:\github\Astrbot\dashboard\src\components\chat\message_list_comps\GitLogView.vue`

**Interfaces:**
- Consumes: Task 4 i18n 键
- Produces: `changelog` emit（payload `{ commits: SquashPayloadCommit[] }`）、`changelogResetToken` prop

- [ ] **Step 1: script 修改（5 处）**

修改 1 — props 接口（`squashResetToken?: number;` 后）追加：

```ts
  /** 2026-08-09 changelog: bumped by the sidebar when the changelog
   *  dialog closes so we clear the selection (mirrors squashResetToken). */
  changelogResetToken?: number;
```

修改 2 — emits（`(e: "squash", ...)` 声明后）追加：

```ts
  // 2026-08-09 changelog: toolbar entry. Same payload shape as squash.
  (e: "changelog", payload: { commits: SquashPayloadCommit[] }): void;
```

修改 3 — squash 选择区（`onSquashCancel` 函数后）追加 changelog 选择状态机：

```ts
// ── Changelog selection (2026-08-09, spec 2026-08-09 §3.1) ──
// Mirrors the squash state machine with two deliberate differences:
//   1. Contiguity anywhere in the displayed list (NOT HEAD-anchored);
//      min 1 commit, max 50 (prompt-size guard).
//   2. Available in ANY history view (read-only operation), so no
//      viewingCurrent gate.
const CHANGELOG_MAX_COMMITS = 50;
const changelogSelecting = ref(false);
const selectedChangelogCommits = ref<Set<string>>(new Set<string>());

function toggleChangelogSelection(sha: string): void {
  const next = new Set(selectedChangelogCommits.value);
  if (next.has(sha)) next.delete(sha);
  else next.add(sha);
  selectedChangelogCommits.value = next;
}

/** Valid iff the selected shas form a contiguous segment of the
 *  displayed list and 1 <= size <= 50. */
const changelogSelection = computed<"none" | "valid" | "invalid">(() => {
  const n = selectedChangelogCommits.value.size;
  if (n === 0) return "none";
  if (n > CHANGELOG_MAX_COMMITS) return "invalid";
  const indices = commits.value
    .map((c, i) => (selectedChangelogCommits.value.has(c.sha) ? i : -1))
    .filter((i) => i !== -1);
  if (indices.length !== n) return "invalid";
  return indices[indices.length - 1] - indices[0] === n - 1
    ? "valid"
    : "invalid";
});

function onChangelogClick(): void {
  if (!changelogSelecting.value) {
    // Mutual exclusion: squash checkboxes cannot coexist.
    if (squashSelecting.value) onSquashCancel();
    changelogSelecting.value = true;
    return;
  }
  // Displayed list is newest → oldest; emit oldest → newest.
  const picked = commits.value
    .filter((c) => selectedChangelogCommits.value.has(c.sha))
    .reverse()
    .map((c) => ({ sha: c.sha, subject: c.subject, body: c.body }));
  emit("changelog", { commits: picked });
}

function onChangelogCancel(): void {
  changelogSelecting.value = false;
  selectedChangelogCommits.value = new Set();
}

// Reset channels mirror the squash watchers.
watch(
  () => props.changelogResetToken,
  () => {
    onChangelogCancel();
  },
);
```

修改 4 — 现有 `onSquashClick` 函数体内（`squashSelecting.value = true;` 之前）插入互斥：

```ts
    if (changelogSelecting.value) onChangelogCancel();
```

（注意：`onChangelogCancel` 声明在 `onSquashClick` 之后，函数声明提升使其合法；保持代码顺序不变即可。）

修改 5 — 现有「更多功能」菜单 `<v-list>` 内（squash 的 `v-list-item` 之后）追加菜单项：

```html
            <!-- 2026-08-09 changelog: contiguous-anywhere selection,
                 min 1 / max 50 commits, available in every history
                 view (read-only). -->
            <v-list-item
              class="git-log-more-actions-item"
              :disabled="
                changelogSelecting && changelogSelection !== 'valid'
              "
              @click="onChangelogClick"
            >
              <template #prepend>
                <v-icon size="14">mdi-file-document-edit-outline</v-icon>
              </template>
              <v-list-item-title>
                {{ tm("spcodeProjectLoad.diffSidebar.changelog.menu") }}
                <template
                  v-if="changelogSelecting && selectedChangelogCommits.size > 0"
                >
                  ({{ selectedChangelogCommits.size }})</template
                >
              </v-list-item-title>
              <v-tooltip
                activator="parent"
                location="start"
                :text="
                  changelogSelecting && changelogSelection !== 'valid'
                    ? tm('spcodeProjectLoad.diffSidebar.changelog.selectionHint')
                    : tm('spcodeProjectLoad.diffSidebar.changelog.menuAria')
                "
              />
            </v-list-item>
```

- [ ] **Step 2: template 修改（2 处）**

修改 1 — squash 的行首复选框 `<button>`（`v-if="viewingCurrent && squashSelecting"` 那个）之后，追加 changelog 复选框：

```html
        <button
          v-if="changelogSelecting"
          type="button"
          class="git-log-item-select"
          :class="{ 'is-selected': selectedChangelogCommits.has(c.sha) }"
          :title="tm('spcodeProjectLoad.diffSidebar.changelog.rowSelectTitle')"
          :aria-label="
            tm('spcodeProjectLoad.diffSidebar.changelog.rowSelectAria', {
              sha: c.shaShort || c.sha.slice(0, 7),
            })
          "
          :aria-pressed="selectedChangelogCommits.has(c.sha)"
          @click.stop="toggleChangelogSelection(c.sha)"
        >
          <v-icon size="14">
            {{
              selectedChangelogCommits.has(c.sha)
                ? "mdi-checkbox-marked"
                : "mdi-checkbox-blank-outline"
            }}
          </v-icon>
        </button>
```

修改 2 — 列表容器 class 绑定改为同时响应两种模式：

```html
      :class="{
        'squash-selecting': squashSelecting || changelogSelecting,
      }"
```

修改 3 — squash 的「取消」按钮（`v-if="viewingCurrent && squashSelecting"` 的 `.git-log-squash-cancel-btn`）之后，追加 changelog 取消按钮：

```html
        <v-btn
          v-if="changelogSelecting"
          class="git-log-squash-cancel-btn"
          size="small"
          variant="text"
          @click="onChangelogCancel"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.changelog.cancelSelection") }}
        </v-btn>
```

- [ ] **Step 3: Prettier + typecheck + 提交**

Run: `cd F:\github\Astrbot\dashboard; npx prettier --write src/components/chat/message_list_comps/GitLogView.vue; pnpm typecheck`
Expected: 无错误

```bash
cd F:\github\Astrbot
git add dashboard/src/components/chat/message_list_comps/GitLogView.vue
git commit -m "feat(chat): add changelog selection mode to git log view"
```

---

### Task 7: GitDiffSidebar.vue 接线

**Files:**
- Modify: `F:\github\Astrbot\dashboard\src\components\chat\GitDiffSidebar.vue`

**Interfaces:**
- Consumes: Task 5 组件、Task 6 emit/prop
- Produces: 完整功能闭环

- [ ] **Step 1: script 修改（4 处）**

修改 1 — import 区追加：

```ts
import GitChangelogDialog from "@/components/chat/GitChangelogDialog.vue";
import type { SquashPayloadCommit } from "@/components/chat/message_list_comps/GitLogView.vue";
```

（若 sidebar 已有 GitLogView 的 type import，合并进去。）

修改 2 — squash dialog state（`squashResetToken` 声明附近）追加：

```ts
// 2026-08-09 changelog: dialog state + the token that clears
// GitLogView's changelog selection after the dialog closes (any
// path: save / cancel / scrim). Mirrors the squash pair above.
const changelogDialogOpen = ref(false);
const changelogCommits = ref<SquashPayloadCommit[]>([]);
const changelogResetToken = ref(0);

function onChangelogRequest(payload: { commits: SquashPayloadCommit[] }): void {
  changelogCommits.value = payload.commits;
  changelogDialogOpen.value = true;
}
function onChangelogSaved(path: string): void {
  showSnackbar(
    tm("spcodeProjectLoad.diffSidebar.changelog.saveSuccess", { path }),
    "success",
  );
}
function onChangelogDialogClose(): void {
  changelogResetToken.value++;
}
```

（若 `SquashPayloadCommit` 已在 sidebar 中 import 过则跳过重复 import。）

- [ ] **Step 2: template 修改（2 处）**

修改 1 — `<GitLogView ...>` 标签上追加 prop 与监听（跟随 `:squash-reset-token` / `@squash` 之后）：

```html
            :changelog-reset-token="changelogResetToken"
```

```html
            @changelog="onChangelogRequest"
```

修改 2 — `<GitSquashDialog ...>` 之后挂载新对话框：

```html
        <!-- 2026-08-09 changelog: generation dialog (commits listed
             oldest → newest, same payload as squash). -->
        <GitChangelogDialog
          v-model="changelogDialogOpen"
          :commits="changelogCommits"
          :worktree="selectedWorktree"
          @saved="onChangelogSaved"
          @close="onChangelogDialogClose"
        />
```

- [ ] **Step 3: Prettier + typecheck + 提交**

Run: `cd F:\github\Astrbot\dashboard; npx prettier --write src/components/chat/GitDiffSidebar.vue; pnpm typecheck`
Expected: 无错误

```bash
cd F:\github\Astrbot
git add dashboard/src/components/chat/GitDiffSidebar.vue
git commit -m "feat(chat): wire changelog generation dialog into git diff sidebar"
```

---

### Task 8: 端到端验证

**Files:** 无（验证任务）

- [ ] **Step 1: 全量回归**

Run: `cd F:\github\Astrbot\dashboard; pnpm test; node --test tests/changelogPrompt.test.mjs; pnpm typecheck`
Expected: 全部 PASS

Run: `cd F:\github\astrbot_plugin_spcode_toolkit; python -m pytest tests/ -x -q`
Expected: 全部 PASS

- [ ] **Step 2: 手动验证清单**

前置：`uv run main.py`（6185）+ `cd dashboard && pnpm dev`（3000），加载一个 git 项目。

1. Git 历史页 → 「更多功能」→ 看到「生成更新日志」项。
2. 点击 → 行首出现复选框 + 工具栏出现「取消」；菜单项显示计数。
3. 勾选**非 HEAD 锚定**的连续 2-3 条（如第 3~5 行）→ 菜单项可用；勾选不连续 → 菜单项禁用且 tooltip 提示。
4. 点击菜单项 → 对话框打开：提交清单正确（旧→新）、任务指引预填默认模板、格式参考行显示最近一次 changelog（或「未找到」）。
5. 输入版本号 `0.1.0` → 选 provider → 生成 → 内容区出现中文 changelog（含 `## 新功能` 等分类、条目带短 sha）。
6. 编辑内容 → 修改任务指引 → 重新生成 → 新内容反映修改后的指引。
7. 保存 → snackbar 显示 `changelogs/v0.1.0.md` → 工作区文件浏览器可见该文件（`changelogs/` 自动创建）。
8. 再次生成同版本 → 保存 → 弹覆盖确认 → 确认后覆盖成功。
9. 关闭对话框 → 复选框与选区清空。
10. squash 与 changelog 模式互斥：开 squash 选择 → 点 changelog 菜单项 → squash 选区清空、changelog 复选框出现。

- [ ] **Step 3: 如发现缺陷，修复后回到 Step 1 重跑**
