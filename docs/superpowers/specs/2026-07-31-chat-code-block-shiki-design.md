# 聊天/文档 Markdown 代码块美化（ShikiCodeBlock）— 设计文档

| 项目 | 内容 |
|------|------|
| 作者 | elecvoid243 |
| 日期 | 2026-07-31 |
| 状态 | 已批准（用户确认，功能范围 A：标准型） |
| 范围 | dashboard 前端（无后端改动） |
| 关联 | 调研报告（2026-07-31 会话）：markstream-vue 代码块根因分析 |

## 1. 背景与问题

markstream-vue 的代码块组件 `CodeBlockNode` 依赖 **optional peer dependency `stream-monaco`**（每个代码块挂载一个 Monaco Editor 实例）。本项目未安装该依赖，加载静默失败后降级为 `PreCodeNode`——一个无背景、无边框、无语法高亮、无字体颜色规则的裸 `<pre class="markstream-pre">`。由此产生两个线上问题：

1. **浅色模式**：代码块无背景、无高亮、字体为浏览器默认 monospace（用户截图确认）。
2. **深色 + 文档管理全屏**：全屏通过 `Teleport to="body"` 实现，teleported 后的 DOM 脱离 `.v-application`（Vuetify 文本颜色 Provider），裸 `<pre>` 无自身颜色规则，回落到浏览器默认黑色文字；全屏背景为深色 → 黑字深底，完全不可见。

## 2. 方案选型结论（已批准）

**不安装 stream-monaco**（每代码块一个 Monaco 实例，聊天长消息内存/性能不可接受，包体 +3~5MB，beta 依赖）。

**采用 markstream-vue 官方 `setCustomComponents` 机制**，注册自研轻量代码块组件 `ShikiCodeBlock`：

- 高亮：复用 `@/utils/shiki.js`（shiki 已在依赖，`github-light`/`github-dark` 双主题、语言白名单归一化、失败降级纯文本）
- 样式自包含：所有颜色来自组件自身 CSS，不依赖祖先继承 → 深色全屏问题随之根除

## 3. 用户决策记录

| 决策点 | 结论 |
|--------|------|
| 修复路线 | 方案 B（自研 shiki 代码块组件），不装 stream-monaco、不纯 CSS 补丁 |
| 功能范围 | A 标准型：高亮 + 主题容器 + 顶部条（语言标签 + 复制按钮）；不做行号 |
| 注册范围 | `"chat-message"`（聊天气泡，含 threaded）+ `"document-view"`（MarkdownView：文档管理/工作区渲染视图、ReadmeDialog） |
| diff 处理 | `lang === "diff"` 继续特判渲染现有 `DiffPreview`（沿用 ThemeAwareMarkdownCodeBlock 行为） |
| 旧组件 | 删除 `ThemeAwareMarkdownCodeBlock.vue`（被完全替代）；`MessageListDEPRECATED.vue` 已废弃不动 |

## 4. 组件设计

**文件**：`dashboard/src/components/shared/ShikiCodeBlock.vue`（新增，约 180 行）

### 4.1 Props / Emits（对齐 markstream custom component 契约）

```ts
const props = defineProps<{
  /** markstream code_block 节点：取 lang / code / loading。 */
  node: Record<string, unknown>;
  /** 由 MarkdownRender 透传；缺省 inject("isDark")，再缺省 false。 */
  isDark?: boolean;
}>();
const emit = defineEmits<{ copy: [payload: string] }>();
```

### 4.2 结构

```
┌──────────────────────────────────────┐
│ {lang 标签}                [复制按钮] │  ← 顶部条：muted 背景、12px 灰字
├──────────────────────────────────────┤
│ <div v-html="highlightedHtml" />     │  ← shiki HTML；highlighter 未就绪
│   或 <pre>escapeHtml(code)</pre>     │     或流式 loading 时显示纯文本
└──────────────────────────────────────┘
```

### 4.3 行为

