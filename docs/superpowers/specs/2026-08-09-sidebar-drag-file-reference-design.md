# Sidebar 拖拽文件改为"引用"（File Reference）设计

Author: elecvoid243, 2026-08-09
Status: approved (3 decisions confirmed interactively, see §6)

## 1. 背景与目标

GitDiffSidebar 的两个文件浏览子页（工作区 `FileBrowserView`、文档管理
`DocumentManager` → `DocumentTreePanel`）共享同一个列表组件
`FileBrowserEntryList.vue`。目前把文件拖入 ChatInput 会走"快捷上传"：
fetch 文件内容 → 包成 `File` → `uploadStagedFile`（见
`useMediaHandling.processAndUploadFileFromPath`）。

本次修改：拖拽不再上传，而是**引用**——把文件的绝对路径作为一条附加信息
拼接到用户消息末尾，让 Agent 自行用文件工具阅读。动机：避免大文件/二进制
内容被前端搬运，路径即契约，Agent 可按需读取。

参考实现：行内评论（`useFileComments` + `formatForLLM` +
`parseFileReviewComments` + `UserPlainMessagePart` 卡片渲染）。本设计
与该功能逐项同构。

## 2. 已确认决策（交互确认）

| # | 决策点 | 结论 |
|---|--------|------|
| D1 | 引用在发送前的呈现 | **引用列表 + 发送时拼接**（同行内评论），不直接插入 draft，不立即发送 |
| D2 | 消息气泡渲染 | **解析为引用卡片**（同 `[File review comments]` 的处理方式） |
| D3 | 发送后引用列表 | **发送后清空**（同 stagedFiles，不同于评论的发送后保留） |

默认项（提出时未反对）：OS 原生文件拖入保持上传行为不变；目录仍不可拖
（`canDragEntry` 判定不变）；`StandaloneChat.vue` 无 sidebar，不改动。

## 3. 引用块格式（LLM-facing）

发送时拼接到用户正文之后（空行分隔），存储进消息历史，格式固定为：

```
[Referenced files]
The user referenced the following file(s) by absolute path. Read them yourself with your file tools before answering.
- `D:\AstrbotWorkSpace\foo.py`
- `F:\github\Astrbot\README.md`
```

- 首行 `[Referenced files]` 为块标记（parser 据此识别，同
  `[File review comments]` 的角色）。
- 第 2 行为给 LLM 的固定说明（parser 忽略）。
- 之后每行一个 `- \`<绝对路径>\``。
- 该块只出现在消息**末尾**；`formatForLLM()` 保证此输出，
  `parseFileReferences.ts` 按此语法解析，二者 byte-for-byte 对齐
  （测试镜像 `parseFileReviewComments.spec.ts` 的做法）。

## 4. 组件设计

### 4.1 新增 `dashboard/src/composables/useFileReferences.ts`

模块级单例（镜像 `useFileComments` 的共享状态模式，ChatInput 直接引用，
无需 prop）。

```ts
export interface FileReference {
  id: string;    // UUID
  path: string;  // 绝对路径，去重键
  name: string;  // basename，chip 显示用
}
```

API：
- `references`（响应式，插入序）、`totalCount: ComputedRef<number>`
- `addReference(path, name)` — 按 `path` 去重，重复拖入为 no-op
- `removeReference(id)`
- `clearAll()` — 发送成功后调用（D3）
- `resetForSession()` — 会话切换时调用（= clearAll，命名与评论对齐，
  调用点在 Chat.vue 的 `watch(currSessionId)`）
- `formatForLLM(): string` — 空列表返回 `""`，否则输出 §3 的块

### 4.2 修改 `ChatInput.vue`

- `const fileReferences = useFileReferences();`（同 fileComments 的引入方式）
- 输入区新增**引用 chip 行**：每个引用一个 chip（`mdi-file-outline` 图标 +
  `name` + ✕ 单删按钮），位于评论计数 chip 附近；`totalCount === 0` 时不渲染。
  不做"全部清除"按钮（引用数量少，YAGNI）。
- `handleDrop` 的 sidebar 分支：改发 `emit("fileReferenceDrop", { path, name })`
  （emit 重命名，语义即契约；`filePathDrop` 删除）。
