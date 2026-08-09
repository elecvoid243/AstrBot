# 更新日志生成（Changelog Generate）设计

- **Author**: elecvoid243
- **Date**: 2026-08-09
- **Status**: Approved（brainstorming 全流程确认）
- **涉及仓库**:
  - `F:\github\Astrbot`（dashboard 前端）
  - `F:\github\astrbot_plugin_spcode_toolkit`（spcode 插件后端）

## 1. 背景与目标

Git 历史页「更多功能」菜单新增「生成更新日志」能力：用户选择一段连续 commit，
输入版本号、选择 LLM provider，调用插件 `/spcode/btw` 端点，将选中 commit 的
git diff 与提交信息作为上下文，由 LLM 产出规范的中文更新日志 markdown，
经用户预览/编辑后保存到 `项目根/changelogs/` 目录（不存在则创建）。

**非目标**：

- 不自动生成英文/双语版本（固定中文，面向中文语境的通用项目）。
- 不自动 commit 生成的 changelog 文件（落盘即结束，git 操作留给用户）。
- 不绑定 AstrBot 项目自身的 changelog 格式（该功能服务于任意用户项目）。

## 2. 关键决策（brainstorming 确认记录）

| # | 问题 | 决策 |
|---|------|------|
| Q1 | commit 选择语义 | **任意连续区段**：不要求 HEAD 锚定，必须在显示列表中连续 |
| Q2 | diff 获取与 prompt 组装 | **扩展 git-show** 支持整提交 full patch，前端逐 commit 取 diff 并组装 prompt |
| Q3 | 生成后流程 | **对话框内预览 + 可编辑**，用户点「保存」才落盘 |
| Q4 | 版本号与覆盖 | **宽松校验**（警告不阻止）+ 纯数字自动补 `v` 前缀；文件已存在时**二次确认后覆盖** |
| Q5 | 语言与格式 | **固定中文**，规范分类结构 |
| Q6 | prompt 结构 | **三段式**：① 任务指引（用户可编辑，有默认模板）② 提交 diff+message ③ 最近一次 changelog（存在才附加，作为风格参考） |

## 3. 交互流程（方案一：复用压缩提交的选择模式）

```
「更多功能」菜单 → 生成更新日志（第一次点击）
  → changelogSelecting = true，日志列表行首出现复选框
  → 用户勾选连续区段（菜单项显示计数 (N)，选区无效时禁用）
  → 第二次点击菜单项 → emit('changelog', {commits})
  → GitDiffSidebar 打开 GitChangelogDialog
  → 对话框内：版本号 + provider + 任务指引（可编辑）→ 生成 → 预览/编辑 → 保存
  → 保存成功：snackbar 显示路径，bump changelogResetToken 退出选择模式
对话框关闭（保存/取消）→ 退出选择模式并清空选区
```

### 3.1 选择模式规则（`GitLogView.vue`）

- **有效性**：选中 commit 在**当前显示列表**中索引连续；最少 **1** 条；上限 **50** 条
  （超出置 invalid，hint：「一次最多选择 50 条提交」）。
- **不要求 `viewingCurrent`**：只读操作，任何过滤视图（ref/author/path 过滤后）均可用；
  连续性基于显示列表判定。
- **与 squash 选择模式互斥**：进入任一模式时自动取消另一模式。
- **菜单项动态状态**：计数后缀 `(N)`、选区无效禁用、tooltip 动态提示（与 squash 项一致）。
- **退出通道**：对话框关闭（reset token）、工具栏「取消」按钮、切视图 / 关 sidebar。

## 4. 后端设计（插件 `astrbot_plugin_spcode_toolkit`）

**唯一改动文件**：`tools/webapi/git_show.py`（不改路由注册）。

### 4.1 新增 query 参数 `full_patch=1`

- 与现有 `?path=` **互斥**，同传返回 `invalid_param`。
- 在现有 name-status + numstat 两次调用之外追加：
  ```
  git show --no-color --no-ext-diff --pretty=format: <ref>
  ```
  空 format 使 stdout 为**纯 diff 文本**（无 commit header），前端可直接嵌入 prompt。
- **字节上限**：新常量 `MAX_SHOW_FULL_PATCH_BYTES = 256 * 1024`。
  超限时**截断而非报错**，响应置 `patch_truncated=true`。
  （单个超大 commit 不应阻塞整个 changelog 流程。）
- binary 文件天然只输出 `Binary files ... differ` 一行，无需特殊处理。

### 4.2 响应扩展（仅 `full_patch=1` 时附加，不传 100% 向后兼容）

```json
{
  "data": {
    "...": "现有字段不变",
    "patch": "diff --git a/... （截断后的纯 diff 文本）",
    "patch_truncated": false
  }
}
```

### 4.3 ETag

复用现有 `_compute_show_etag`（HEAD sha + worktree/index mtime）。
commit diff 不可变（sha 寻址），ETag 未命中时重算即可，缓存键语义不变。

## 5. 前端设计（dashboard）

### 5.1 组件与文件清单

| 文件 | 改动 |
|------|------|
| `components/chat/message_list_comps/GitLogView.vue` | changelog 选择模式状态机、行首复选框绑定、「更多功能」菜单第三项、`changelog` emit |
| `components/chat/GitChangelogDialog.vue` | **新组件**，仿 GitSquashDialog 结构 |
| `components/chat/GitDiffSidebar.vue` | 对话框挂载、`onChangelogRequest` handler、`changelogResetToken`、保存后 snackbar |
| `composables/useSpcodeGitShow.ts` | 请求参数 `fullPatch`、响应透传 `patch` / `patchTruncated` |
| `composables/changelogPrompt.ts` | **新文件**，纯函数：默认模板常量、三段拼接、截断、围栏剥离、semver 排序、版本号规范化 |
| `i18n/locales/{zh-CN,en-US,ru-RU}/features/chat.json` | `spcodeProjectLoad.diffSidebar.changelog.*` |

