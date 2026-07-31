# 工作区图片预览（Workspace Image Preview）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 GitDiffSidebar 工作区面板点击图片文件时内联显示图片（含历史版本），复用 BinaryPreview 管线。

**Architecture:** 后端仅扩展 `/spcode/file-binary` 的 `MIME_BY_EXT` 白名单（8 种图片扩展名）；前端 `useSpcodeFileBinary` 新增 `"image"` kind，新增 `ImagePreview.vue` 子组件挂入 `BinaryPreview` 分发器，`FileBrowserFilePreview` 增加图片分支挂载 `BinaryPreview`（`selectedRevision` 透传为 `gitRef`）。

**Tech Stack:** Python (Starlette handler, pytest), Vue 3 + Vuetify 3 + TypeScript, vitest + @vue/test-utils。

**Spec:** `docs/superpowers/specs/2026-07-31-workspace-image-preview-design.md`

## Global Constraints

- 工作区：`F:\github\Astrbot\.worktrees\feat-workspace-image-preview`（分支 `feat/workspace-image-preview`）。**例外**：spcode 插件位于 `F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit`，该目录被 `.gitignore`（`data/`）排除，**不在任何 git 分支内**——后端改动直接就地修改、验证，无 commit 步骤。
- 图片扩展名集合（8 种，三处必须一致）：`.png .jpg .jpeg .gif .webp .svg .bmp .ico`
- 所有注释与日志使用 **English**；新文件头标注 `Author: elecvoid243, 2026-07-31`。
- Commit message 使用 conventional commits（英文）。
- **禁止推送到远端，禁止发起 PR**；仅本地 commit。
- 后端校验命令在插件目录执行：`cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && uv run pytest tests/test_file_binary.py -v`
- 前端测试命令在 worktree 执行：`cd F:\github\Astrbot\.worktrees\feat-workspace-image-preview\dashboard && pnpm vitest run <spec>`
- 不做缩放/平移等查看器交互；不改动文档管理（DocumentManager）树白名单。

---

### Task 0: 前端依赖安装（worktree 准备）

**Files:**
- None（仅环境准备）

- [ ] **Step 1: 安装 dashboard 依赖**

Run: `cd F:\github\Astrbot\.worktrees\feat-workspace-image-preview\dashboard && pnpm install --prefer-offline --reporter=silent`
Expected: 退出码 0。

- [ ] **Step 2: 基线测试**

Run: `cd F:\github\Astrbot\.worktrees\feat-workspace-image-preview\dashboard && pnpm vitest run src/composables/__tests__/useSpcodeFileBinary.spec.ts src/components/chat/message_list_comps/binary_preview/BinaryPreview.spec.ts`
Expected: 全部 PASS（记录基线数量）。

---

### Task 1: 后端 — `MIME_BY_EXT` 图片白名单（就地，不在 git）

**Files:**
- Modify: `F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit\tools\webapi\_helpers.py`（约 line 59-65 的 `MIME_BY_EXT`）
- Test: `F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit\tests\test_file_binary.py`

**Interfaces:**
- Consumes: 现有 `file_binary.handle`（对白名单内任意扩展名通用，无需改动）
- Produces: `MIME_BY_EXT` 新增 8 项，供 Task 3 的前端联调依赖：
  `.png→image/png`、`.jpg→image/jpeg`、`.jpeg→image/jpeg`、`.gif→image/gif`、`.webp→image/webp`、`.svg→image/svg+xml`、`.bmp→image/bmp`、`.ico→image/x-icon`

- [ ] **Step 1: 写失败测试**

在 `tests/test_file_binary.py` 的 `# ─── Workspace path ───` 小节末尾（`test_workspace_symlink_rejected_with_415` 之后）追加：

```python
async def test_workspace_png_returns_image_content_type(
    monkeypatch: pytest.MonkeyPatch,
    worktree: Path,
) -> None:
    (worktree / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\nfake-png-bytes")
    plugin, umo = _make_plugin(worktree)
    resp = await _call(monkeypatch, plugin, path="logo.png", umo=umo)
    assert resp.status_code == 200
    assert resp.headers["Content-Type"] == MIME_BY_EXT[".png"]
    assert resp.body.startswith(b"\x89PNG")


async def test_workspace_svg_returns_svg_content_type(
    monkeypatch: pytest.MonkeyPatch,
    worktree: Path,
) -> None:
    (worktree / "icon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>', encoding="utf-8"
    )
    plugin, umo = _make_plugin(worktree)
    resp = await _call(monkeypatch, plugin, path="icon.svg", umo=umo)
    assert resp.status_code == 200
    assert resp.headers["Content-Type"] == MIME_BY_EXT[".svg"]
```

