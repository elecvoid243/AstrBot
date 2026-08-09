# Sidebar 拖拽文件改为"引用" 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 GitDiffSidebar 文件列表拖入 ChatInput 的行为从"快捷上传"改为"引用"——发送时把文件绝对路径拼接到用户消息末尾，Agent 自行阅读。

**Architecture:** 与行内评论（`useFileComments`）逐项同构：模块级单例 composable 持有引用列表 → ChatInput 渲染引用 chip 行 → Chat.vue 发送时拼接 `[Referenced files]` 块并清空 → `UserPlainMessagePart` 从历史文本解析该块并渲染 `FileReferencesCard`。无后端改动。

**Tech Stack:** Vue 3 `<script setup>` + Vuetify 3 主题 token + vitest。

**Spec:** `docs/superpowers/specs/2026-08-09-sidebar-drag-file-reference-design.md`（决策 D1/D2/D3 见 spec §2）

## Global Constraints

- 仅本地提交，禁止推送远端、禁止 PR；commit message 用 conventional commits（英文）。
- 代码注释用英文（AGENTS.md 规定）；文件头标注 `Author: elecvoid243, 2026-08-09`。
- 不改动：OS 原生文件拖入上传、`FileBrowserEntryList.vue` 的 `canDragEntry` 判定与拖拽载荷、`StandaloneChat.vue`。
- i18n 三个 locale 全改：`en-US` / `zh-CN` / `ru-RU`（`dashboard/src/i18n/locales/<locale>/features/chat.json`）。
- 引用块格式（`formatForLLM` 输出 = parser 输入，byte-for-byte 对齐）：

  ```
  [Referenced files]
  The user referenced the following file(s) by absolute path. Read them yourself with your file tools before answering.
  - `<绝对路径>`
  ```

- 验证命令（工作目录 `F:\github\Astrbot\dashboard`）：单测 `pnpm test`；类型检查 `pnpm typecheck`。

---

### Task 1: useFileReferences composable + 单测

**Files:**
- Create: `dashboard/src/composables/useFileReferences.ts`
- Test: `dashboard/src/composables/useFileReferences.spec.ts`

**Interfaces:**
- Produces（后续任务依赖）:
  - `useFileReferences()` → 模块级单例，返回 `{ references, totalCount, addReference, removeReference, clearAll, resetForSession, formatForLLM }`
  - `FileReference { id: string; path: string; name: string }`
  - `references: FileReference[]`（reactive 数组，模板直接 v-for）
  - `totalCount: ComputedRef<number>`（模板中用 `fileReferences.totalCount.value`，与 fileComments 一致）
  - `addReference(path: string, name: string): FileReference | null`（path 去重；空参返回 null）
  - `formatForLLM(): string`（空列表返回 `""`）

- [ ] **Step 1: 写失败测试** `dashboard/src/composables/useFileReferences.spec.ts`

```ts
// Author: elecvoid243, 2026-08-09
// Spec: docs/superpowers/specs/2026-08-09-sidebar-drag-file-reference-design.md §4.1
// Store semantics + the exact LLM-facing block format. The block shape
// asserted here is the contract that utils/parseFileReferences.ts parses
// back out of stored history — if one changes, the other must too.
import { describe, expect, it } from "vitest";
import { useFileReferences } from "@/composables/useFileReferences";

describe("useFileReferences", () => {
  it("adds, dedupes by path, removes, and clears references", () => {
    const store = useFileReferences();
    store.clearAll();
    const first = store.addReference("D:\\a\\foo.py", "foo.py");
    const dup = store.addReference("D:\\a\\foo.py", "foo.py");
    store.addReference("D:\\a\\bar.md", "bar.md");
    expect(store.totalCount.value).toBe(2);
    expect(dup?.id).toBe(first?.id);
    store.removeReference(first!.id);
    expect(store.totalCount.value).toBe(1);
    expect(store.references[0].path).toBe("D:\\a\\bar.md");
    store.clearAll();
    expect(store.totalCount.value).toBe(0);
  });

  it("addReference rejects empty path or name", () => {
    const store = useFileReferences();
    store.clearAll();
    expect(store.addReference("", "x")).toBeNull();
    expect(store.addReference("p", "")).toBeNull();
    expect(store.totalCount.value).toBe(0);
  });

  it("formatForLLM returns empty string when no references", () => {
    const store = useFileReferences();
    store.clearAll();
    expect(store.formatForLLM()).toBe("");
  });

  it("formatForLLM emits the exact LLM-facing block", () => {
    const store = useFileReferences();
    store.clearAll();
    store.addReference("D:\\a\\foo.py", "foo.py");
    store.addReference("/home/user/notes.md", "notes.md");
    expect(store.formatForLLM()).toBe(
      [
        "[Referenced files]",
        "The user referenced the following file(s) by absolute path. Read them yourself with your file tools before answering.",
        "- `D:\\a\\foo.py`",
        "- `/home/user/notes.md`",
      ].join("\n"),
    );
  });

  it("resetForSession clears all references", () => {
    const store = useFileReferences();
    store.clearAll();
    store.addReference("D:\\a\\foo.py", "foo.py");
    store.resetForSession();
    expect(store.totalCount.value).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd F:\github\Astrbot\dashboard; pnpm vitest run src/composables/useFileReferences.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** `dashboard/src/composables/useFileReferences.ts`

```ts
// Author: elecvoid243, 2026-08-09
// Spec: docs/superpowers/specs/2026-08-09-sidebar-drag-file-reference-design.md §4.1
//
// In-memory store for sidebar-drag file references. A reference is just
// an absolute path + basename: at send time Chat.vue appends
// formatForLLM()'s "[Referenced files]" block to the outgoing message so
// the agent reads the files itself — nothing is uploaded.
//
// Module-level singleton (same rationale as useFileComments): ChatInput
// (chip row) and Chat.vue (send path) live in the same tree but are
// separate components; a singleton avoids prop drilling without Pinia.
import { computed, reactive } from "vue";

