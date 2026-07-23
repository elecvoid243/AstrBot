# Dashboard ChatUI「Git Diff Sidebar 分支/工作树手动刷新」— 设计文档

| 项目 | 内容 |
|------|------|
| 主题 | 在 `GitDiffSidebar` 的分支按钮与工作树按钮旁加一个手动刷新按钮，按需触发 `branches` + `worktrees` + `git-diff` 3 个列表的同步刷新 |
| 日期 | 2026-07-23 |
| 作者 | elecvoid243 |
| 状态 | Draft — 待用户审阅 |
| 关联代码 | `dashboard/src/components/chat/GitDiffSidebar.vue`、`useSpcodeGitBranches.ts`、`useSpcodeWorktrees.ts`、`useSpcodeGitDiff.ts` |
| 前置 spec | `docs/superpowers/specs/2026-06-17-chatui-git-diff-sidebar-design.md`、`2026-06-18-git-worktree-switcher-design.md`、`2026-07-22-git-worktree-tabs-collapse.md`（最后一条已合入 `GitDiffSidebar.vue` 的 inline comment，未独立成 spec） |

---

## 1. 背景与目标

### 1.1 现状

`GitDiffSidebar` 顶部 `.git-diff-sidebar-actions` 已有一个 `mdi-restart` 刷新按钮（`GitDiffSidebar.vue:3348`），调 `onManualRefresh()`：

- 在 `files` view 下刷 `fileBrowserRef.refresh() + worktreesComposable.refresh()`。
- 在其他 view 下刷 `composable.refresh() + worktreesComposable.refresh()`（`composable` 即 `useSpcodeGitDiff`）。

**关键缺口**：该按钮 **从不调用 `branchesComposable.refresh()`**。分支列表的唯一刷新来源是：

1. 挂载时的 `void branchesComposable.refresh()`（`GitDiffSidebar.vue:1382`）
2. `useSpcodeGitBranches` 内部的 30 秒轮询（`DEFAULT_POLL_MS = 30_000`）
3. 切换分支/创建/删除分支等 mutation（`runMutation` 内 `parseSpcodeGitBranches` 后原子替换 `state`）

后果：在两次 30s poll 之间，远端新建的本地分支（例如 `git fetch` 后）、用户手动在外部终端执行的 `git checkout -b` 创建的分支，都不会出现在分支下拉菜单里，最长要等 30 秒。

### 1.2 目标

在 `.git-diff-sidebar-bw` 容器（包住分支按钮与工作树按钮的那个 wrapper）内增加一个 **手动刷新按钮**，点击同时触发 3 个 composable 的刷新：

1. `branchesComposable.refresh()`
2. `worktreesComposable.refresh()`
3. `composable.refresh()`（git-diff，与顶部 `mdi-restart` 行为对齐）

按钮位置随 `worktreeTabsExpanded` 切换：

- **展开态**（`worktreeTabsExpanded === true`）：分支独占一行 → 刷新按钮位于 **分支行最右**（跟在 ahead/behind 徽标之后）。
- **折叠态**（`worktreeTabsExpanded === false`）：分支与工作树共用一行（worktree 左 / branch 右）→ 刷新按钮位于 **正中间**。

### 1.3 非目标（显式不做）

- ❌ 不修改 3 个 spcode composable（`useSpcodeGitBranches` / `useSpcodeWorktrees` / `useSpcodeGitDiff`）的任何对外 API
- ❌ 不修改顶部现有 `mdi-restart` 按钮的职责（仍刷 viewMode 对应的数据）
- ❌ 不修改 `worktreeTabsExpanded` 的持久化逻辑（沿用现有 localStorage 键）
- ❌ 不弹 snackbar / toast（与 30s 轮询静默失败的语义一致）
- ❌ 不实现 disabled 态（即使不是 git 仓库，按钮也被 `.git-diff-sidebar-bw` 的 `v-if` 整段隐藏，无需另做 disabled 防护）
- ❌ 不实现快捷键 / 全局监听（顶部 `mdi-restart` 也没有，本次范围保持一致）
- ❌ 不写 Vitest 单测（`GitDiffSidebar.vue` ⚠️ 暂无覆盖测试；本次改动是「加一个 button + 一个小 handler」，按 AGENTS.md「仅在有测试基础设施时补」原则暂缓）