在 `# ─── Git ref path ───` 小节末尾（`test_ref_path_missing_file_returns_422` 之后）追加：

```python
async def test_ref_path_png_returns_blob_bytes(
    monkeypatch: pytest.MonkeyPatch,
    worktree: Path,
) -> None:
    (worktree / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\nfake-png-bytes")
    _run_git(worktree, ["add", "-A"])
    _run_git(worktree, ["commit", "-q", "-m", "add png"])

    plugin, umo = _make_plugin(worktree)
    resp = await _call(monkeypatch, plugin, path="logo.png", umo=umo, ref="HEAD")
    assert resp.status_code == 200
    assert resp.headers["Content-Type"] == MIME_BY_EXT[".png"]
    assert resp.body.startswith(b"\x89PNG")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && uv run pytest tests/test_file_binary.py -k "png or svg" -v`
Expected: 3 个新测试 FAIL（415 UNSUPPORTED_MEDIA_TYPE）。

- [ ] **Step 3: 扩展白名单**

修改 `tools/webapi/_helpers.py` 的 `MIME_BY_EXT`：

```python
MIME_BY_EXT: dict[str, str] = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    # Image types (spec 2026-07-31 workspace-image-preview). SVG is served
    # for <img>-tag consumption only, where browsers do not execute scripts.
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
}
```

- [ ] **Step 4: 运行全部测试确认通过**

Run: `cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && uv run pytest tests/test_file_binary.py -v`
Expected: 全部 PASS（原 13 + 新 3 = 16）。

- [ ] **Step 5: ruff 校验**

Run: `cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && uv run ruff format tools/webapi/_helpers.py tests/test_file_binary.py && uv run ruff check tools/webapi/_helpers.py tests/test_file_binary.py`
Expected: 无错误输出。

- [ ] **Step 6: 无 commit**

`data/` 在 `.gitignore` 中，后端改动不入库。在最终汇报中说明即可。

---

### Task 2: 前端 composable — `FileBinaryKind` 增加 `"image"`

**Files:**
- Modify: `dashboard/src/composables/useSpcodeFileBinary.ts`（`FileBinaryKind` 类型 + `detectKind` 函数 + `FileBinaryData.kind` 注释）
- Test: `dashboard/src/composables/__tests__/useSpcodeFileBinary.spec.ts`

**Interfaces:**
- Consumes: Task 1 的后端白名单（联调时；单测 mock 掉网络层）
- Produces: `FileBinaryKind = "pdf" | "docx" | "xlsx" | "csv" | "md" | "image"`；`detectKind("logo.PNG") === "image"`（大小写不敏感）。Task 3/4 依赖此 kind。

- [ ] **Step 1: 写失败测试**

在 `useSpcodeFileBinary.spec.ts` 的 `describe("useSpcodeFileBinary — shell")` 内、`fetchBinary() emits a GET ...` 用例之后追加：

```typescript
  it("detects image kind from content-disposition filename (case-insensitive)", async () => {
    mockGet.mockResolvedValueOnce(
      okBlob(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        "content-type": "image/png",
        "content-disposition": 'inline; filename="Logo.PNG"',
      }),
    );
    const c = withSetup(() => useSpcodeFileBinary(null));
    await c.fetchBinary("assets/Logo.PNG", "");
    const data = c.getData("assets/Logo.PNG", "");
    expect(data?.kind).toBe("image");
    expect(data?.filename).toBe("Logo.PNG");
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd F:\github\Astrbot\.worktrees\feat-workspace-image-preview\dashboard && pnpm vitest run src/composables/__tests__/useSpcodeFileBinary.spec.ts`
Expected: 新用例 FAIL（`data?.kind` 为 null 导致状态 error，断言失败）。

- [ ] **Step 3: 实现 detectKind + 类型扩展**

修改 `useSpcodeFileBinary.ts`：