export interface FileReference {
  /** UUID, stable until removal. */
  id: string;
  /** Absolute path. Dedup key. */
  path: string;
  /** Basename shown on the chip. */
  name: string;
}

let _instance: ReturnType<typeof createFileReferences> | null = null;

function createFileReferences() {
  const references = reactive<FileReference[]>([]);
  const totalCount = computed(() => references.length);

  function newId(): string {
    return (
      (globalThis.crypto?.randomUUID?.() as string | undefined) ??
      `${Date.now()}-${Math.random()}`
    );
  }

  /** Add a reference; deduped by absolute path (repeat drags are no-ops
   *  returning the existing entry). Returns null for empty input. */
  function addReference(path: string, name: string): FileReference | null {
    if (!path || !name) return null;
    const existing = references.find((r) => r.path === path);
    if (existing) return existing;
    const entry: FileReference = { id: newId(), path, name };
    references.push(entry);
    return entry;
  }

  function removeReference(id: string): void {
    const idx = references.findIndex((r) => r.id === id);
    if (idx >= 0) references.splice(idx, 1);
  }

  /** Clear everything. Called by Chat.vue after a successful send (spec
   *  decision D3: references are per-message attachments). */
  function clearAll(): void {
    references.splice(0, references.length);
  }

  /** Session-switch hook, named for parity with
   *  useFileComments.resetForSession. */
  function resetForSession(): void {
    clearAll();
  }

  /** Render the LLM-facing block appended to the outgoing user message.
   *  Returns "" when there are no references. The output shape is the
   *  contract parsed back by utils/parseFileReferences.ts — keep the two
   *  byte-for-byte aligned. */
  function formatForLLM(): string {
    if (references.length === 0) return "";
    const lines = [
      "[Referenced files]",
      "The user referenced the following file(s) by absolute path. Read them yourself with your file tools before answering.",
    ];
    for (const r of references) lines.push(`- \`${r.path}\``);
    return lines.join("\n");
  }

  return {
    references,
    totalCount,
    addReference,
    removeReference,
    clearAll,
    resetForSession,
    formatForLLM,
  };
}

