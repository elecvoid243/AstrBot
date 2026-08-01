# 聊天/文档代码块美化（ShikiCodeBlock）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用自研 `ShikiCodeBlock` 组件替换 markstream-vue 的 Monaco 代码块渲染，修复「无高亮/无背景」和「深色全屏不可见」两个问题。

**Architecture:** 通过 markstream-vue 的 `setCustomComponents` 机制，为 `"chat-message"` 和 `"document-view"` 两个 custom-id 注册 `ShikiCodeBlock`（shiki 高亮 + 自包含主题样式 + 语言标签/复制顶部条），删除被替代的 `ThemeAwareMarkdownCodeBlock.vue`。

**Tech Stack:** Vue 3 + Vuetify 3 + TypeScript, shiki (`@/utils/shiki`), vitest + @vue/test-utils。

**Spec:** `docs/superpowers/specs/2026-07-31-chat-code-block-shiki-design.md`

## Global Constraints

- 工作区：`F:\github\Astrbot\.worktrees\feat-chat-code-block-shiki`（分支 `feat/chat-code-block-shiki`），全部改动在 `dashboard/` 内，无后端改动。
- 所有注释使用 **English**；新文件头标注 `Author: elecvoid243, 2026-07-31`。
- Commit message 使用 conventional commits（英文）。**禁止推送远端 / 发起 PR**。
- shiki 工具统一从 `@/utils/shiki`（无扩展名）导入；剪贴板用 `@/utils/clipboard` 的 `copyToClipboard`。
- 测试命令：`cd F:\github\Astrbot\.worktrees\feat-chat-code-block-shiki\dashboard && pnpm vitest run <spec>`
- 类型检查：`cd F:\github\Astrbot\.worktrees\feat-chat-code-block-shiki\dashboard && pnpm typecheck`

---

### Task 0: 依赖安装 + 基线

- [ ] **Step 1: 安装依赖**

Run: `cd F:\github\Astrbot\.worktrees\feat-chat-code-block-shiki\dashboard && pnpm install --prefer-offline --reporter=silent`
Expected: 退出码 0。

- [ ] **Step 2: 基线验证**

Run: `cd F:\github\Astrbot\.worktrees\feat-chat-code-block-shiki\dashboard && pnpm typecheck && pnpm vitest run src/components/chat/message_list_comps/binary_preview`
Expected: typecheck 无输出（退出码 0）；vitest 全部 PASS。

---

### Task 1: 新增 `ShikiCodeBlock.vue` + 单测

**Files:**
- Create: `dashboard/src/components/shared/ShikiCodeBlock.vue`
- Test: `dashboard/src/components/shared/ShikiCodeBlock.spec.ts`

**Interfaces:**
- Consumes: `@/utils/shiki` 的 `getShikiHighlighter()` / `renderShikiCode(highlighter, code, language, colorMode)` / `escapeHtml(value)`；`@/utils/clipboard` 的 `copyToClipboard(text)`；`@/components/chat/message_list_comps/DiffPreview.vue`（props: `content: string`、`isDark: boolean`、`maxLines: number`）
- Produces: 默认导出 Vue 组件，props `{ node: Record<string, unknown>; isDark?: boolean }`，emits `{ copy: [payload: string] }`——Task 2 的注册依赖此契约。

- [ ] **Step 1: 写失败测试**

创建 `dashboard/src/components/shared/ShikiCodeBlock.spec.ts`：