```typescript
// FileBinaryData.kind 字段注释改为：
  /** Whitelist kind: pdf | docx | xlsx | csv | md | image. */

// 类型改为：
export type FileBinaryKind = "pdf" | "docx" | "xlsx" | "csv" | "md" | "image";

// detectKind 改为：
// Image extensions (spec 2026-07-31). Must stay in sync with the backend
// MIME_BY_EXT whitelist in tools/webapi/_helpers.py.
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"];

function detectKind(filename: string): FileBinaryKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".md")) return "md";
  if (IMAGE_EXTS.some((ext) => lower.endsWith(ext))) return "image";
  return null;
}
```

同时把文件头部注释中的 `Whitelist: PDF/DOCX/XLSX/CSV/MD` 更新为 `Whitelist: PDF/DOCX/XLSX/CSV/MD + images (PNG/JPG/GIF/WEBP/SVG/BMP/ICO)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd F:\github\Astrbot\.worktrees\feat-workspace-image-preview\dashboard && pnpm vitest run src/composables/__tests__/useSpcodeFileBinary.spec.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
cd /d F:\github\Astrbot\.worktrees\feat-workspace-image-preview
git add dashboard/src/composables/useSpcodeFileBinary.ts dashboard/src/composables/__tests__/useSpcodeFileBinary.spec.ts
git commit -m "feat(dashboard): add image kind to useSpcodeFileBinary"
```

---

### Task 3: 新增 `ImagePreview.vue` 组件

**Files:**
- Create: `dashboard/src/components/chat/message_list_comps/binary_preview/ImagePreview.vue`
- Test: `dashboard/src/components/chat/message_list_comps/binary_preview/ImagePreview.spec.ts`

**Interfaces:**
- Consumes: `Blob`（来自 `FileBinaryData.blob`，Task 2）
- Produces: `<ImagePreview :blob="Blob" :filename="string" />`，供 Task 4 的 BinaryPreview 分发表使用。文件名 prop 仅用于 `alt` 文本。

- [ ] **Step 1: 写失败测试**

创建 `ImagePreview.spec.ts`：

```typescript
// Author: elecvoid243, 2026-07-31
// ImagePreview — object URL lifecycle + resolution caption.
// jsdom does not implement URL.createObjectURL, so both URL helpers
// are stubbed before importing the component.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

const mockCreateObjectURL = vi.fn(() => "blob:mock-url");
const mockRevokeObjectURL = vi.fn();
URL.createObjectURL = mockCreateObjectURL;
URL.revokeObjectURL = mockRevokeObjectURL;

import ImagePreview from "./ImagePreview.vue";

const stubs = {
  "v-icon": { template: '<i class="icon" />' },
};

function makePng(): Blob {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
    type: "image/png",
  });
}

beforeEach(() => {
  mockCreateObjectURL.mockClear();
  mockRevokeObjectURL.mockClear();
});

describe("ImagePreview", () => {
  it("renders an img bound to a fresh object URL", () => {
    const wrapper = mount(ImagePreview, {
      props: { blob: makePng(), filename: "logo.png" },
      global: { stubs },
    });
    const img = wrapper.get("img");
    expect(img.attributes("src")).toBe("blob:mock-url");
    expect(img.attributes("alt")).toBe("logo.png");
    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
  });

  it("revokes the object URL on unmount", () => {
    const wrapper = mount(ImagePreview, {
      props: { blob: makePng(), filename: "logo.png" },
      global: { stubs },
    });
    wrapper.unmount();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("shows the resolution caption after the img load event", async () => {
    const wrapper = mount(ImagePreview, {
      props: { blob: makePng(), filename: "logo.png" },
      global: { stubs },
    });
    expect(wrapper.find(".image-preview__caption").exists()).toBe(false);
    await wrapper.get("img").trigger("load");
    expect(wrapper.find(".image-preview__caption").exists()).toBe(true);
    // jsdom reports naturalWidth/naturalHeight as 0; the caption format is what matters.
    expect(wrapper.find(".image-preview__caption").text()).toBe("0 × 0");
  });

  it("shows the error placeholder when the img fails to decode", async () => {
    const wrapper = mount(ImagePreview, {
      props: { blob: makePng(), filename: "logo.png" },
      global: { stubs },
    });
    await wrapper.get("img").trigger("error");
    expect(wrapper.find(".image-preview__error").exists()).toBe(true);
    expect(wrapper.find("img").exists()).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd F:\github\Astrbot\.worktrees\feat-workspace-image-preview\dashboard && pnpm vitest run src/components/chat/message_list_comps/binary_preview/ImagePreview.spec.ts`