---

## 2. 设计决策（已与用户确认）

| # | 决策点 | 选择 | 理由 |
|---|--------|------|------|
| 1 | 触发哪些 composable | **3 个全部刷**：`branches + worktrees + git-diff` | 用户明确选择"额外也刷 diff"。新按钮因此覆盖更广，与顶部 `mdi-restart` 互补而非重复 |
| 2 | 图标 | **`mdi-refresh`** | 用户选择。回旋箭头语义最直观 |
| 3 | DOM 节点策略 | **两份 DOM，按 `worktreeTabsExpanded` 二选一**（同一 handler） | 单一按钮 + `position: absolute` 跨容器移动会在 sidebar 缩窄换行时失效；Teleport 过重。两份 v-if 是最简单、最不易回归的做法 |
| 4 | loading 态来源 | **派生自 `branchesComposable.state` 与 `worktreesComposable.state`**（`kind === 'loading'` 任一即 loading） | 不引入新本地 ref；与后端真实请求同步 |
| 5 | 错误处理 | **不弹 snackbar**，复用列表/菜单各自的 `state.kind === 'error'` 渲染分支 | 与 30s 轮询静默失败的语义对齐；按钮不是 modal 触发器，不应承担错误反馈 |
| 6 | i18n | 新增 `bwRefreshTooltip` 单 key（zh-CN / en-US / ru-RU） | 顶部 `mdi-restart` 复用了 `diffSidebar.refreshTooltip`；新按钮职责不同，必须独立 key |
| 7 | 与顶部 `mdi-restart` 关系 | **共存、不合并** | 顶部按钮的 viewMode-aware 行为是 files 视图下刷 file browser 的核心入口；新按钮聚焦分支/工作树管理。两套入口，两套语义 |
| 8 | 测试策略 | 不写单测；以 `vue-tsc --noEmit` + `vite build` 通过 + 现有 17 个 `parseSpcodeGitDiff.test.mjs` + 姊妹 spec 不回归作为验收门槛 | 与 2026-06-20 spec 文件浏览器决策一致；`GitDiffSidebar.vue` 暂无 Vitest 基建 |

---

## 3. 架构与文件改动

### 3.1 架构原则

- **零后端改动**：完全使用现有 `/spcode/git-branches` / `/spcode/worktrees` / `/spcode/git-diff` 3 个端点（`useSpcodeGitBranches.refresh` / `useSpcodeWorktrees.refresh` / `useSpcodeGitDiff.refresh` 均为既有 API）
- **零 composable 改动**：3 个 spcode composable 保持原状，仅在 sidebar 内部组合调用
- **Inline-first**：handler 写在 `GitDiffSidebar.vue` 内部，不抽公共 composable
- **AGENTS.md 适用条款**：Google-style docstring、英文注释、`vue-tsc`/`vite` 不适用 ruff

### 3.2 文件改动清单

| 层级 | 文件 | 性质 | 说明 |
|------|------|------|------|
| 改动 | `dashboard/src/components/chat/GitDiffSidebar.vue` | 修改 | +1 handler (`refreshBranchesAndWorktrees`)；模板增加 2 个 button 节点；scoped CSS 增加按钮定位规则 |
| 改动 | `dashboard/src/i18n/locales/zh-CN/features/chat.json` | 修改 | 新增 `spcodeProjectLoad.diffSidebar.bwRefreshTooltip` |
| 改动 | `dashboard/src/i18n/locales/en-US/features/chat.json` | 修改 | 同上 |
| 改动 | `dashboard/src/i18n/locales/ru-RU/features/chat.json` | 修改 | 同上 |

### 3.3 改动量估算

