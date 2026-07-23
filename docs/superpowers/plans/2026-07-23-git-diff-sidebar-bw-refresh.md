# GitDiffSidebar 分支/工作树手动刷新按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `GitDiffSidebar` 的分支按钮与工作树按钮旁加一个手动刷新按钮，点击触发 `branches + worktrees + git-diff` 三路刷新；按钮位置随 `worktreeTabsExpanded` 切换（展开态 → 分支行最右；折叠态 → 两按钮正中间）。

**Architecture:** 单一 handler + 两份 v-if 按钮 DOM（按 `worktreeTabsExpanded` 二选一显示），scoped CSS 通过 `order` 在折叠态下让 refresh 居中。零后端改动、零 composable 改动、零 Vitest（沿用 `vue-tsc` + `vite build` 验收）。完全对齐 spec `docs/superpowers/specs/2026-07-23-git-diff-sidebar-bw-refresh-design.md`。

**Tech Stack:** Vue 3 (Composition API)、Vuetify 3、vue-i18n、`vue-tsc`、`vite`、原生 CSS（`scoped`）。

**Author:** elecvoid243
**Timestamp:** 2026-07-23 16:22 CST

## Global Constraints

- 仅本地提交（按 `AGENTS.md` 禁止推送到远端、禁止发起 PR）。
- 不创建 worktree（与 2026-07-23 spec 文件浏览器侧 2026-07-22 同样判断一致：本次改动量小、风险面只触 1 个文件 + 3 个 i18n，inline 即可）。
- 不写 Vitest 单测（`GitDiffSidebar.vue` 当前无覆盖测试基建，spec §1.3 已明确放弃；验收靠 `vue-tsc` + `vite build` + 现有 17 个 `parseSpcodeGitDiff.test.mjs` 不回归）。
- 不引入新的本地 ref、不抽 composable、不抽 helper（`AGENTS.md` Inline-First Rule；handler 只 5 行不值得抽）。
- 不修改顶部现有 `mdi-restart` 按钮职责（仍刷 viewMode 对应数据）。
- i18n 必须三语种齐：zh-CN、en-US、ru-RU。
- 不动 `branchesComposable` / `worktreesComposable` / `composable` 任何对外 API。
- 所有注释使用英文（`AGENTS.md` 第 5 条），中文说明留给 commit message 与 spec。

---

### Task 1: i18n 新增 `bwRefreshTooltip` 三语种

**Files:**
- Modify: `dashboard/src/i18n/locales/zh-CN/features/chat.json`
- Modify: `dashboard/src/i18n/locales/en-US/features/chat.json`
- Modify: `dashboard/src/i18n/locales/ru-RU/features/chat.json`

**Interfaces:**
- Consumes: 现有 `spcodeProjectLoad.diffSidebar.refreshTooltip`（已存在的兄弟 key，仅作位置参考）
- Produces: 新 key `spcodeProjectLoad.diffSidebar.bwRefreshTooltip`（tooltip / aria-label 文案）

- [ ] **Step 1: 在 zh-CN json 加新 key**

打开 `dashboard/src/i18n/locales/zh-CN/features/chat.json`，定位到 `spcodeProjectLoad.diffSidebar.refreshTooltip`（line 455）。在它紧邻位置（同一对象内、紧挨着）新增一行，保持 6 空格缩进与其他兄弟 key 一致：

```json
      "refreshTooltip": "刷新",
      "bwRefreshTooltip": "刷新分支和工作树",
```

注意：紧跟在 `"refreshTooltip": "刷新",` 这行后新增一行，前后不要改动其他内容。

- [ ] **Step 2: 在 en-US json 加新 key**

打开 `dashboard/src/i18n/locales/en-US/features/chat.json`，同样在 `"refreshTooltip": "Refresh",`（line 455）后新增：

```json
      "refreshTooltip": "Refresh",
      "bwRefreshTooltip": "Refresh branches & worktrees",
```

- [ ] **Step 3: 在 ru-RU json 加新 key**

打开 `dashboard/src/i18n/locales/ru-RU/features/chat.json`，在 `"refreshTooltip": "Обновить",`（line 435）后新增：

```json
      "refreshTooltip": "Обновить",
      "bwRefreshTooltip": "Обновить ветки и деревья",
```

- [ ] **Step 4: 验证三处改动**

运行：

```cmd
cd /d F:\github\Astrbot\dashboard
findstr "bwRefreshTooltip" src\i18n\locales\zh-CN\features\chat.json src\i18n\locales\en-US\features\chat.json src\i18n\locales\ru-RU\features\chat.json
```

预期：每个文件各输出 1 行匹配。