Expected: FAIL（组件不存在，import 错误）。

- [ ] **Step 3: 实现组件**

创建 `ImagePreview.vue`：

```vue
<!-- Author: elecvoid243, 2026-07-31
     Spec: docs/superpowers/specs/2026-07-31-workspace-image-preview-design.md §4.3
     Renders an image Blob via an object URL. Fit-to-width by default,
     centered, vertically scrollable for tall images; a checkerboard
     backdrop keeps transparent PNG/SVG readable on dark themes. -->
<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  blob: Blob;
  filename: string;
}>();

const objectUrl = ref("");
const resolution = ref<{ width: number; height: number } | null>(null);
const loadFailed = ref(false);

// The watcher cleanup revokes the previous URL on blob change AND on
// component unmount (Vue runs effect cleanups on scope disposal), so
// no separate onBeforeUnmount hook is needed.
watch(
  () => props.blob,
  (blob, _old, onCleanup) => {
    loadFailed.value = false;
    resolution.value = null;
    const url = URL.createObjectURL(blob);
    objectUrl.value = url;
    onCleanup(() => URL.revokeObjectURL(url));
  },
  { immediate: true },
);

function onImgLoad(e: Event): void {
  const img = e.target as HTMLImageElement;
  resolution.value = { width: img.naturalWidth, height: img.naturalHeight };
}

function onImgError(): void {
  loadFailed.value = true;
}
</script>

<template>
  <div class="image-preview">
    <div v-if="loadFailed" class="image-preview__error">
      <v-icon icon="mdi-image-off-outline" size="32" />
    </div>
    <template v-else>
      <div class="image-preview__canvas">
        <img
          :src="objectUrl"
          :alt="filename"
          class="image-preview__img"
          @load="onImgLoad"
          @error="onImgError"
        />
      </div>
      <div v-if="resolution" class="image-preview__caption">
        {{ resolution.width }} × {{ resolution.height }}
      </div>
    </template>
  </div>
</template>

<style scoped>
.image-preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.image-preview__canvas {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 16px;
}

.image-preview__img {
  max-width: 100%;
  height: auto;
  display: block;
  /* Checkerboard backdrop so transparent PNG/SVG stays readable on
     both light and dark themes (pure CSS, no asset needed). */
  background-image:
    linear-gradient(45deg, rgba(128, 128, 128, 0.25) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(128, 128, 128, 0.25) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(128, 128, 128, 0.25) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(128, 128, 128, 0.25) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}

.image-preview__caption {
  padding: 4px 12px;
  text-align: center;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-variant-numeric: tabular-nums;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.image-preview__error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(var(--v-theme-error));
}
</style>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd F:\github\Astrbot\.worktrees\feat-workspace-image-preview\dashboard && pnpm vitest run src/components/chat/message_list_comps/binary_preview/ImagePreview.spec.ts`
Expected: 4 个用例全部 PASS。

- [ ] **Step 5: Commit**

```bash
cd /d F:\github\Astrbot\.worktrees\feat-workspace-image-preview
git add dashboard/src/components/chat/message_list_comps/binary_preview/ImagePreview.vue dashboard/src/components/chat/message_list_comps/binary_preview/ImagePreview.spec.ts
git commit -m "feat(dashboard): add ImagePreview component for binary preview pipeline"
```

---

### Task 4: `BinaryPreview.vue` 分发 `"image"` 分支

**Files:**
- Modify: `dashboard/src/components/chat/message_list_comps/binary_preview/BinaryPreview.vue`（import + 模板分发表）
- Test: `dashboard/src/components/chat/message_list_comps/binary_preview/BinaryPreview.spec.ts`

**Interfaces:**
- Consumes: Task 3 的 `<ImagePreview :blob :filename>`；Task 2 的 `kind: "image"`
- Produces: kind=image 时渲染 ImagePreview；header 自动显示 `IMAGE · 大小`（现有逻辑）。

- [ ] **Step 1: 写失败测试**

在 `BinaryPreview.spec.ts` 的 `stubs` 对象中追加 stub：