```typescript
// Author: elecvoid243, 2026-07-31
// ShikiCodeBlock — dispatch (diff vs shiki vs plain), theme recompute,
// streaming plain-text phase, copy button.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

const mockRenderShikiCode = vi.fn(
  () => '<pre class="shiki-mock"><code>highlighted</code></pre>',
);
const mockGetShikiHighlighter = vi.fn(async () => ({ __highlighter: true }));
const mockCopyToClipboard = vi.fn(async () => true);

vi.mock("@/utils/shiki", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/shiki")>();
  return {
    ...actual,
    getShikiHighlighter: mockGetShikiHighlighter,
    renderShikiCode: mockRenderShikiCode,
  };
});

vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: mockCopyToClipboard,
}));

import ShikiCodeBlock from "./ShikiCodeBlock.vue";

const stubs = {
  DiffPreview: {
    template: '<div class="diff-stub" />',
    props: ["content", "isDark", "maxLines"],
  },
  "v-icon": { template: '<i class="icon" />' },
};

function makeNode(overrides: Record<string, unknown> = {}) {
  return { lang: "vue", code: "<div />", loading: false, ...overrides };
}

beforeEach(() => {
  mockRenderShikiCode.mockClear();
  mockGetShikiHighlighter.mockClear();
  mockCopyToClipboard.mockClear();
});

describe("ShikiCodeBlock", () => {
  it("renders shiki-highlighted HTML for a normal language", async () => {
    const wrapper = mount(ShikiCodeBlock, {
      props: { node: makeNode(), isDark: false },
      global: { stubs },
    });
    await flushPromises();
    expect(mockRenderShikiCode).toHaveBeenCalledWith(
      expect.anything(),
      "<div />",
      "vue",
      "light",
    );
    expect(wrapper.find(".shiki-mock").exists()).toBe(true);
    expect(wrapper.find(".shiki-code-block__lang").text()).toBe("vue");
  });

  it("routes lang=diff to DiffPreview without calling shiki", async () => {
    const wrapper = mount(ShikiCodeBlock, {
      props: { node: makeNode({ lang: "diff", code: "-a\n+b" }), isDark: true },
      global: { stubs },
    });
    await flushPromises();
    expect(wrapper.find(".diff-stub").exists()).toBe(true);
    expect(mockRenderShikiCode).not.toHaveBeenCalled();
  });

  it("shows plain text while loading, then highlights when final", async () => {
    const wrapper = mount(ShikiCodeBlock, {
      props: { node: makeNode({ loading: true }), isDark: false },
      global: { stubs },
    });
    await flushPromises();
    expect(mockRenderShikiCode).not.toHaveBeenCalled();
    expect(wrapper.find("pre.shiki-code-block__plain").text()).toBe("<div />");

    await wrapper.setProps({ node: makeNode({ loading: false }) });
    await flushPromises();
    expect(mockRenderShikiCode).toHaveBeenCalledTimes(1);
  });

  it("recomputes with dark colorMode when isDark flips", async () => {
    const wrapper = mount(ShikiCodeBlock, {
      props: { node: makeNode(), isDark: false },
      global: { stubs },
    });
    await flushPromises();
    await wrapper.setProps({ isDark: true });
    await flushPromises();
    expect(mockRenderShikiCode).toHaveBeenLastCalledWith(
      expect.anything(),
      "<div />",
      "vue",
      "dark",
    );
  });

  it("copy button copies the code and emits copy", async () => {
    const wrapper = mount(ShikiCodeBlock, {
      props: { node: makeNode(), isDark: false },
      global: { stubs },
    });
    await flushPromises();
    await wrapper.get(".shiki-code-block__copy").trigger("click");
    await flushPromises();
    expect(mockCopyToClipboard).toHaveBeenCalledWith("<div />");
    expect(wrapper.emitted("copy")![0]).toEqual(["<div />"]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd F:\github\Astrbot\.worktrees\feat-chat-code-block-shiki\dashboard && pnpm vitest run src/components/shared/ShikiCodeBlock.spec.ts`
Expected: FAIL（`Failed to resolve import "./ShikiCodeBlock.vue"`）。

- [ ] **Step 3: 实现组件**

创建 `dashboard/src/components/shared/ShikiCodeBlock.vue`：