- 新增代码：~25 行（GitDiffSidebar.vue 的 handler + 2 个 button 模板节点）
- 新增 CSS：~15 行（按钮基础样式 + 折叠态 `order` 调整）
- 改动现有代码：~6 行（GitDiffSidebar.vue 模板分支行末尾追加一个节点；3 个 i18n json 各加 1 行）
- 风险面：1 个现有文件小改动；无破坏性 diff 行为；不触及 3 个 composable

### 3.4 模块依赖图（仅显示本次改动触及的部分）

```
GitDiffSidebar.vue (修改)
  ├─ refreshBranchesAndWorktrees()        [NEW handler]
  │     ├─ branchesComposable.refresh()   (existing, useSpcodeGitBranches)
  │     ├─ worktreesComposable.refresh()  (existing, useSpcodeWorktrees)
  │     └─ composable.refresh()           (existing, useSpcodeGitDiff)
  │
  ├─ Template: <button v-if="worktreeTabsExpanded">  [NEW, in branch row]
  └─ Template: <button v-else>                       [NEW, as wrapper direct child]
```

---

## 4. 实现细节

### 4.1 Handler: `refreshBranchesAndWorktrees`

写在 `GitDiffSidebar.vue` 的 `<script setup>` 内，紧贴现有 `onManualRefresh` 之上（两者职责相似，物理相邻便于对照阅读）：

```typescript
// Author: elecvoid243, 2026-07-23
// Spec: docs/superpowers/specs/2026-07-23-git-diff-sidebar-bw-refresh-design.md §4.1
//
// Manual refresh for the branch + worktree management row.
// 3-way parallel refresh (branches / worktrees / git-diff) so the
// user gets a single click that pulls the latest server state across
// all three lists the row controls. Distinct from the top-bar
// `mdi-restart` button (onManualRefresh, viewMode-aware) which is
// the file-browser-aware refresh path.
//
// `useSpcodeGitBranches.refresh` and `useSpcodeWorktrees.refresh`
// already return Promises; we use `Promise.allSettled` (NOT
// `Promise.all`) so a single failure doesn't kill the other two
// requests' UI updates — branches may 404 on a non-repo while
// worktrees still answers, and we want both partial results
// visible.
async function refreshBranchesAndWorktrees(): Promise<void> {
  await Promise.allSettled([
    branchesComposable.refresh(),
    worktreesComposable.refresh(),
    composable.refresh(),
  ]);
}
```

要点：

- 用 `Promise.allSettled` 而不是 `Promise.all`：spcode 在 `no_project_loaded` 等场景下会走 `state.value = { kind: 'error' }` 而非 throw；即使真有 throw，`allSettled` 也能让其他两个的状态正常更新。
- 不引入 `isFetching` 局部 ref：loading 态在模板里直接派生自 composable state（见 §4.2）。
- 不写 snackbar / error toast：错误信息已在列表/菜单的 `state.kind === 'error'` 分支中显示。

### 4.2 Template：两份 button 节点

#### 4.2.1 展开态：分支行末尾

在 `<div class="git-diff-sidebar-branch-mgmt">` 内、`.git-diff-sidebar-branch-mgmt-tracking` 之后追加：

```vue
<button
  v-if="worktreeTabsExpanded"
  type="button"
  class="git-diff-sidebar-bw-refresh"
  :title="tm('spcodeProjectLoad.diffSidebar.bwRefreshTooltip')"
  :aria-label="tm('spcodeProjectLoad.diffSidebar.bwRefreshTooltip')"
  :disabled="
    branchesComposable.state.value.kind === 'loading' ||
    worktreesComposable.state.value.kind === 'loading'
  "
  @click="refreshBranchesAndWorktrees"
>
  <v-progress-circular
    v-if="
      branchesComposable.state.value.kind === 'loading' ||
      worktreesComposable.state.value.kind === 'loading'
    "
    indeterminate
    :size="14"
    :width="2"
  />
  <v-icon v-else size="14">mdi-refresh</v-icon>
</button>
```

#### 4.2.2 折叠态：wrapper 直接子元素

在 `<div class="git-diff-sidebar-bw">` 内、`.git-diff-sidebar-tabs` 与 `.git-diff-sidebar-branch-mgmt` 之间（DOM 顺序放在最后，与展开态的"出现在分支附近"语义一致）：