- [ ] **Step 5: 验证 JSON 仍合法**

运行：

```cmd
cd /d F:\github\Astrbot\dashboard
node -e "['zh-CN','en-US','ru-RU'].forEach(l => JSON.parse(require('fs').readFileSync('src/i18n/locales/' + l + '/features/chat.json','utf8')))"
```

预期：无输出（silent exit），无 `SyntaxError`。

- [ ] **Step 6: 提交**

```cmd
cd /d F:\github\Astrbot
git add dashboard/src/i18n/locales/zh-CN/features/chat.json dashboard/src/i18n/locales/en-US/features/chat.json dashboard/src/i18n/locales/ru-RU/features/chat.json
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "i18n: add bwRefreshTooltip for git-diff-sidebar branch/worktree refresh button"
```

---

### Task 2: 加 handler + 两份按钮 DOM 节点

**Files:**
- Modify: `dashboard/src/components/chat/GitDiffSidebar.vue`（`<script setup>` 内 + 模板 2 处）

**Interfaces:**
- Consumes: 已存在的 `branchesComposable`（line 413）、`worktreesComposable`（line 412）、`composable`（line 627）、`worktreeTabsExpanded`（line 308）、`tm(...)` 来自 `useModuleI18n("features/chat")`（line 56）
- Produces:
  - 新函数 `refreshBranchesAndWorktrees(): Promise<void>`，紧贴现有 `onManualRefresh`（line 1346）上方
  - 新模板节点：分支行 `.git-diff-sidebar-branch-mgmt` 内、`.git-diff-sidebar-branch-mgmt-tracking` 之后，绑 `v-if="worktreeTabsExpanded"`
  - 新模板节点：`.git-diff-sidebar-bw` 内、`.git-diff-sidebar-tabs` 与 `.git-diff-sidebar-branch-mgmt` 之间，绑 `v-if="!worktreeTabsExpanded"`

- [ ] **Step 1: 加 handler 函数**

打开 `dashboard/src/components/chat/GitDiffSidebar.vue`，定位到 `async function onManualRefresh(): Promise<void>`（line 1346）。

在它 **正上方** 插入以下 16 行（包括前后空行）：

```typescript
// Spec 2026-07-23 §4.1: manual refresh for the branch + worktree
// management row. 3-way parallel refresh (branches / worktrees /
// git-diff) so a single click pulls the latest server state across
// all three lists the row controls. Distinct from the top-bar
// `mdi-restart` button (onManualRefresh, viewMode-aware) which is
// the file-browser-aware refresh path.
//
// `useSpcodeGitBranches.refresh` and `useSpcodeWorktrees.refresh`
// already return Promises; we use `Promise.allSettled` (NOT
// `Promise.all`) so a single failure doesn't kill the other two
// requests' UI updates — branches may 404 on a non-repo while
// worktrees still answers, and we want both partial results
// visible. Loading state is derived in the template from each
// composable's `state.value.kind === 'loading'` rather than a
// local ref.
async function refreshBranchesAndWorktrees(): Promise<void> {
  await Promise.allSettled([
    branchesComposable.refresh(),
    worktreesComposable.refresh(),
    composable.refresh(),
  ]);
}
```

- [ ] **Step 2: 加展开态按钮节点（分支行末尾）**

定位到 `.git-diff-sidebar-branch-mgmt-tracking` 这个 `<span>`（line 3708），它在 `<div class="git-diff-sidebar-branch-mgmt">` 内、显示完 ahead/behind 徽标后闭合 `</span>`（line 3758 的 `</span>`），紧接着是 line 3759 的 `</div>` 闭合 `.git-diff-sidebar-branch-mgmt`。

在 line 3758 那个 `</span>` **之后**、line 3759 的 `</div>` **之前**（仍在 `.git-diff-sidebar-branch-mgmt` 这个 div 内），追加以下 23 行：