```vue
<!-- Author: elecvoid243, 2026-07-31
     Spec: docs/superpowers/specs/2026-07-31-chat-code-block-shiki-design.md
     Lightweight code block for markstream-vue's code_block slot. Replaces
     the library's Monaco-based renderer (its stream-monaco peer dep is not
     installed, so code blocks degraded to an unstyled bare <pre>). Shiki
     highlighting comes from the shared @/utils/shiki singleton; all colors
     are self-contained so the block survives the DocumentManager fullscreen
     Teleport (which detaches the tree from Vuetify's color provider). -->
<script setup lang="ts">
import { computed, inject, ref, watch, type Ref } from "vue";
import {
  getShikiHighlighter,
  renderShikiCode,
} from "@/utils/shiki";
import { copyToClipboard } from "@/utils/clipboard";
import { useModuleI18n } from "@/i18n/composables";
import DiffPreview from "@/components/chat/message_list_comps/DiffPreview.vue";

const props = defineProps<{
  /** markstream code_block node: lang / code / loading are read. */
  node: Record<string, unknown>;
  /** Passed through by MarkdownRender; falls back to the isDark
   *  provide/inject chain, then to light. */
  isDark?: boolean;
}>();

const emit = defineEmits<{
  copy: [payload: string];
}>();

const { tm } = useModuleI18n("features/chat");

const injectedIsDark = inject<Ref<boolean> | boolean>("isDark");
const effectiveIsDark = computed(
  () =>
    props.isDark ??
    (injectedIsDark instanceof Object && "value" in injectedIsDark
      ? injectedIsDark.value
      : injectedIsDark) ??
    false,
);

const code = computed(() =>
  String(props.node.code ?? props.node.content ?? ""),
);
const lang = computed(() =>
  String(props.node.lang ?? props.node.language ?? "").trim(),
);
const langLabel = computed(() => (lang.value || "text").toLowerCase());
const isLoading = computed(() => props.node.loading === true);
const isDiff = computed(() => langLabel.value === "diff");

/** Highlighted HTML. Empty while the highlighter is still loading or the
 *  node is mid-stream — the plain-text branch renders in that window so
 *  streaming never re-highlights per token. */
const highlightedHtml = ref("");
let highlighter: unknown = null;
let highlightToken = 0;

watch(
  [code, effectiveIsDark, isLoading],
  async () => {
    if (isDiff.value || isLoading.value || !code.value) {
      highlightedHtml.value = "";
      return;
    }
    const token = ++highlightToken;
    if (!highlighter) highlighter = await getShikiHighlighter();
    if (token !== highlightToken) return; // superseded while awaiting
    highlightedHtml.value = renderShikiCode(
      highlighter,
      code.value,
      lang.value || "text",
      effectiveIsDark.value ? "dark" : "light",
    );
  },
  { immediate: true },
);

const showPlain = computed(() => highlightedHtml.value === "");

// Copy button with a 1s check-icon confirmation, mirroring the file
// preview's copy feedback pattern.
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

async function onCopy(): Promise<void> {
  if (!code.value) return;
  await copyToClipboard(code.value);
  emit("copy", code.value);
  copied.value = true;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copied.value = false;
  }, 1000);
}
</script>

<template>
  <DiffPreview
    v-if="isDiff"
    :content="code"
    :is-dark="effectiveIsDark"
    :max-lines="30"
  />
  <div v-else class="shiki-code-block">
    <div class="shiki-code-block__header">
      <span class="shiki-code-block__lang">{{ langLabel }}</span>
      <button
        type="button"
        class="shiki-code-block__copy"
        :aria-label="tm('spcodeProjectLoad.fileBrowser.preview.copy')"
        @click="onCopy"
      >
        <v-icon size="14">{{
          copied ? "mdi-check" : "mdi-content-copy"
        }}</v-icon>
      </button>
    </div>
    <!-- shiki output is generated locally from the same content the file
         preview already renders via v-html; no new trust boundary. -->
    <div
      v-if="!showPlain"
      class="shiki-code-block__body"
      v-html="highlightedHtml"
    />
    <pre
      v-else
      class="shiki-code-block__body shiki-code-block__plain"
    ><code v-text="code" /></pre>
  </div>
</template>

<style scoped>
.shiki-code-block {
  margin: 8px 0;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  overflow: hidden;
}

.shiki-code-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 4px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.shiki-code-block__lang {
  font-size: 11px;
  text-transform: lowercase;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-variant-numeric: tabular-nums;
}

.shiki-code-block__copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
}

.shiki-code-block__copy:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.87);
}

.shiki-code-block__body {
  padding: 12px;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.55;
}

/* shiki wraps its output in its own <pre> with a themed background;
   flatten it so the container background owns both themes. */
.shiki-code-block__body :deep(pre) {
  margin: 0;
  background: transparent !important;
  font: inherit;
}

.shiki-code-block__plain {
  margin: 0;
  white-space: pre;
}
</style>
```

- [ ] **Step 4: 运行确认通过**

Run: `cd F:\github\Astrbot\.worktrees\feat-chat-code-block-shiki\dashboard && pnpm vitest run src/components/shared/ShikiCodeBlock.spec.ts`
Expected: 5 个用例全部 PASS。

- [ ] **Step 5: Commit**

```bash
cd /d F:\github\Astrbot\.worktrees\feat-chat-code-block-shiki
git add dashboard/src/components/shared/ShikiCodeBlock.vue dashboard/src/components/shared/ShikiCodeBlock.spec.ts
git commit -m "feat(dashboard): add ShikiCodeBlock component for markdown code blocks"
```

---

### Task 2: 注册切换 + 删除旧组件

**Files:**
- Modify: `dashboard/src/components/chat/chatMarkdownComponents.ts`
- Modify: `dashboard/src/components/shared/MarkdownView.vue`
- Delete: `dashboard/src/components/shared/ThemeAwareMarkdownCodeBlock.vue`

**Interfaces:**
- Consumes: Task 1 的 `ShikiCodeBlock` 默认导出（props `node`/`isDark`，emit `copy`）
- Produces: `"chat-message"` 与 `"document-view"` 两个 custom-id 的 `code_block` 均指向 `ShikiCodeBlock`