export function useFileReferences() {
  if (!_instance) _instance = createFileReferences();
  return _instance;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd F:\github\Astrbot\dashboard; pnpm vitest run src/composables/useFileReferences.spec.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
cd F:\github\Astrbot
git add dashboard/src/composables/useFileReferences.ts dashboard/src/composables/useFileReferences.spec.ts
git commit -m "feat(chat): add useFileReferences store for sidebar drag-to-reference"
```

---

### Task 2: parseFileReferences parser + 单测

**Files:**
- Create: `dashboard/src/utils/parseFileReferences.ts`
- Test: `dashboard/src/utils/parseFileReferences.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `formatForLLM` 输出格式（Global Constraints 中的块格式）。
- Produces:
  - `parseFileReferences(raw: string): FileReferencesBlock | null`
  - `FileReferencesBlock { userText: string; paths: string[] }`
  - 消费者：Task 3 的 `UserPlainMessagePart.vue` / `FileReferencesCard.vue`。

- [ ] **Step 1: 写失败测试** `dashboard/src/utils/parseFileReferences.spec.ts`

```ts
// Author: elecvoid243, 2026-08-09
// Sample blocks mirror useFileReferences.formatForLLM byte-for-byte, so
// the fixtures below are exactly the shape the backend stores in history.
import { describe, expect, it } from "vitest";
import { parseFileReferences } from "@/utils/parseFileReferences";

const BLOCK = [
  "[Referenced files]",
  "The user referenced the following file(s) by absolute path. Read them yourself with your file tools before answering.",
  "- `D:\\AstrbotWorkSpace\\foo.py`",
  "- `/home/user/notes.md`",
].join("\n");

describe("parseFileReferences", () => {
  it("returns null when the marker is absent", () => {
    expect(parseFileReferences("just a normal message")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseFileReferences("")).toBeNull();
  });

  it("returns null when the block has no entries", () => {
    expect(parseFileReferences("[Referenced files]\nsome prose")).toBeNull();
  });

  it("parses a block-only message", () => {
    const r = parseFileReferences(BLOCK);
    expect(r).not.toBeNull();
    expect(r!.userText).toBe("");
    expect(r!.paths).toEqual([
      "D:\\AstrbotWorkSpace\\foo.py",
      "/home/user/notes.md",
    ]);
  });

  it("splits user text from the block", () => {
    const r = parseFileReferences(`please read these\n\n${BLOCK}`);
    expect(r!.userText).toBe("please read these");
    expect(r!.paths).toHaveLength(2);
  });

  it("keeps special characters in paths verbatim", () => {
    const r = parseFileReferences(
      "[Referenced files]\n- `C:\\weird dir\\my file (v2).ts`",
    );
    expect(r!.paths).toEqual(["C:\\weird dir\\my file (v2).ts"]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd F:\github\Astrbot\dashboard; pnpm vitest run src/utils/parseFileReferences.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** `dashboard/src/utils/parseFileReferences.ts`

```ts
// Author: elecvoid243, 2026-08-09
// Parser for the "[Referenced files]" block that the dashboard appends to
// outgoing user messages (see useFileReferences.formatForLLM). Same
// rationale as parseFileReviewComments.ts: the block is stored verbatim
// in the message history, so parsing it back into structured data lets
// the chat UI render a references card for BOTH freshly sent and
// historical messages — no backend change required.
//
// Grammar (byte-for-byte mirrors formatForLLM):
//   [Referenced files]     <- block marker (first line)
//   <1 prose line for LLM> <- ignored for display
//   - `<abs path>`         <- one line per reference

/** The parsed references block plus the user's free-form text before it. */
export interface FileReferencesBlock {
  userText: string;
  /** Absolute paths in send order. */
  paths: string[];
}

const BLOCK_MARKER = "[Referenced files]";
const ENTRY = /^- `(.+)`\s*$/;

/**
 * Parse a user message that may end with a "[Referenced files]" block.
 *
 * Returns `null` when the marker is absent or no entry line could be
 * parsed, so callers fall back to rendering the raw text unchanged.
 *
 * @param raw - The full plain-text content of a user message part.
 * @returns The structured block, or `null` if not present/parseable.
 */
export function parseFileReferences(raw: string): FileReferencesBlock | null {
  if (!raw) return null;
  const lines = raw.split("\n");
  const start = lines.findIndex((l) => l.trim() === BLOCK_MARKER);
  if (start < 0) return null;

  const userText = lines.slice(0, start).join("\n").trim();
  const paths: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(ENTRY);
    if (m) paths.push(m[1]);
  }
  if (paths.length === 0) return null;
  return { userText, paths };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd F:\github\Astrbot\dashboard; pnpm vitest run src/utils/parseFileReferences.spec.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
cd F:\github\Astrbot
git add dashboard/src/utils/parseFileReferences.ts dashboard/src/utils/parseFileReferences.spec.ts
git commit -m "feat(chat): add parseFileReferences for the referenced-files block"
```

---

### Task 3: FileReferencesCard + UserPlainMessagePart 集成 + card i18n

**Files:**
- Create: `dashboard/src/components/chat/message_list_comps/FileReferencesCard.vue`
- Modify: `dashboard/src/components/chat/message_list_comps/UserPlainMessagePart.vue`
- Modify: `dashboard/src/i18n/locales/en-US/features/chat.json`（`spcodeProjectLoad` 内，`fileReviewCard` 同级）
- Modify: `dashboard/src/i18n/locales/zh-CN/features/chat.json`
- Modify: `dashboard/src/i18n/locales/ru-RU/features/chat.json`

**Interfaces:**
- Consumes: Task 2 的 `parseFileReferences` / `FileReferencesBlock`。
- Produces: `UserPlainMessagePart` 新行为——引用块渲染为卡片（Task 5 发送拼接后立即生效，历史消息自动生效）。

- [ ] **Step 1: 三个 locale 添加 card 标题**

在 `spcodeProjectLoad.fileReviewCard` 闭合大括号后插入同级 key（注意 JSON 逗号）：

en-US:
```json
    "fileReferencesCard": {
      "title": "Referenced files"
    },
```
zh-CN:
```json
    "fileReferencesCard": {
      "title": "引用的文件"
    },
```
ru-RU:
```json
    "fileReferencesCard": {
      "title": "Связанные файлы"
    },
```

- [ ] **Step 2: 创建 FileReferencesCard.vue**

```vue
<!-- Author: elecvoid243, 2026-08-09
     Spec: docs/superpowers/specs/2026-08-09-sidebar-drag-file-reference-design.md §4.5
     Renders a parsed "[Referenced files]" block as a static card: header
     (icon + title + count chip) + one row per referenced file (file icon,
     basename, full path). No collapse — reference lists are short (YAGNI).
     Theme tokens only, same approach as FileReviewCommentsCard. -->
<template>
  <div class="frf">
    <div class="frf-head">
      <v-icon size="15" color="primary">mdi-file-link-outline</v-icon>
      <span class="frf-title">{{
        tm("spcodeProjectLoad.fileReferencesCard.title")
      }}</span>
      <span class="frf-chip">{{ block.paths.length }}</span>
    </div>
    <div v-for="(p, i) in block.paths" :key="i" class="frf-row">
      <v-icon size="14" class="frf-file-icon">mdi-file-outline</v-icon>
      <span class="frf-name">{{ basename(p) }}</span>
      <span class="frf-path">{{ p }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useModuleI18n } from "@/i18n/composables";
import type { FileReferencesBlock } from "@/utils/parseFileReferences";

defineProps<{ block: FileReferencesBlock }>();

const { tm } = useModuleI18n("features/chat");

/** Basename for display; handles both "/" and "\" separators. */
function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
</script>

<style scoped>
.frf {
  width: 100%;
  margin-top: 4px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-left: 3px solid rgb(var(--v-theme-primary));
  border-radius: 12px;
  overflow: hidden;
  text-align: left;
}
.frf-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 14px;
  background: rgb(var(--v-theme-mcpCardBg));
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.frf-title {
  font-size: 13px;
  font-weight: 700;
  color: rgb(var(--v-theme-on-surface));
}
.frf-chip {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
  border-radius: 99px;
  padding: 2px 9px;
  white-space: nowrap;
}
.frf-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.frf-row:last-child {
  border-bottom: 0;
}
.frf-file-icon {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.frf-name {
  flex: none;
  font-size: 12.5px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}
.frf-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
```

- [ ] **Step 3: 改写 UserPlainMessagePart.vue**（整文件替换）

```vue
<!-- Author: elecvoid243, 2026-07-30
     Updated 2026-08-09 (elecvoid243): also parse the trailing
     "[Referenced files]" block (useFileReferences.formatForLLM) and
     render it as a FileReferencesCard. Parse order mirrors the send-time
     concat in Chat.vue ([userText, commentText, referenceText]): the
     comments block comes first, so its parser's `userText` may still
     carry the references block — which is parsed out of it here.
     Historical messages get the rich rendering automatically because
     both blocks are parsed back out of the stored message text. -->
<template>
  <div class="user-plain-part">
    <template v-if="review || references">
      <div v-if="displayText" class="plain-content">
        {{ displayText }}
      </div>
      <FileReviewCommentsCard v-if="review" :review="review" />
      <FileReferencesCard v-if="references" :block="references" />
    </template>
    <div v-else class="plain-content">{{ text }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { parseFileReviewComments } from "@/utils/parseFileReviewComments";
import { parseFileReferences } from "@/utils/parseFileReferences";
import FileReviewCommentsCard from "./FileReviewCommentsCard.vue";
import FileReferencesCard from "./FileReferencesCard.vue";

const props = defineProps<{ text: string }>();

// computeds cache on props.text, so each parse runs once per text change
// rather than on every re-render of the (potentially long) message list.
const review = computed(() => parseFileReviewComments(props.text));
const references = computed(() =>
  parseFileReferences(review.value ? review.value.userText : props.text),
);
// The free-form text above the cards: when a references block was found
// it owns the trimming; otherwise the comments parser's userText (or ""
// when only a comments block exists) is what remains.
const displayText = computed(() =>
  references.value
    ? references.value.userText
    : (review.value?.userText ?? ""),
);
</script>

<style scoped>
/* Mirrors ChatMessageList's .plain-content (the parent's scoped rule does
   not reach into this child, so it is re-declared here). */
.plain-content {
  white-space: pre-wrap;
}
</style>
```

- [ ] **Step 4: 类型检查 + 回归测试**

Run: `cd F:\github\Astrbot\dashboard; pnpm typecheck; pnpm vitest run src/utils`
Expected: typecheck 无错误；`parseFileReviewComments.spec.ts` 与 `parseFileReferences.spec.ts` 全部 PASS

- [ ] **Step 5: Commit**

```bash
cd F:\github\Astrbot
git add dashboard/src/components/chat/message_list_comps/FileReferencesCard.vue dashboard/src/components/chat/message_list_comps/UserPlainMessagePart.vue dashboard/src/i18n/locales/*/features/chat.json
git commit -m "feat(chat): render referenced-files block as a card in user messages"
```

---

### Task 4: ChatInput 引用 chip 行 + 遮罩分流 + emit 重命名 + i18n

**Files:**
- Modify: `dashboard/src/components/chat/ChatInput.vue`
- Modify: `dashboard/src/components/chat/message_list_comps/FileBrowserEntryList.vue`（仅注释）
- Modify: 三个 locale 的 `features/chat.json`（`input` 节点）

**Interfaces:**
- Consumes: Task 1 的 `useFileReferences`。
- Produces: emit `fileReferenceDrop: [payload: { path: string; name: string }]`（Task 5 的 Chat.vue 监听它）；i18n key `input.dropToReference`、`input.references.removeAria`。

- [ ] **Step 1: i18n —— 三个 locale 的 `input` 节点**

en-US `input` 节点：在 `"dropToUpload"` 行后加 `"dropToReference"`，并删除 `"uploadSidebarFailed"` 行（其唯一使用者在 Task 5 移除），再在 `input` 节点内加 `references` 子节点。修改后 `input` 节点为：

```json
  "input": {
    ...
    "dropToUpload": "Drop files to upload",
    "dropToReference": "Drop to reference this file",
    "stopGenerating": "Stop generating",
    "references": {
      "removeAria": "Remove reference {name}"
    }
  },
```
（`...` 为既有 key 保持不动；`uploadSidebarFailed` 整行删除，注意逗号。）

zh-CN：
```json
    "dropToReference": "松开鼠标引用该文件",
    "references": {
      "removeAria": "移除引用 {name}"
    }
```
（同样删除 `"uploadSidebarFailed": "无法从侧边栏上传 {name}"`。）

ru-RU：
```json
    "dropToReference": "Отпустите, чтобы добавить ссылку на файл",
    "references": {
      "removeAria": "Убрать ссылку {name}"
    }
```
（同样删除 `"uploadSidebarFailed": "Не удалось загрузить {name} из боковой панели"`。）

- [ ] **Step 2: ChatInput.vue —— script 部分**

a) 在 `const fileComments = useFileComments();`（约 589 行）附近补充导入与实例：

```ts
import { useFileReferences } from "@/composables/useFileReferences";
```
```ts
// 2026-08-09 drag-reference (elecvoid243): sidebar file drops become
// references (not uploads). Same singleton pattern as fileComments —
// read directly, no prop. See useFileReferences.ts header.
const fileReferences = useFileReferences();
```

b) emits 声明中，把这段（约 556-561 行）：

```ts
  // path + the basename the user saw in the list. Parent (Chat.vue)
  // fetches the content via /spcode/file-browser and re-uses the
  // existing `uploadStagedFile` pipeline. See
  // `processAndUploadFileFromPath` in useMediaHandling.ts.
  filePathDrop: [payload: { path: string; name: string }];
```

替换为：

```ts
  // 2026-08-09 drag-reference (elecvoid243): sidebar file-browser drop.
  // The payload carries the remote absolute path + the basename the user
  // saw in the list. Parent (Chat.vue) adds a *reference* via
  // useFileReferences; paths are appended to the outgoing message text
  // at send time — nothing is uploaded.
  fileReferenceDrop: [payload: { path: string; name: string }];
```

c) `isDragging` 声明（约 579 行）后加：

```ts
/** 2026-08-09 drag-reference: which drop overlay to show. "Files" drags
 *  upload; sidebar MIME drags reference. */
const dragKind = ref<"upload" | "reference">("upload");
```

d) 替换 `handleDragOver` / `handleDrop`（约 1401-1470 行；`SIDEBAR_FILE_MIME` 常量保留，更新其注释中 "route sidebar file drops through `processAndUploadFileFromPath`" 为 "route sidebar file drops to the reference store"）：

```ts
function handleDragOver(e: DragEvent) {
  // 清除之前的 leave timeout
  if (dragLeaveTimeout) {
    clearTimeout(dragLeaveTimeout);
    dragLeaveTimeout = null;
  }

  // 显示拖拽遮罩的判定：既支持原生文件拖入（"Files" → 上传），也支持
  // sidebar 文件浏览器拖入（自定义 MIME → 引用）。两种共用一个
  // isDragging overlay，但图标与文案按 dragKind 分流。
  const types = e.dataTransfer?.types;
  if (types?.includes("Files")) {
    dragKind.value = "upload";
    isDragging.value = true;
  } else if (types?.includes(SIDEBAR_FILE_MIME)) {
    dragKind.value = "reference";
    isDragging.value = true;
  }
}
```

`handleDrop` 中 sidebar 分支改为：

```ts
  // 优先处理 sidebar 文件拖入：自定义 MIME 携带的是远端文件路径，
  // 父组件把它登记为引用（useFileReferences），发送时拼接到消息末尾。
  // 如果 dataTransfer 同时携带 Files（极少见,例如从外部桌面把同一个
  // 文件既通过路径也通过 File 拖入），优先信任自定义类型 — 它意味着
  // 这是 sidebar 的拖拽。
  const sidebarPayload = e.dataTransfer?.getData(SIDEBAR_FILE_MIME);
  if (sidebarPayload) {
    try {
      const parsed = JSON.parse(sidebarPayload) as {
        path?: unknown;
        name?: unknown;
      };
      if (typeof parsed.path === "string" && typeof parsed.name === "string") {
        emit("fileReferenceDrop", { path: parsed.path, name: parsed.name });
        return;
      }
    } catch {
      // JSON 解析失败 → 回退到原生 FileList 流程
    }
  }
```

- [ ] **Step 3: ChatInput.vue —— template 部分**

a) 遮罩（约 110-116 行）替换为：

```html
      <!-- 拖拽遮罩：原生文件拖入=上传；sidebar 拖入=引用 -->
      <transition name="fade">
        <div v-if="isDragging" class="drop-overlay">
          <div class="drop-overlay-content">
            <v-icon size="48" color="primary">{{
              dragKind === "reference"
                ? "mdi-file-link-outline"
                : "mdi-cloud-upload"
            }}</v-icon>
            <span class="drop-text">{{
              dragKind === "reference"
                ? tm("input.dropToReference")
                : tm("input.dropToUpload")
            }}</span>
          </div>
        </div>
      </transition>
```

b) 在 reply-preview 的 `</transition>`（约 135 行）之后、attachments-preview 的 `<transition name="attachments">` 之前，插入引用 chip 行：

```html
      <!-- 2026-08-09 drag-reference: staged file-reference chips. Each
           chip shows the basename (full path in the title tooltip) and
           removes itself on ✕. The block is appended to the outgoing
           message at send time and cleared on success (spec D3). -->
      <transition name="attachments">
        <div
          v-if="fileReferences.totalCount.value > 0"
          class="references-preview"
        >
          <div
            v-for="r in fileReferences.references"
            :key="r.id"
            class="reference-chip"
            :title="r.path"
          >
            <v-icon size="14" class="reference-chip__icon">
              mdi-file-outline
            </v-icon>
            <span class="reference-chip__name">{{ r.name }}</span>
            <button
              type="button"
              class="reference-chip__remove"
              :aria-label="tm('input.references.removeAria', { name: r.name })"
              @click="fileReferences.removeReference(r.id)"
            >
              <v-icon size="12">mdi-close</v-icon>
            </button>
          </div>
        </div>
      </transition>
```

- [ ] **Step 4: ChatInput.vue —— style 部分**（追加到 `<style scoped>` 末尾）

```css
/* 2026-08-09 drag-reference: file-reference chips row. Reuses the
   "attachments" transition; each chip is a compact pill showing the
   basename, with the absolute path on the title tooltip. */
.references-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px 0;
}
.reference-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 220px;
  padding: 3px 6px 3px 8px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgba(var(--v-theme-primary), 0.07);
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface));
}
.reference-chip__icon {
  flex: none;
  color: rgb(var(--v-theme-primary));
}
.reference-chip__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reference-chip__remove {
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 1px;
  border-radius: 50%;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.reference-chip__remove:hover {
  color: rgb(var(--v-theme-error));
}
```

- [ ] **Step 5: FileBrowserEntryList.vue 注释更新**

约 233-249 行的注释块中，"route them to the same upload pipeline (`uploadStagedFile` via `useMediaHandling.processAndUploadFileFromPath`)" 改为 "register them as file *references* (`useFileReferences`) whose paths are appended to the outgoing message at send time — no upload"。`canDragEntry`、拖拽载荷、`text/plain` 兜底均不动。

- [ ] **Step 6: 验证**

Run: `cd F:\github\Astrbot\dashboard; pnpm typecheck`
Expected: 无错误（此时 Chat.vue 仍监听 `@file-path-drop`，vue-tsc 会对多余监听报错属预期 → 若报错，先完成 Task 5 再一起 typecheck；或本步仅做 eslint 级检查 `pnpm lint --no-fix` 可选）

> 说明：Task 4 与 Task 5 跨文件联动（emit 重命名），typecheck 以 Task 5 完成后为准。本步容忍 `@file-path-drop` 相关报错。

- [ ] **Step 7: Commit**

```bash
cd F:\github\Astrbot
git add dashboard/src/components/chat/ChatInput.vue dashboard/src/components/chat/message_list_comps/FileBrowserEntryList.vue dashboard/src/i18n/locales/*/features/chat.json
git commit -m "feat(chat): reference chips and reference drop overlay in chat input"
```

---

### Task 5: Chat.vue 接线 + useMediaHandling 清理

**Files:**
- Modify: `dashboard/src/components/chat/Chat.vue`
- Modify: `dashboard/src/composables/useMediaHandling.ts`

**Interfaces:**
- Consumes: Task 1 `useFileReferences`；Task 4 的 `fileReferenceDrop` emit。
- Produces: 完整功能闭环；`useMediaHandling` 不再导出 `processAndUploadFileFromPath`。

- [ ] **Step 1: Chat.vue —— 引入 store**

a) 在使用 `fileComments` 的同级位置（约 1001-1004 行附近是 useMediaHandling 解构）：
- 删除 useMediaHandling 解构中的 `processAndUploadFileFromPath,` 及其上方两行注释（`// 2026-07-18 drag-to-chat ...` 共 3 行注释 + 1 行代码）。
- 在 fileComments 实例化处附近添加：

```ts
import { useFileReferences } from "@/composables/useFileReferences";
```
```ts
const fileReferences = useFileReferences();
```

b) 模板两处（约 521、727 行）`@file-path-drop="handleSidebarFileDrop"` → `@file-reference-drop="handleSidebarFileDrop"`。

- [ ] **Step 2: Chat.vue —— 替换 handleSidebarFileDrop**（约 3096-3118 行整段替换）

```ts
// 2026-08-09 drag-reference (elecvoid243): a file dropped from the
// sidebar file browser (workspace / document manager) onto the chat
// input becomes a *reference*, not an upload. The path is appended to
// the outgoing message at send time (see sendCurrentMessage) so the
// agent reads the file itself. Deduped by path inside the store, so
// repeat drags are no-ops.
function handleSidebarFileDrop(payload: { path: string; name: string }) {
  if (!payload?.path || !payload?.name) return;
  fileReferences.addReference(payload.path, payload.name);
}
```

- [ ] **Step 3: Chat.vue —— 发送守卫**（约 2354-2357 行）

把：

```ts
    !canSend.value &&
    !stagedFiles.value.length &&
    fileComments.totalCount.value === 0
```

改为：

```ts
    !canSend.value &&
    !stagedFiles.value.length &&
    fileComments.totalCount.value === 0 &&
    fileReferences.totalCount.value === 0
```

- [ ] **Step 4: Chat.vue —— 发送拼接与清空**（约 2390-2408 行区域）

把：

```ts
    const userText = draft.value.trim();
    const commentText = fileComments.formatForLLM();
    // Concatenate user text + comment block with a blank line. The
    // bot's first message will show "[File review comments]" header
    // even when userText is empty.
    const text = [userText, commentText].filter(Boolean).join("\n\n");
```

改为：

```ts
    const userText = draft.value.trim();
    const commentText = fileComments.formatForLLM();
    // 2026-08-09 drag-reference: references block goes last (after the
    // comments block) — UserPlainMessagePart parses them back in this
    // same order.
    const referenceText = fileReferences.formatForLLM();
    // Concatenate user text + comment block + references block with
    // blank lines. The bot's first message will show the block headers
    // even when userText is empty.
    const text = [userText, commentText, referenceText]
      .filter(Boolean)
      .join("\n\n");
```

在 `clearStaged({ revokeUrls: false });` 之后追加：

```ts
    // Spec D3: references are per-message attachments — clear on send,
    // unlike comments which persist until the user deletes them.
    fileReferences.clearAll();
```

- [ ] **Step 5: Chat.vue —— 会话切换重置**（约 1443-1447 行）

把：

```ts
    fileComments.resetForSession();
    inlineAnnotations.resetForSession();
```

改为：

```ts
    fileComments.resetForSession();
    fileReferences.resetForSession();
    inlineAnnotations.resetForSession();
```

- [ ] **Step 6: useMediaHandling.ts 清理**

a) 删除 `FileBrowserFilePayload` interface（约 13-26 行，含上方注释块）。
b) 删除 `processAndUploadFileFromPath` 整个函数（约 118-165 行，含其文档注释块，起始于 `* as the click path), so dropping...` 所在注释块的开头）。
c) 删除 return 对象中的：

```ts
        // 2026-07-18 drag-to-chat (elecvoid243): sidebar file-browser
        // drop upload. See helper docstring above for the full flow.
        processAndUploadFileFromPath,
```

d) 顶部 import 中移除 `pluginExtensionApi`（确认该文件内无其他使用者后）：

```ts
import { fileApi } from '@/api/v1';
```

- [ ] **Step 7: 全量验证**

Run: `cd F:\github\Astrbot\dashboard; pnpm typecheck; pnpm test`
Expected: typecheck 无错误；全部 vitest PASS（含 Task 1/2 新增 11 个测试与既有 `parseFileReviewComments.spec.ts`、`BinaryPreview.spec.ts` 等）

- [ ] **Step 8: Commit**

```bash
cd F:\github\Astrbot
git add dashboard/src/components/chat/Chat.vue dashboard/src/composables/useMediaHandling.ts
git commit -m "feat(chat): wire sidebar file drops to references and remove upload-on-drop"
```

---

### Task 6: 端到端验证

**Files:** 无（仅验证）

- [ ] **Step 1: 全量测试 + 类型 + 构建**

Run: `cd F:\github\Astrbot\dashboard; pnpm test; pnpm build`
Expected: 测试全 PASS；`vue-tsc --noEmit && vite build` 成功

- [ ] **Step 2: 手测清单**（`pnpm dev` 起前端，后端 `uv run main.py`）

1. 工作区 tab 拖一个文件到输入框 → 遮罩显示"松开鼠标引用该文件"→ 出现引用 chip。
2. 重复拖同一文件 → chip 不增加（去重）。
3. ✕ 删除 chip → 消失。
4. 输入正文 + 发送 → 气泡中正文在上、`FileReferencesCard` 在下 → chip 行清空（D3）。
5. 只拖文件不输入正文 → 可以发送（守卫放行），气泡只有卡片。
6. 文档管理 tab 拖文件 → 同上。
7. 从 OS 桌面拖文件到输入框 → 遮罩显示"上传"，走原上传流程。
8. 同时有评论和引用 → 发送后气泡先评论卡片后引用卡片；消息文本中 `[File review comments]` 块在 `[Referenced files]` 块之前。
9. 切换会话 → 引用 chip 清空。
10. 重新加载历史会话 → 含引用块的历史消息仍渲染为卡片。

- [ ] **Step 3: 如无问题，完结**

```bash
cd F:\github\Astrbot
git log --oneline -6
```
确认 5 个本地提交（spec + Task 1/2/3/4 + Task 5）。不推送远端。