```vue
<button
  v-if="!worktreeTabsExpanded"
  type="button"
  class="git-diff-sidebar-bw-refresh"
  :title="tm('spcodeProjectLoad.diffSidebar.bwRefreshTooltip')"
  :aria-label="tm('spcodeProjectLoad.diffSidebar.bwRefreshTooltip')"
  :disabled="
    branchesComposable.state.value.kind === 'loading' ||
    worktreesComposable.state.value.kind === 'loading'
  "
  @click="refreshBranchesAndWorktrees"
>
  <v-progress-circular
    v-if="
      branchesComposable.state.value.kind === 'loading' ||
      worktreesComposable.state.value.kind === 'loading'
    "
    indeterminate
    :size="14"
    :width="2"
  />
  <v-icon v-else size="14">mdi-refresh</v-icon>
</button>
```

注：折叠态分支行与工作树行都会隐藏（被 `.is-collapsed` 下各自的 `v-if` 控制），但这个 button 因为 `v-if="!worktreeTabsExpanded"` 显式渲染，不受分支行 `v-if="isGitRepo && hasMultipleWorktrees"` 限制（也就是说非 git 仓库下整段 `.git-diff-sidebar-bw` 都不渲染，按钮也跟着消失——见 §1.3）。

### 4.3 Scoped CSS

```css
/* Branch/worktree row manual refresh button (spec 2026-07-23 §4.3) */
/* ───────────────────────────────────────────────────────────── */

/* Base shape: a 24x24 ghost button that mirrors the visual weight
   of the existing worktree-tab "add" button (.git-diff-sidebar-tab-add)
   so the two feel like siblings in the row. */
.git-diff-sidebar-bw-refresh {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  margin: 0 4px 0 0; /* breathing room from preceding element */
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}
.git-diff-sidebar-bw-refresh:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.git-diff-sidebar-bw-refresh:disabled {
  cursor: default;
  opacity: 0.5;
}

/* Expanded state: the button lives at the END of the branch row,
   which is a block child of the wrapper. It sits inline after the
   ahead/behind tracking badges — natural source order, no flex
   gymnastics needed. */
.git-diff-sidebar-bw:not(.is-collapsed) > .git-diff-sidebar-bw-refresh {
  /* margin-left auto would push it flush right, but the branch row
     itself is not flex. A small right margin keeps it from kissing
     the row's right padding edge. */
  margin-left: 6px;
}

/* Collapsed state: the wrapper becomes flex with 3 children
   (worktree / refresh / branch). Bumping the existing `order`
   values by +1 (worktree 1→1 stays, branch 2→3) inserts the
   refresh button at order: 2 (visually middle).
   `justify-content: space-between` then parks worktree flush
   left, branch flush right, and refresh centered in the gap —
   exactly the user-stated "正中间" layout. */
.git-diff-sidebar-bw.is-collapsed > .git-diff-sidebar-tabs {
  order: 1; /* unchanged from existing */
}
.git-diff-sidebar-bw.is-collapsed > .git-diff-sidebar-bw-refresh {
  order: 2; /* NEW: visually middle */
  /* In collapsed mode the wrapper owns the row's padding
     (6px 14px 8px), so the button's own margin-right: 4px
     would over-pad. Zero it out to keep the centered look tight. */
  margin-right: 0;
}
.git-diff-sidebar-bw.is-collapsed > .git-diff-sidebar-branch-mgmt {
  order: 3; /* was 2 in the existing CSS — bumped +1 to make room */
}
```

### 4.4 i18n

3 个 locale 文件各加 1 行（统一放在 `spcodeProjectLoad.diffSidebar` 对象下，与现有 `refreshTooltip` 相邻）：

| Locale | Key | Value |
|--------|-----|-------|
| zh-CN | `bwRefreshTooltip` | `"刷新分支和工作树"` |
| en-US | `bwRefreshTooltip` | `"Refresh branches & worktrees"` |
| ru-RU | `bwRefreshTooltip` | `"Обновить ветки и деревья"` |