### 5.2 `GitChangelogDialog.vue` 布局（自上而下）

1. **提交清单**：选中 commit 列表（旧 → 新，short sha + subject，只读）。
2. **版本号输入**：`v-text-field`
   - 纯数字输入自动补 `v` 前缀（`4.25.0` → `v4.25.0.md`）。
   - 宽松校验：不匹配 semver 显示 warning 提示，**不阻止**保存。
3. **Provider 选择器**：复用 commit dialog 模式——
   `listProviders({capability:"chat", enabled:true})` + `__auto__`（自动）选项。
4. **任务指引 textarea**：打开时预填默认模板，可直接二次编辑；
   编辑结果持久化 localStorage（沿用 sidebar 偏好持久化模式）；
   旁置「恢复默认」小按钮。
5. **生成区**：「生成」按钮（loading spinner + hint）→ 结果填入**可编辑 textarea**
   （等宽字体、auto-grow）；「重新生成」按钮；生成失败显示错误条（reason → i18n）。
6. **格式参考提示行**：`格式参考：changelogs/v4.24.0.md` 或 `未找到历史 changelog，使用默认格式`。
7. **操作栏**：取消 / 保存（禁用条件：内容为空 或 版本号为空）。

### 5.3 三段式 Prompt（`changelogPrompt.ts`）

```
┌──────────────────────────────────────────────┐
│ Part 1: 任务指引（用户可编辑，默认模板预填）      │
│ Part 2: 选中提交的 sha / subject / body / diff │
│ Part 3: 最近一次 changelog 全文（存在才附加）    │
└──────────────────────────────────────────────┘
```

- **Part 1 默认模板**（常量，中文）要点：生成中文更新日志；只输出 markdown 正文
  （禁止代码块包裹/解释性文字）；固定三分类 `## 新功能` / `## 优化` / `## 修复`
  （空分类省略）；每条一句话、用户视角；合并同类提交；每条末尾附 `(shortSha)`。
- **Part 2**：每 commit 一块。单 diff 截断 **32KB**（尾部追加 `（diff 过大，已省略）`）；
  总 prompt 上限 **128KB**（超出时从最大 diff 开始进一步压缩）。
- **Part 3**：**对话框打开时**列出 `changelogs/` 内 `.md` 文件，按 **semver 降序**取最新
  （不可解析的文件名排最后），结果同时用于对话框的「格式参考」提示行与生成时的
  prompt 拼接（一次获取，两处复用）；文件内容截断 **16KB**；prompt 中标注
  「以下是该项目最近一次更新日志，请模仿其格式与措辞风格」；
  目录不存在/为空则省略本段。
- **btw 调用不带 `umo`**：不注入会话历史/persona（与 squash dialog 一致）。
- **响应清洗**：剥离模型可能输出的 ```` ```markdown ```` 围栏，trim；为空按 `empty_response`。

### 5.4 保存流程

```
点保存 → 探测存在性（GET file-browser 读 changelogs/vX.Y.Z.md）
  → 存在：二次确认「覆盖已存在的文件？」→ 确认后写
  → 不存在：直接写
POST /spcode/file-write（upsert；相对项目根路径 changelogs/vX.Y.Z.md）
→ 成功：snackbar 显示路径 → bump changelogResetToken 退出选择模式
```

**待验证点**：file-write 是否自动创建不存在的 `changelogs/` 父目录；
若不支持，需为 file-write 增加 `create_parents` 能力（实现阶段先验证再定）。

## 6. 错误处理矩阵

| 环节 | 场景 | 行为 |
|------|------|------|
| diff 获取 | 个别 commit git-show 失败 | **降级不中止**：该 commit 只带 message（prompt 标注「diff 获取失败」），对话框 warning 条提示数量 |
| diff 获取 | 网络错误 / 用户取消 | 整个生成中止，错误条提示，可重试 |
| btw | `no_provider` / `provider_not_found` / `provider_type_invalid` / `llm_error` / `empty_response` / `network` | reason → i18n 错误条（复用 squash dialog 映射模式）；`aborted` 静默 |
| btw 响应 | 围栏剥离后为空 | 按 `empty_response` 处理 |
| 对话框 | 生成中关闭 | `btw.cancel()`（btw 无副作用，不阻塞关闭） |
| 保存 | file-write 失败 | snackbar 显示 reason，对话框保持打开（内容不丢） |
| 选择模式 | 切视图 / 关 sidebar / squash 模式启动 | 自动退出并清空选区 |

## 7. 测试

- **插件** `tests/test_git_show.py` 新增：
  `full_patch=1` 返回纯 diff（无 commit header）；与 `path=` 互斥返回 `invalid_param`；
  超 256KB 置 `patch_truncated=true`；不传参时响应无 `patch` 字段（向后兼容）。
- **Dashboard** `tests/changelogPrompt.test.mjs`（仿 `commitMessagePrompt.test.mjs`）：
  三段拼接顺序；Part 3 缺失时省略；单 diff 32KB / 总量 128KB 截断；
  围栏剥离；semver 降序取最新；版本号规范化（纯数字补 `v`）。
- **手动验证清单**（随实现计划附带）：选择模式 → 生成 → 编辑 → 覆盖确认 →
  落盘 → 文件浏览器可见。

## 8. i18n

zh-CN / en-US / ru-RU 三语言，键挂 `spcodeProjectLoad.diffSidebar.changelog.*`
（菜单项、对话框全部文案、reason 映射）。