```typescript
  ImagePreview: { template: '<div class="image-stub" />', props: ["blob", "filename"] },
```

在 `describe("BinaryPreview — dispatch")` 末尾追加用例：

```typescript
  it("renders ImagePreview for kind=image", async () => {
    setState({ kind: "ok" });
    setData({
      blob: new Blob(),
      path: "logo.png",
      ref: "",
      resolvedSha: "",
      kind: "image",
      size: 0,
      filename: "logo.png",
      etag: "",
    });
    const wrapper = mount(BinaryPreview, {
      props: { path: "logo.png", gitRef: "", worktree: null },
      global: { stubs },
    });
    await flushPromises();
    expect(wrapper.find(".image-stub").exists()).toBe(true);
    expect(wrapper.find(".pdf-stub").exists()).toBe(false);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd F:\github\Astrbot\.worktrees\feat-workspace-image-preview\dashboard && pnpm vitest run src/components/chat/message_list_comps/binary_preview/BinaryPreview.spec.ts`
Expected: 新用例 FAIL（无 image-stub 元素）。

- [ ] **Step 3: 实现分发**

`BinaryPreview.vue` 的 `<script setup>` import 区追加：

```typescript
import ImagePreview from "./ImagePreview.vue";
```

模板 `.binary-preview__body` 内、`BinaryMarkdownPreview` 之后追加：

```vue
      <ImagePreview
        v-else-if="previewKind === 'image'"
        :blob="data.blob"
        :filename="data.filename"
      />
```

同时把文件头注释中的 `Container component for inline preview of binary files (PDF/DOCX/XLSX/CSV/MD)` 更新为 `(.../MD + images)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd F:\github\Astrbot\.worktrees\feat-workspace-image-preview\dashboard && pnpm vitest run src/components/chat/message_list_comps/binary_preview/BinaryPreview.spec.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
cd /d F:\github\Astrbot\.worktrees\feat-workspace-image-preview
git add dashboard/src/components/chat/message_list_comps/binary_preview/BinaryPreview.vue dashboard/src/components/chat/message_list_comps/binary_preview/BinaryPreview.spec.ts
git commit -m "feat(dashboard): dispatch image kind to ImagePreview in BinaryPreview"
```

---

### Task 5: `FileBrowserFilePreview.vue` 工作区图片分支

**Files:**
- Modify: `dashboard/src/components/chat/message_list_comps/FileBrowserFilePreview.vue`（script：`IMAGE_EXTS` + `isImageFile` + import；template：新增分支；style：`.preview-image`）

**Interfaces:**
- Consumes: Task 4 的 `<BinaryPreview :path :git-ref :worktree>`；本组件现有 props `fileRelativePath?: string`、`selectedRevision?: string | null`、`worktree?: string | null`、`state.snapshot.meta.name`
- Produces: 工作区面板点击 8 种图片扩展名文件时内联显示图片（当前文件 + 历史 raw 版本）。

- [ ] **Step 1: script 部分**

在 import 区（`import DiffPreview from "./DiffPreview.vue";` 附近）追加：

```typescript
import BinaryPreview from "./binary_preview/BinaryPreview.vue";
```

在 `isMarkdownFile` computed 之后追加：

```typescript
// 2026-07-31 workspace-image-preview: image extensions rendered inline
// via <BinaryPreview>. Must stay in sync with the backend MIME_BY_EXT
// whitelist and useSpcodeFileBinary's IMAGE_EXTS.
const IMAGE_EXTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
];

/** True when the selected file is an image we can preview inline.
 *  Extension-based (matching the backend whitelist); both the current
 *  working copy and historical-raw views route through BinaryPreview,
 *  which re-fetches bytes via /spcode/file-binary with ETag caching. */
const isImageFile = computed<boolean>(() => {
  if (props.state.kind !== "file") return false;
  const name = props.state.snapshot.meta.name.toLowerCase();
  return IMAGE_EXTS.some((ext) => name.endsWith(ext));
});
```

- [ ] **Step 2: template 部分**

在模板主体分支链中定位 `<!-- 二进制文件 (legacy: current working copy is binary) -->` 分支；注意图片分支需要**同时覆盖历史 raw 与当前文件**两种情况，因此插入点在 `isHistoricalDiff` 分支之后、`isHistoricalRaw && props.historicalIsBinary` 占位分支之前：