1. **diff 特判**：`lang === "diff"` 时渲染 `<DiffPreview :content="code" :is-dark="effectiveIsDark" :max-lines="30" />`（与 ThemeAwareMarkdownCodeBlock 一致）。
2. **高亮计算**：`getShikiHighlighter()` 单例就绪后，`renderShikiCode(highlighter, code, lang, effectiveIsDark ? "dark" : "light")`。`watch([code, effectiveIsDark, loading])` 重算。
3. **流式策略**：`node.loading === true` 或 highlighter 未就绪 → 显示 `escapeHtml` 纯文本 `<pre>`（等宽字体）；`loading` 转 false 后立即高亮一次。避免流式期间每 token 重高亮。
4. **复制**：按钮调用 `copyToClipboard(code)`（`@/utils/clipboard`），成功后图标切换为对勾 1s 恢复，并 `emit("copy", code)`。
5. **语言标签**：显示 `node.lang` 原样小写文本；空/lang 缺失显示 `text`。

### 4.4 样式（自包含，深色全屏免疫）

- 容器：`background: rgba(var(--v-theme-on-surface), 0.04)`；`border: 1px solid rgba(var(--v-theme-on-surface), 0.12)`；`border-radius: 6px`；上下 margin 8px。
- 顶部条：flex 两端对齐，padding `4px 8px 4px 12px`，下边框线，语言标签 `font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.6); text-transform: lowercase`。
- 代码区：padding 12px；`font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`；`font-size: 12.5px; line-height: 1.55`；横向 overflow auto；shiki `<pre>` 背景置 transparent（用容器背景统一双主题观感）。
- 纯文本降级分支同字体同配色。

## 5. 注册与清理

| 文件 | 改动 |
|------|------|
| `dashboard/src/components/chat/chatMarkdownComponents.ts` | `code_block: ThemeAwareMarkdownCodeBlock` → `code_block: ShikiCodeBlock`；新增导出 `registerDocumentViewMarkdownComponents()`（内部 `setCustomComponents("document-view", { code_block: ShikiCodeBlock })`） |
| `dashboard/src/components/shared/MarkdownView.vue` | setup 中调用一次 `registerDocumentViewMarkdownComponents()`（`setCustomComponents` 幂等，重复调用覆盖同一 id 无副作用） |
| `dashboard/src/components/shared/ThemeAwareMarkdownCodeBlock.vue` | **删除**（其 diff 特判行为已并入 ShikiCodeBlock；聊天注册点同步切换） |

`InteractiveChoiceProse.vue` 使用动态 custom-id，不注册（其场景为选项卡片短文，代码块罕见，保持库默认渲染）。

## 6. 测试

新建 `dashboard/src/components/shared/ShikiCodeBlock.spec.ts`，mock `@/utils/shiki.js`（`getShikiHighlighter` / `renderShikiCode` / `escapeHtml` 用真实实现）：

1. 普通语言（`lang: "vue"`）→ 调用 `renderShikiCode` 并 `v-html` 渲染返回值
2. `lang: "diff"` → 渲染 DiffPreview stub，不调用 renderShikiCode
3. `loading: true` → 显示纯文本 pre，不调用 renderShikiCode；`loading` 转 false → 触发高亮
4. `isDark` prop 变化 → 以对应 colorMode 重算
5. 点击复制按钮 → `copyToClipboard` 被调用且 emit `copy`

## 7. 验收标准

1. 聊天消息中的代码块：有背景/边框/圆角、语言标签、复制按钮、shiki 语法高亮
2. 文档管理渲染 .md：代码块同上（`"document-view"` 注册生效）
3. **深色 + 文档管理全屏**：代码块文字清晰可见（回归原 bug 场景）
4. 深色/浅色主题切换：代码块主题即时跟随
5. ` ```diff ` 代码块仍渲染 DiffPreview
6. 流式回复中代码块先纯文本、完成后高亮
7. `pnpm vitest run` 相关 spec 全绿；`vue-tsc --noEmit` 通过

## 8. 非目标（YAGNI）

- 行号显示、代码块折叠/展开、字体大小调节（Monaco 壳的附带功能，不做）
- `InteractiveChoiceProse` 动态 custom-id 注册
- 修改 markstream-vue 库本身或升级其版本
- `MessageListDEPRECATED.vue` 的任何改动