---

## 5. 验收清单（端到端）

按以下场景依次验证（每步预期 ✅）：

1. **展开态可见性**
   - 默认进入 sidebar → 工作树默认展开（`worktreeTabsExpanded` 初始 `true`，见 `STORAGE_KEYS.worktreeTabsExpanded` 默认逻辑）
   - 分支行最右出现一个 `mdi-refresh` 图标按钮，hover 出现浅色背景
   - tooltip 显示"刷新分支和工作树"

2. **折叠态可见性**
   - 点击工作树标签左侧的折叠按钮（`mdi-chevron-down` → `mdi-chevron-right`）
   - 分支与工作树行合并为一行，refresh 按钮出现在两按钮中间
   - 展开按钮重新展开 → refresh 回到分支行最右

3. **点击行为（展开态）**
   - 在外部终端 `git fetch && git checkout -b test/manual-refresh`
   - 点击 refresh → 大约 200-500ms 后分支下拉菜单出现新分支 `test/manual-refresh`
   - 顶部 `mdi-restart` 在此期间 **不** 触发（独立 handler）
   - 文件视图下点击 refresh → file browser 不刷新（验证职责分离）

4. **点击行为（折叠态）**
   - 折叠工作树 → 点击中间 refresh → 同样出现新分支

5. **loading 反馈**
   - 点击后立刻 → 按钮内的 `mdi-refresh` 图标被替换为 `<v-progress-circular indeterminate>`
   - 网络断开（devtools → offline）→ loading 转圈持续到 30s 轮询兜底 / 用户重新联网

6. **错误态显示**
   - 故意让后端 branches 接口返回 500（mock 或临时改后端）→ 点击 refresh
   - 按钮恢复非 loading 态；分支下拉菜单显示 `branchMgmt.error` 文案；按钮本身不弹额外提示

7. **非 git 仓库路径**
   - 加载一个非 git 项目 → `.git-diff-sidebar-bw` 整段 `v-if` 为 false → 按钮自动消失

8. **构建 & 类型**
   - `cd dashboard && npm run build` 通过（vue-tsc + vite）
   - 现有 17 个 `parseSpcodeGitDiff.test.mjs` + `parseSpcodeGitShow.test.mjs` 等 spec 不回归

---

## 6. 风险与缓解

| 风险 | 影响面 | 缓解 |
|------|--------|------|
| `Promise.allSettled` 与 `Promise.all` 行为差异：分支 404 时另两个仍能正常更新 state | 低 | 已在 §4.1 明确选择 `allSettled`；spcode 端点即使失败也会走 `state.kind = 'error'`，不会 throw |
| 折叠态 `order` 调整影响现有 screen-reader 顺序 | 中 | `order` 是 layout-only 属性，不改变 tab order / AT 读取顺序（已有 2026-07-22 spec 注释为证）。新增按钮放在 DOM 末尾、order=2，AT 仍按 DOM 顺序读 |
| 与顶部 `mdi-restart` 职责混淆 | 中 | tooltip 文本明确区分（`刷新` vs `刷新分支和工作树`）；handler 名不同（`onManualRefresh` vs `refreshBranchesAndWorktrees`） |
| `.git-diff-sidebar-bw-refresh` 类名与其他样式冲突 | 低 | 类名含项目级前缀 `git-diff-sidebar-`，与项目所有现存 CSS 类名体系一致；grep 验证未撞名（`grep -r 'git-diff-sidebar-bw-refresh' dashboard/src` 预期零命中） |

---

## 7. 后续可考虑（不在本次范围）

- 将 30s 轮询间隔降为 60s（用户既然能手动刷新，自动轮询可以更"懒"）
- 给按钮加 `Ctrl+R` / `Cmd+R` 快捷键
- 抽一个 `useBranchWorktreeRefresh` composable，封装 3 路并行 + loading 派生（目前仅 1 个调用方，不值）
- 在 dashboard 添加 `GitDiffSidebar` 的 Vitest 基础设施，让本次及未来改动都可补单测
