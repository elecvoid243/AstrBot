# `/project load` 可选子步骤前端设计

> 作者：elecvoid243
>
> 时间：2026-07-25 23:34 CST
>
> 状态：已获用户设计确认

## 1. 背景

spcode toolkit v2.21 为 `/project load` 增加了两个可选 flag：

- `no_agentsmd`：跳过 AGENTS.md 的初始化与加载。
- `no_codegraph`：跳过 Codegraph 的初始化与项目设置。

未传 flag 时，后端继续执行全部加载步骤，因此旧命令保持兼容。AstrBot Dashboard 当前的 `ProjectLoadDialog.vue` 只能指定项目路径，无法让用户通过图形界面选择是否执行这些子步骤。

## 2. 目标

在 ChatInput 的现有“加载项目目录”对话框中增加两个默认选中的正向选项：

- 加载 AGENTS.md
- 加载 Codegraph

用户取消某项后，前端在 `/project load` 命令末尾追加相应的后端跳过 flag。每次重新打开对话框时，两项均恢复为选中状态。

## 3. 非目标

本次改动不包含以下内容：

- 不修改 spcode toolkit 后端。
- 不修改 AstrBot 后端 API 或 OpenAPI schema。
- 不展示 `/spcode/project-status` 新增的 `skipped_substeps` 字段。
- 不改变 `sp-status-badge` 的状态、颜色或 tooltip。
- 不持久化用户上一次的勾选状态。
- 不修改 Codegraph 专用的“设置 Codegraph 项目”流程。
- 不修复与本功能无关的既有 Dashboard 测试失败。

## 4. 用户界面

沿用现有 `ProjectLoadDialog.vue`，不创建新的业务组件。

当 `commandMode === "project"` 时，在项目路径输入框下、最近路径列表前增加“加载步骤”区域。区域内使用两个紧凑的 `v-checkbox`：

1. “加载 AGENTS.md”
2. “加载 Codegraph”

两个 checkbox 默认均选中。用户可以取消任意一项，也可以同时取消两项。现有路径输入、路径历史、卸载按钮、取消按钮和加载按钮保持不变。

当 `commandMode === "codegraph"` 时，不渲染“加载步骤”区域，继续只生成 `/codegraph set <path>` 命令。

## 5. 状态与生命周期

`ProjectLoadDialog.vue` 新增两个组件内 `ref<boolean>`：

- `loadAgentsMd`，初始值为 `true`。
- `loadCodegraph`，初始值为 `true`。

现有 `watch(dialogOpen, ...)` 在对话框打开时执行以下重置：

- 清空当前路径输入。
- 将 `loadAgentsMd` 设为 `true`。
- 将 `loadCodegraph` 设为 `true`。

因此，取消选项只影响当前一次提交，不会泄漏到下一次打开，也不会写入 `localStorage`。现有项目路径历史仍按当前逻辑持久化。

## 6. 命令生成

扩展现有 `buildLoadCommand`，让它在 project 模式下根据两个正向布尔值生成负向 flag。flag 固定放在已处理引号的路径之后，并固定按 `no_agentsmd`、`no_codegraph` 的顺序输出。

| 加载 AGENTS.md | 加载 Codegraph | 生成命令 |
|---|---|---|
| 是 | 是 | `/project load <path>` |
| 否 | 是 | `/project load <path> no_agentsmd` |
| 是 | 否 | `/project load <path> no_codegraph` |
| 否 | 否 | `/project load <path> no_agentsmd no_codegraph` |

路径含空白时，继续沿用现有双引号规则。例如：

```text
/project load "C:\projects\my app" no_codegraph
```

Codegraph 模式始终输出：

```text
/codegraph set <path>
```

该模式忽略 project 子步骤选项，且界面不会显示这些选项。

## 7. 组件与数据流

现有数据流保持不变：

```text
ProjectLoadDialog.onConfirm
  -> emit("submit", commandText)
  -> ChatInput.handleProjectLoadSubmit
  -> 更新 prompt
  -> emit("send")
```

本次不改变 `submit: [text: string]` 事件契约，也不要求 `ChatInput.vue` 识别新的结构化 payload。这样可以把变化限制在命令构造边界，并保持状态 badge 和菜单入口的现有调用方式。

## 8. 国际化

在以下文件的 `spcodeProjectLoad.dialog` 下增加同构键：

- `dashboard/src/i18n/locales/zh-CN/features/chat.json`
- `dashboard/src/i18n/locales/en-US/features/chat.json`
- `dashboard/src/i18n/locales/ru-RU/features/chat.json`

新增键用于：

- 加载步骤区域标题。
- 加载 AGENTS.md checkbox。
- 加载 Codegraph checkbox。

三个 locale 必须保持键集合一致，以通过现有 i18n completeness 测试。

## 9. 错误处理与兼容性

- 路径为空时继续由现有 `canSubmit` 阻止提交。
- 后端 flag 大小写敏感，前端只输出精确的小写 `no_agentsmd` 与 `no_codegraph`。
- 后端允许 flag 位于路径前后；前端统一追加在路径后，确保输出稳定、便于测试。
- 两项都取消时仍允许提交。该命令只登记工作目录，符合后端“空壳 load”语义。
- 未取消任何选项时，生成的命令与旧版完全一致。
- Codegraph 专用对话框及 `/project unload` 命令保持不变。

## 10. 测试设计

新增：

- `dashboard/src/components/chat/ProjectLoadDialog.spec.ts`

测试采用 Vitest 与 Vue Test Utils，按 TDD 覆盖以下行为：

1. project 模式渲染两个 checkbox，且默认均选中。
2. 两项均选中时不追加 flag。
3. 仅取消 AGENTS.md 时追加 `no_agentsmd`。
4. 仅取消 Codegraph 时追加 `no_codegraph`。
5. 两项都取消时按固定顺序追加两个 flag。
6. 路径含空格时保留正确双引号，并将 flag 放在路径之后。
7. 关闭后再次打开时，两项恢复为选中。
8. codegraph 模式不渲染这些选项，且生成命令不带 project flag。

实现后执行：

```text
pnpm exec vitest run src/components/chat/ProjectLoadDialog.spec.ts
pnpm exec vitest run src/components/chat/ProjectLoadDialog.spec.ts src/components/chat/SpcodeProjectIndicator.spec.ts src/components/chat/SpcodeCodegraphChip.spec.ts src/i18n/i18n.completeness.spec.ts
pnpm typecheck
```

隔离 worktree 的相关基线测试在实现前为 2 个文件、8 个测试全部通过。完整 Dashboard 套件另有 3 个既有失败，均位于 `DocumentManager.spec.ts`，错误为 `Cannot access 'gitLogPath' before initialization`；用户已确认继续本功能且不顺带修改该无关模块。

## 11. 验收标准

- 用户能在“加载项目目录”对话框中分别控制 AGENTS.md 与 Codegraph 子步骤。
- 两项在每次打开对话框时默认选中。
- 四种选择组合生成与后端 v2.21 语法一致的命令。
- Codegraph 专用对话框行为无变化。
- 三种语言的新增文案键完整一致。
- 新增组件测试、相关回归测试和 TypeScript typecheck 通过。
- 只做本地提交，不推送远端、不创建 PR。