```vue
          <!-- Spec 2026-07-23 §4.2.1: branch/worktree row manual
               refresh. Expanded state: anchored to the right end of
               the branch row. Loading state replaces the icon with
               a progress spinner (derived from the underlying
               composables' `state.kind === 'loading'` rather than
               a local ref, so the spinner never lags the real
               request). -->
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

注意：插入位置必须在 `.git-diff-sidebar-branch-mgmt` 这个 div 内（找它的 `</div>` 闭合），不要插到外层 wrapper 里。

- [ ] **Step 3: 加折叠态按钮节点（wrapper 直接子元素）**

定位到 `.git-diff-sidebar-bw` 这个 `<div>`（line 3497，v-if 控制整段显示）。它在 `is-collapsed` 时是 flex 容器，三个直接子元素是 `.git-diff-sidebar-branch-mgmt`、`.git-diff-sidebar-tabs`、以及（即将添加的）`.git-diff-sidebar-bw-refresh`。

具体插入位置：在 `.git-diff-sidebar-tabs` 这个 `<div>`（line 3762）**之前**（DOM 顺序放在最前，让 refresh 按钮在折叠态 flex 中以 `order: 2` 居中——CSS 在 Task 3 配）。这个 `<div>` 紧跟 line 3760 的 `<!-- Worktree tabs ... -->` 注释。`.git-diff-sidebar-bw` 容器本身在 line 3497。

在它前面插入以下 23 行：

```vue
          <!-- Spec 2026-07-23 §4.2.2: collapsed-state counterpart of
               the refresh button above. Sits as a DIRECT CHILD of
               `.git-diff-sidebar-bw` so the collapsed flex layout
               (`justify-content: space-between`, 3 children) can
               park it visually in the middle. DOM order placed
               BEFORE .git-diff-sidebar-tabs so the screen-reader
               order matches the expanded layout (branch-related
               controls announced first). Visual position is
               controlled by `order: 2` in CSS. -->
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

- [ ] **Step 4: 类型检查**

运行：

```cmd
cd /d F:\github\Astrbot\dashboard
npx vue-tsc --noEmit
```

预期：无 error 输出；warnings 可忽略。

- [ ] **Step 5: 提交**

```cmd
cd /d F:\github\Astrbot
git add dashboard/src/components/chat/GitDiffSidebar.vue
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(git-diff-sidebar): add branch/worktree manual refresh button (handler + 2 DOM nodes)"
```

---

### Task 3: scoped CSS — 按钮基础样式 + 折叠态 order 调整

**Files:**
- Modify: `dashboard/src/components/chat/GitDiffSidebar.vue`（`<style scoped>` 块内）

**Interfaces:**
- Consumes: 现有 `.git-diff-sidebar-bw.is-collapsed` flex 容器、现有 `.git-diff-sidebar-bw.is-collapsed > .git-diff-sidebar-tabs { order: 1 }`、现有 `.git-diff-sidebar-bw.is-collapsed > .git-diff-sidebar-branch-mgmt { order: 2 }`
- Produces:
  - 新类 `.git-diff-sidebar-bw-refresh`（基础样式：24×24 ghost button，hover 浅色背景，disabled 半透明）
  - 现有 `.git-diff-sidebar-bw.is-collapsed > .git-diff-sidebar-branch-mgmt` 的 `order` 从 `2` 改成 `3`
  - 新增 `.git-diff-sidebar-bw.is-collapsed > .git-diff-sidebar-bw-refresh { order: 2 }`

- [ ] **Step 1: 定位插入位置**

打开 `dashboard/src/components/chat/GitDiffSidebar.vue` 末尾的 `<style scoped>` 块，定位到 line 5050-5057 这两条现有 CSS（带 `.git-diff-sidebar-bw.is-collapsed >` 选择器的部分）：

```css
.git-diff-sidebar-bw.is-collapsed > .git-diff-sidebar-tabs {
  order: 1; /* visually left */
  margin-left: 2px; /* nudge content 2px right */
}
.git-diff-sidebar-bw.is-collapsed > .git-diff-sidebar-branch-mgmt {
  order: 2; /* visually right */
  margin-right: 2px; /* nudge content 2px left */
}
```

将 `order: 2` 改为 `order: 3`：

```css
.git-diff-sidebar-bw.is-collapsed > .git-diff-sidebar-branch-mgmt {
  order: 3; /* visually right (was 2; bumped +1 for refresh button at order: 2) */
  margin-right: 2px; /* nudge content 2px left */
}
```

同时紧贴它 **上方**（即在 `.is-collapsed > .git-diff-sidebar-tabs { order: 1 }` 那条规则之后），新增这条：

```css
.git-diff-sidebar-bw.is-collapsed > .git-diff-sidebar-bw-refresh {
  order: 2; /* visually middle (between worktree=1 and branch=3) */
  /* In collapsed mode the wrapper owns the row's padding
     (6px 14px 8px), so the button's own margin-right: 4px from
     the base rule would over-pad. Zero it out to keep the
     centered look tight. */
  margin-right: 0;
}
```

- [ ] **Step 2: 追加按钮基础样式**

在 `<style scoped>` 块内、靠近其它 `.git-diff-sidebar-bw` 相关规则的位置（比如紧贴在 `.git-diff-sidebar-bw.is-collapsed > .git-diff-sidebar-branch-mgmt { order: 3 ... }` 之后），追加完整一段：