- [ ] **Step 1: 确认旧组件无其他引用**

Run: `cd F:\github\Astrbot\.worktrees\feat-chat-code-block-shiki\dashboard && pnpm exec rg -l "ThemeAwareMarkdownCodeBlock" src`
Expected: 仅 `src/components/chat/chatMarkdownComponents.ts`（若出现其他文件，先汇报再处理）。

- [ ] **Step 2: 修改 `chatMarkdownComponents.ts`**

完整替换为：

```typescript
import { setCustomComponents } from "markstream-vue";
import "markstream-vue/index.css";
import HtmlGenUiNode from "@/components/chat/message_list_comps/HtmlGenUiNode.vue";
import RefNode from "@/components/chat/message_list_comps/RefNode.vue";
import ThreadNode from "@/components/chat/message_list_comps/ThreadNode.vue";
import ShikiCodeBlock from "@/components/shared/ShikiCodeBlock.vue";

export const CHAT_MARKDOWN_CUSTOM_TAGS: string[] = ["ref", "html-genui"];

export function registerChatMarkdownComponents() {
  setCustomComponents("chat-message", {
    ref: RefNode,
    thread: ThreadNode,
    "html-genui": HtmlGenUiNode,
    code_block: ShikiCodeBlock,
  });
}

/**
 * 2026-07-31 shiki-code-block: MarkdownView (custom-id "document-view")
 * renders markdown for the document manager / workspace preview and the
 * readme dialog. Register the same lightweight code block so those views
 * get highlighting too; setCustomComponents is idempotent per custom-id,
 * so calling this from every MarkdownView setup is safe.
 */
export function registerDocumentViewMarkdownComponents() {
  setCustomComponents("document-view", {
    code_block: ShikiCodeBlock,
  });
}
```

- [ ] **Step 3: 修改 `MarkdownView.vue`**

在 `<script setup>` 的 import 区追加：

```typescript
import { registerDocumentViewMarkdownComponents } from "@/components/chat/chatMarkdownComponents";
```

在 `const theme = useTheme();` 之前追加：

```typescript
// Registers ShikiCodeBlock for the "document-view" custom-id (see
// chatMarkdownComponents.ts); idempotent across multiple mounts.
registerDocumentViewMarkdownComponents();
```

- [ ] **Step 4: 删除旧组件**

```bash
cd /d F:\github\Astrbot\.worktrees\feat-chat-code-block-shiki
git rm dashboard/src/components/shared/ThemeAwareMarkdownCodeBlock.vue
```

- [ ] **Step 5: 验证**

Run: `cd F:\github\Astrbot\.worktrees\feat-chat-code-block-shiki\dashboard && pnpm typecheck && pnpm vitest run src/components/shared src/components/chat/message_list_comps/binary_preview`
Expected: typecheck 退出码 0；测试全部 PASS。

- [ ] **Step 6: Commit**

```bash
cd /d F:\github\Astrbot\.worktrees\feat-chat-code-block-shiki
git add -A dashboard/src
git commit -m "feat(dashboard): route markdown code blocks to ShikiCodeBlock, drop Monaco wrapper"
```

---

### Task 3: 端到端验证（手动，交付用户）

- [ ] **Step 1: 启动**

`uv run main.py` + `cd dashboard && pnpm dev`。

- [ ] **Step 2: 验收清单（对应 spec §7）**

1. 聊天消息代码块：背景/边框/语言标签/复制按钮/shiki 高亮
2. 文档管理渲染 .md：同上（document-view 注册生效）
3. **深色 + 文档管理全屏**：代码块清晰可见（原 bug 回归）
4. 深/浅主题切换：代码块主题即时跟随
5. ` ```diff ` 块仍渲染 DiffPreview
6. 流式回复：代码块先纯文本、完成后高亮
7. 复制按钮：点击后剪贴板有内容、图标变对勾 1s

---

## Self-Review 记录

- **Spec 覆盖**：spec §4 组件→Task 1；§5 注册/清理→Task 2；§6 测试→Task 1 Step 1；§7 验收→Task 3。✅
- **Placeholder 扫描**：无 TBD；组件与测试代码完整。✅
- **类型一致性**：`ShikiCodeBlock` props/emits（Task 1 Produces）与注册用法（Task 2）一致；`DiffPreview` props 与 ThemeAwareMarkdownCodeBlock 既有用法一致（`content`/`is-dark`/`max-lines`）；`renderShikiCode(highlighter, code, language, colorMode)` 签名与 `@/utils/shiki.js` 一致。✅
