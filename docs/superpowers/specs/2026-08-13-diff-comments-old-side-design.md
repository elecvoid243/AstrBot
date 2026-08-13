# Diff 删除行评论（Old-Side Comments）设计

- **Author**: elecvoid243
- **Date**: 2026-08-13
- **Status**: Approved（brainstorming 确认）
- **仓库**: `F:\github\Astrbot`（dashboard 前端）

## 1. 背景与目标

Git 变更页的 DiffPreview 每行左侧有 "+" 入口用于对该 diff 行发表评论。
目前评论只能锚定**新增侧（new）**：add/ctx 行可评论，del 行（无 newNo）不出现入口。
本次让**统一 / 分栏两种视图的删除行都支持评论**。

**LLM 侧契约**（用户确认）：diff 评论发给 LLM 的内容 = 文件路径 + diff hunk 全文 +
`>` 标记的锚点行 + 评论文字。

## 2. 关键决策（brainstorming 确认）

| # | 决策 |
|---|------|
| Q1 | **方案 B**：del 行评论**不重建旧文件内容**，只依赖 diffHunk 快照 |
| Q2 | `lineContent` = hunk 内该 del 行内容（编辑回显可见原文）；`contextBefore/After` = null |
| Q3 | 分栏模式：del-only 行（右单元格空）在**左单元格**渲染 gutter（old 侧）；modified/ctx 行维持仅 new 侧 |
| Q4 | LLM 渲染：`>` 锚点按侧匹配（new→newNo，old→oldNo） |

## 3. 数据模型（`useFileComments.ts`）

### 3.1 `FileComment` 增加侧标记

```ts
/** 2026-08-13: which side of the diff the comment anchors to.
 *  "new" (default) = post-change line (add/ctx lines);
 *  "old" = pre-change line (del lines). File-browser comments
 *  leave it undefined (= "new"). */
side?: "new" | "old";
```

### 3.2 `DiffHunkContext` 扩展

- 保留 `newLine`（既有 new 侧评论存储兼容）；类型放宽为 `number | null`（old 侧填 null）。
- 新增 `side: "new" | "old"`（必填，旧数据在读取时按缺省 "new" 处理）。
- 新增 `oldLine: number | null`（old 侧评论的锚点行号）。

### 3.3 `addCommentWithContext` 增加可选 `side` 参数

透传写入 `FileComment.side`；缺省不写（= "new"）。
文件浏览器路径（`addComment` / `addSelectionComment`）不传，完全不受影响。

### 3.4 `renderHunkGroup`（LLM 输出）双侧锚定

- 锚点集合按侧收集：new 侧 → `Set<newNo>`；old 侧 → `Set<oldNo>`。
- `>` 标记：`line.newNo ∈ newAnchors || line.oldNo ∈ oldAnchors`（del 行首次可标记）。
- Comments 列表：old 侧显示 `line {n} (old)`，new 侧保持 `line {n}`。

## 4. DiffPreview 交互（`DiffPreview.vue`）

### 4.1 悬停状态

- **统一视图**：新增 `hoveredUnifiedSide: "new" | "old"` ref；
  `onUnifiedRowEnter` 移除 `if (!line.newNo) return` 拦截——
  del 行 → `side="old", line=oldNo`；add/ctx 行 → `side="new", line=newNo`。
  `onUnifiedRowLeave` 同时清 side。
- **分栏视图**：`onSplitRowEnter` 移除 del-only 拦截（`row.left?.oldNo` 存在即可）；
  gutter 位于左/右单元格天然决定侧，无需 side 状态。

### 4.2 模板（gutter 渲染）

- **统一**：del 行 gutter 同样渲染——
  hover 且 `commentsByOldLine` 无该 oldNo → `+` 按钮（`openNewEditor(oldNo, "old")`）；
  已有评论 → 指示器（`openEditEditor(id)`）。
- **分栏**：del-only 行（`row.right` 为空）在左单元格渲染 gutter（old 侧）；
  modified / ctx 行维持现状（仅右 = new 侧），避免同一行双侧双 gutter。

### 4.3 评论索引

新增 `commentsByOldLine = computed<Map<number, FileComment>>`：
仅索引 `side === "old"` 的评论，key = `oldNo`（= `FileComment.line`）。
`commentsByNewLine` 仅索引 `side !== "old"`（= "new"/缺省）的评论，语义收紧。

### 4.4 打开编辑器

`openNewEditor(line: number, side: "new" | "old")`：
- new 侧：现状（`extractLineContext(newFileContent, line)`）。
- old 侧：context = `{ lineContent: 该 del 行内容, contextBefore: null, contextAfter: null }`；
  `findHunkForLine(line, "old")`；`buildDiffHunkContext(hunk, line, "old")`（side="old", oldLine=line, newLine=null）。
- 新增 `activeEditSide` ref。

`findHunkForLine(line, side)`：
- new 侧：现状（hunk header `+(\d+)` 起点 + ctx+add 计数）。
- old 侧：hunk header `-(\d+)` 起点 + ctx+del 计数。

### 4.5 提交与编辑

- `onSaveComment`：`addCommentWithContext({..., side: activeEditSide})`；
  行内容取 `editorContext.lineContent`（old 侧已由 4.4 填 del 行内容）。
- `openEditEditor`：从 `existing.side`（缺省 "new"）恢复 `activeEditSide`。

### 4.6 `FileCommentEditor.vue`

新增可选 prop `side?: "new" | "old"`；标题 `L{n}` 追加「(old)」后缀。

## 5. i18n

三语言新增 `spcodeProjectLoad.fileBrowser.comment.oldSideLabel`：
zh「(旧)」/ en「(old)」/ ru「(старый)」。

## 6. 测试

- `DiffPreview.spec.ts` 增补：
  1. unified 模式 del 行 hover 出现 `+` 按钮；
  2. split 模式 del-only 行左单元格出现 `+` 按钮；
  3. 点击 del 行 `+` → `addCommentWithContext` 收到 `side: "old"`（通过 spy / 提交 payload 断言）；
  4. del 行已有 old 侧评论 → 指示器渲染；
  5. 编辑已有 old 侧评论 → 编辑器标题带 (old)。
- `useFileComments` 增补（新建 `useFileComments.spec.ts`）：
  1. `addCommentWithContext({side: "old", diffHunk: {side: "old", oldLine}})` 存储正确；
  2. `formatForLLM`：old 侧评论的 hunk 渲染中，del 行带 `>` 标记；
  3. new 侧评论渲染不变（回归）。

## 7. 向后兼容

- 既有存储的 diff 评论（无 side 字段）按 "new" 处理，渲染行为不变。
- 文件浏览器评论路径零改动。
- `DiffHunkContext.newLine` 类型放宽不破坏既有读路径。