```css
/* ── Branch/worktree row manual refresh button ──────────────────────
   Spec 2026-07-23 §4.3. A 24x24 ghost button that mirrors the
   visual weight of the existing worktree-tab "add" button
   (.git-diff-sidebar-tab-add) so the two feel like siblings in
   the row. Two DOM nodes share this class (one inside the
   branch row, one as a wrapper-level child); the collapsed/
   expanded position switch is driven by `order` in the parent
   `.is-collapsed` rules above, NOT by this base rule. */

/* Base shape + interaction states. */
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
.git-diff-sidebar-bw-refresh:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.5);
  outline-offset: 1px;
}

/* Expanded state: button is the last inline child of the branch
   row (which is a block child of the wrapper). Source order
   alone puts it on the right; the small left margin gives 6px
   breathing room from the preceding tracking badges. */
.git-diff-sidebar-bw:not(.is-collapsed) > .git-diff-sidebar-bw-refresh {
  margin-left: 6px;
}
```

- [ ] **Step 3: 类型检查（CSS 改动不需要 vue-tsc，但模板引用了类名，留作 sanity check）**

```cmd
cd /d F:\github\Astrbot\dashboard
npx vue-tsc --noEmit
```

预期：无 error。

- [ ] **Step 4: 提交**

```cmd
cd /d F:\github\Astrbot
git add dashboard/src/components/chat/GitDiffSidebar.vue
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(git-diff-sidebar): style bw-refresh button + adjust collapsed-state order for centering"
```

---

### Task 4: 构建 + 现有测试回归 + 手动视觉验收

**Files:**
- 不修改任何文件，仅验证

- [ ] **Step 1: 跑完整 build**

```cmd
cd /d F:\github\Astrbot\dashboard
npm run build
```

预期：`vue-tsc --noEmit` 通过 + `vite build` 成功；退出码 0；输出 `✓ built in <N>s`。已有 warning（如 `vocechat.png` 找不到、CodeMirror dynamic import 提示）依旧存在，与本次改动无关。

- [ ] **Step 2: 跑现有 parseSpcodeGitDiff 回归测试**

```cmd
cd /d F:\github\Astrbot\dashboard
node --test tests/parseSpcodeGitDiff.test.mjs
```

预期：17/17 pass（含 2 个上轮中文文件名回归用例）。

- [ ] **Step 3: 跑姊妹 spec 测试**

```cmd
cd /d F:\github\Astrbot\dashboard
node --test tests/parseSpcodeGitShow.test.mjs
```

预期：18/18 pass。

- [ ] **Step 4: 手动视觉验收（人工）**

启 dev server：

```cmd
cd /d F:\github\Astrbot\dashboard
pnpm dev
```

打开浏览器进 dashboard，加载一个多 worktree 的 git 项目（任何含 `.git/worktrees/*` 的仓库都行）。逐项对照 spec §5 验收：

| 场景 | 预期 |
|------|------|
| 默认进入 sidebar | 分支行最右出现 `mdi-refresh` 图标按钮，hover 浅色背景 |
| 点击工作树标签左侧的折叠按钮 | refresh 按钮跳到中间，分支与工作树行合并 |
| 重新展开工作树行 | refresh 回到分支行最右 |
| 在外部终端 `git fetch && git checkout -b test/manual-refresh`，再点 refresh | 分支下拉菜单出现新分支 `test/manual-refresh` |
| 顶部 `mdi-restart` 按钮 | 行为不变（仍刷 viewMode 对应数据） |
| 文件视图下点新 refresh | file browser **不** 刷新（职责分离） |
| 点完瞬间按钮 | `mdi-refresh` 替换为进度环 spinner |
| 加载非 git 项目 | `.git-diff-sidebar-bw` 整段消失，新按钮跟着消失 |

至少完成「默认进入」、「折叠切换」、「外部建分支后刷新」、「顶部 mdi-restart 不变」、「非 git 项目整段消失」这 5 项必检。

- [ ] **Step 5: git status 自检**

```cmd
cd /d F:\github\Astrbot
git status --short
```

预期：clean working tree；本计划 4 个 commit 全部落在本地 `master`，没有未跟踪文件、没有推送记录（`git log origin/master..HEAD` 应空）。

- [ ] **Step 6: 不推送，按 AGENTS.md 收尾**

```cmd
:: 显式验证未推送
cd /d F:\github\Astrbot
git log origin/master..HEAD --oneline
```

预期：空输出。若意外有 commit 显示，**不要** `git push`，回头检查；本计划明确禁止推送远端 / 禁止 PR。