```vue
          <!-- 2026-07-31 workspace-image-preview: image files render
               inline through <BinaryPreview> (fetches bytes via
               /spcode/file-binary, dispatches to ImagePreview). Placed
               right after the historical-DIFF branch so images win over
               every generic "binary file" placeholder below, for both
               the current working copy and historical-raw views.
               Edit mode and historical diff mode still take precedence
               above. -->
          <div v-else-if="isImageFile" class="preview-image">
            <BinaryPreview
              :path="props.fileRelativePath ?? ''"
              :git-ref="props.selectedRevision ?? ''"
              :worktree="props.worktree ?? null"
            />
          </div>
```

- [ ] **Step 3: style 部分**

在 `<style scoped>` 中 `.preview-binary` 规则附近追加：

```css
/* 2026-07-31 workspace-image-preview: keeps the flex height chain so
   BinaryPreview fills the pane and tall images scroll inside it. */
.preview-image {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: 8px;
}
```

- [ ] **Step 4: 行为自检（无单测框架，人工核对清单）**

该组件当前无覆盖测试（仓库现状），按以下清单核对：

1. `canEdit` 已对 `meta.isBinary === true` 返回 false → 图片文件的「编辑」按钮自动隐藏，无需改动。
2. 复制按钮条件 `state.snapshot.content && !isHistoricalDiff` → 图片 `content` 为 null，自动隐藏，无需改动。
3. 历史 DIFF 模式（`isHistoricalDiff`）在图片分支之前 → 图片的 diff 视图仍显示「二进制文件」摘要，行为不变（设计 §5 接受此行为）。
4. `selectedRevision` 切换时 BinaryPreview 内部 watcher 按 `[path, gitRef]` 重取 → 历史 raw 图片自动刷新。
5. 元信息头（文件名/大小/mtime）与历史 banner 在图片分支上方正常显示。

- [ ] **Step 5: 全量相关测试回归**

Run: `cd F:\github\Astrbot\.worktrees\feat-workspace-image-preview\dashboard && pnpm vitest run src/composables/__tests__/useSpcodeFileBinary.spec.ts src/components/chat/message_list_comps/binary_preview`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
cd /d F:\github\Astrbot\.worktrees\feat-workspace-image-preview
git add dashboard/src/components/chat/message_list_comps/FileBrowserFilePreview.vue
git commit -m "feat(dashboard): preview images inline in workspace file browser"
```

---

### Task 6: 端到端验证（手动）

- [ ] **Step 1: 启动服务**

后端 `uv run main.py`（`http://localhost:6185`）+ `cd dashboard && pnpm dev`（`http://localhost:3000`）。通过 spcode 加载一个含 png/svg 图片的项目。

- [ ] **Step 2: 验收清单（对应 spec §7）**

1. 工作区面板点击 `.png` / `.svg` → 内联显示图片 + header（`IMAGE · 大小`）+ 分辨率 caption
2. 历史面板选某 revision 后查看该版本图片（raw 模式）→ 显示历史内容
3. 切到非图片文件 → 恢复代码视图；切回图片 → 不重复下载（ETag/304，可在 Network 面板确认）
4. 文档管理面板行为不变（树不显示图片）
5. 深色主题下透明 png 棋盘格背景可见
6. 超过 50MB 的图片 → 显示 `too_large` 错误占位

---

## Self-Review 记录

- **Spec 覆盖**：spec §4.1→Task 1；§4.2→Task 2；§4.3→Task 3；§4.4→Task 4；§4.5→Task 5；§4.6 i18n（复用现有 key，无需任务，已在 Global Constraints 覆盖）；§5 错误处理→Task 6 Step 2 #6；§6 测试→Task 1/2/3/4；§7 验收→Task 6。✅
- **Placeholder 扫描**：无 TBD/TODO；所有代码步骤含完整代码。✅
- **类型一致性**：`FileBinaryKind`/`detectKind`（Task 2）→ `previewKind === 'image'`（Task 4）→ `isImageFile`/`IMAGE_EXTS`（Task 5）命名一致；`ImagePreview` props `(blob, filename)` 在 Task 3/4 一致；`BinaryPreview` props `(path, gitRef, worktree)` 在 Task 4/5 一致。✅