- 拖拽遮罩文案分流：新增 `dragKind: Ref<"upload" | "reference" | null>`，
  `handleDragOver` 中按 `dataTransfer.types` 判定——含 `SIDEBAR_FILE_MIME`
  且不含 `"Files"` → reference（显示新 i18n key `input.dropToReference`）；
  含 `"Files"` → upload（维持 `input.dropToUpload`）。`handleDragLeave` /
  `handleDrop` 复位。
- `SIDEBAR_FILE_MIME` 常量与优先判定逻辑不变。

### 4.3 修改 `Chat.vue`

- `handleSidebarFileDrop` 改为调用
  `fileReferences.addReference(payload.path, payload.name)`；
  删除 toast 与上传相关逻辑；模板中 `@file-path-drop` 改为
  `@file-reference-drop`。
- `sendCurrentMessage`：
  - 发送守卫追加 `fileReferences.totalCount.value === 0` 条件
    （允许"只发引用不发正文"，同评论）；
  - `const referenceText = fileReferences.formatForLLM();`
    `const text = [userText, commentText, referenceText].filter(Boolean).join("\n\n");`
  - 发送成功后（`createLocalExchange` 之后，与 `clearStaged` 同区域）
    调用 `fileReferences.clearAll()`（D3）。
- `watch(currSessionId)` 中追加 `fileReferences.resetForSession()`。
- 移除 `processAndUploadFileFromPath` 的导入。

### 4.4 清理 `useMediaHandling.ts`

删除 `processAndUploadFileFromPath`（唯一消费者是 Chat.vue 的 drop 处理器，
改造后成为死代码；KISS）。`FileBrowserFilePayload` 类型若无其他使用者一并
删除。

### 4.5 消息气泡渲染

- 新增 `dashboard/src/utils/parseFileReferences.ts`：从用户消息文本末尾
  解析 §3 的块，返回 `{ textBefore, references: string[] } | null`
  （null = 无块，原样渲染）。语法与 `formatForLLM` 严格对齐。
- 新增 `dashboard/src/utils/parseFileReferences.spec.ts`：镜像
  `parseFileReviewComments.spec.ts` 的样例构造方式，覆盖：无块、仅块、
  正文+块、多个引用、块不在末尾（不解析）、路径含特殊字符（反引号外
  任意字符原样保留）。
- 新增 `dashboard/src/components/chat/message_list_comps/FileReferencesCard.vue`：
  纯展示组件，列出引用文件（图标 + basename + 完整路径副行）。
- 修改 `UserPlainMessagePart.vue`：在现有 `[File review comments]` 解析
  之后追加引用块解析；命中则正文渲染 `textBefore`，下方挂
  `FileReferencesCard`。两块可共存（先评论块后引用块，与发送拼接顺序
  一致）。

### 4.6 拖拽源 `FileBrowserEntryList.vue`

拖拽载荷（`{ path, name, size }` + `text/plain` 兜底）与 `canDragEntry`
判定**不变**，仅更新指向"上传管线"的注释为"引用管线"。

### 4.7 i18n

`features/chat` 模块 en/zh 新增：
- `input.dropToReference`（拖拽遮罩）
- 引用 chip 的 aria-label / tooltip（键名镜像 comment chip 的命名风格）

## 5. 测试

- `parseFileReferences.spec.ts`（新，见 §4.5）。
- 现有 `parseFileReviewComments.spec.ts` 不受影响（评论块格式不变）。
- 手测路径：工作区 tab 拖文件 → chip 出现 → 发送 → 气泡渲染卡片 →
  chip 清空（D3）；文档管理 tab 同路径；原生文件拖入仍上传；重复拖同一
  文件 chip 不增加；会话切换后引用清空。

## 6. 非目标（YAGNI）

- 目录拖拽引用（`canDragEntry` 不变）。
- 引用 chip 的"全部清除"按钮与预览弹窗（评论的 dialog 是因为评论有正文
  需要审阅，引用只有路径，chip 已完整展示）。
- 后端改动：无（块原样进历史，前端解析渲染）。
- `StandaloneChat.vue` 改动（无 sidebar 拖拽源）。
