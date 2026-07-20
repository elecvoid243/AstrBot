# Design: 工作区 Recent Files — 最近打开文件列表

> Author: elecvoid243 · 2026-07-20
> Status: approved (brainstorming session 2026-07-20, 选项 a：Files view 顶部嵌入 + 默认折叠)
> Scope: dashboard only（纯前端，无后端/插件改动）

## 修订记录

- **2026-07-20 v2 (recent-files-unify)**：用户反馈「文件管理」tab 在切换目录后会被
  重新记录（「工作区」tab 反而保持不变），体验割裂。决议：**改回单一全局桶**，
  与当前用户所在目录无关；上限由 50 收紧到 **5**；第 6 个写入自动丢弃最早一条。
  本次修订只影响 §3（composable 职责）、§4（数据模型 / 存储 / 容量 / 写入规则）、
  §6.1（接线点）和 §10.1（composable 测试）。其他章节（UI、错误处理、i18n、测试）保持。

## 1. 目标

在工作区文件浏览器（Files view）里提供「最近打开文件」的可视化列表，
让用户能快速回到上次没看完的代码文件，无需重新导航目录。

非目标（YAGNI，**明确放弃**避免范围蔓延）：
- **不做 Pinned Files（pin/star 功能）**
- **不做 Quick Open 集成**（属 A1；本次只暴露 composable 给将来 A1 复用）
- **不做「文件不存在自动 prune」**——现有 FileBrowserView 路径已能报错，先让用户撞错再说
- **不做服务端同步 / 多端共享**（4.x 路线）
- **不持久化折叠状态**——每次进入 sidebar 默认折叠（与 sidebar 内已有 fullscreen 不持久化策略一致）
- **不暴露容量上限配置**（写死 50 条；不在 UI 暴露「Clear All」之外的高级项）

## 2. 方案（已选）

新增一个 composable（数据层）+ 一个组件（UI 层），在 `FileBrowserView`
左栏 FileTreeList **顶部**嵌入一个**默认折叠**的 Recent Files 块。

被否方案：
- **B（viewMode 加第 5 个 tab "Recent"）**—— 占用顶部 tab 资源，
  与现有 files/diff/history/docs 抢位置；浏览文件阶段用户不会主动切到它。
- **C（只做 store/composable，UI 完全留给 A1 Quick Open）**—— A1
  还没排期，价值兑现被无限推迟；当前 sidebar 完全有能力容纳一个轻量折叠块。

## 3. 组件与职责

| 单元 | 路径 | 职责 |
|---|---|---|
| `useRecentFiles` composable | `dashboard/src/composables/useRecentFiles.ts`（新） | 纯数据：读 / 删 / 清、**单一全局桶**（不再按 worktree 分桶）、**5 条上限**、同 path 去重；不感知 sidebar |
| `<RecentFilesBlock>` 组件 | `dashboard/src/components/chat/message_list_comps/RecentFilesBlock.vue`（新） | 纯 UI：折叠块、列表、× 按钮、Clear 链接、empty 占位 |
| `GitDiffSidebar.vue`（增） | 同文件 | 一个 `watch` 做 recordOpen；把 `<RecentFilesBlock>` 透传给 `FileBrowserView` |
| `FileBrowserView.vue`（增） | 同文件 | 在左栏 FileTreeList 上方嵌入 `<RecentFilesBlock>`；接收 currentRoot + recents props |

边界（KISS）：
- composable **不接收参数**，输出 `{ entries, recordOpen, remove, clear }`——纯全局
  数据层，与 sidebar / 当前 worktree / 当前目录完全无关
- RecentFilesBlock 接收 `{ entries }` props + `select`/`remove`/`clear` 事件——不耦合
  composable 实现
- 两个单元可独立阅读与单元测试

## 4. 数据模型

```ts
type RecentEntry = { path: string; openedAt: number /* unix ms */ };

interface RecentBucket { entries: RecentEntry[]; }
```

### 4.1 存储

- `localStorage["spcode.recentFiles.global"] = JSON.stringify(RecentBucket)`
- **单一全局桶**：不按 worktree / project root 分桶，key 是固定常量
- 复用 sidebar 现有的 `safeGetItem` / `safeSetItem`；JSON.parse 包 try/catch

### 4.2 容量与排序

- 全局 **5 条上限**（克制，UI 折叠块最多显示 5 行，存储与显示 1:1，避免
  「+N more」永远看不到的悬空数据）
- LIFO：按 `openedAt` 倒序排列；列表头 = 最新
- 溢出按 `openedAt` 升序丢弃旧条目；第 6 个写入自动丢弃最早一条

### 4.3 写入规则（`recordOpen(path)`）

```
recordOpen(path):
  if !path or !path.trim():                  return  // 空 path 静默忽略
  bucket = loadBucket()
  bucket.entries = bucket.entries.filter(e => e.path !== path)  // 去重
  bucket.entries.unshift({ path, openedAt: Date.now() })         // LIFO
  bucket.entries = bucket.entries.slice(0, MAX_ENTRIES)         // trim
  saveBucket(bucket)
```

### 4.4 删除 / 清空

- `remove(path)`: filter 该 path → 持久化（频度低，无 debounce）
- `clear()`: 将 `entries = []` → 持久化
- `clear` 在 UI 层需二次确认（不强制，但 spec 要求有 confirm dialog）

### 4.5 跨目录 / 跨 worktree 行为

- **不**做隔离：无论用户切到哪个 worktree / project root，最近文件列表
  保持一致；写入按 LIFO 规则落到同一桶
- 切换目录后不重新读取 / 不重建桶；RecentFilesBlock 通过 prop 接收 `entries`，
  不会因为目录变化而丢弃现有数据

## 5. UI（`<RecentFilesBlock>`）

### 5.1 默认态：折叠

```
┌────────────────────────────────────┐
│ ⏱  Recent Files (3)             ▸ │
└────────────────────────────────────┘
```

- 标题含条目数；chevron 指示折叠方向
- 点击整行（标题栏）→ 展开

### 5.2 展开态

```
┌───────────────────────────────────────────┐
│ ⏱  Recent Files (8)             Clear  ▾  │
│ ───────────────────────────────────────── │
│  📄  README.md                       ×   │
│      docs/                                  │
│  📄  main.py                           ×   │
│      src/                                   │
│  📄  schema.sql                         ×   │
│      migrations/                            │
│  📄  routes.ts                          ×   │
│      src/api/                               │
│  📄  app.pyx                            ×   │
│      src/                                   │
│  + 3 more →                                 │
└───────────────────────────────────────────┘
```

- 顶部标题栏：
  - 左：`⏱ Recent Files (count)`
  - 右：`Clear` 文本链接（点击 → 二次确认 dialog）
  - 点击空白处 → 折叠
- 默认**最多显示前 5 条**；超出显示 `+{N} more →`
- `+N more` 行为：未来接 A1 Quick Open（按住 Ctrl+P）；本次点击弹 toast：
  `按住 Ctrl+P 快速跳转所有文件`
- 每行结构（2026-07-20 字号与文件列表一致）：
  - mdi-clock-outline icon（与目录树 file-icon 同套）
  - **basename**（主色，12.5px，与 `FileBrowserEntryList` 主条目字号一致），父目录显示**项目相对路径**（淡色 10.5px，与 `FileBrowserEntryList` 元信息字号一致；不带 worktree 前缀；整体不可换行省略）
  - hover 整行背景轻高亮 + 右端出现 × icon 按钮
- 每行点击 → `select` 事件 → FileBrowserView 复用既有 `navigateToFile(path)` 路径
- × 按钮点击 → `remove` 事件（不冒泡到行点击；用 `event.stopPropagation`）
- 空列表（在 worktree 已绑但无历史）：显示居中淡灰文字「无最近文件」

### 5.3 折叠状态不持久化

每次 sidebar 实例 mount → RecentFilesBlock 默认折叠，不读写 localStorage。
（保持 session 轻启动；用户主动 toggle 是临时偏好，不跨会话保留。）

### 5.4 与现有 UI 的一致性

- 折叠块风格沿用 sidebar 内既有 `.section-header` 视觉（FileTreeList / DocumentTreePanel 顶栏）
- icon 用 `mdi-clock-outline` 与 `mdi-file-outline`，全部已在 `@mdi/font` subset 内（构建时已处理 subset）
- Clear 链接、`+N more`、× 按钮沿用 Vuetify `variant="text"` + `density="compact"`
- 字号与 `FileBrowserEntryList` 完全一致（行 12.5px / 元信息 10.5px / header 12.5px），不喧宾夺主
- 路径展示：用 `projectRelativePath(absPath, currentRoot)` 把绝对路径转项目相对路径再显示，让用户一眼能定位该文件在仓库中的位置

### 5.5 文档管理页面也挂同一个组件

`DocumentManager.vue` 在 DocumentTreePanel **上方**挂同一个 `<RecentFilesBlock>`：

- 入参：
  - `entries` = `recentFiles.entries` 过滤掉**不在 docs 子树**的项（用 `pathUtils.isPathInDocsRoot` 判断）。这样用户在 workspace FileBrowserView 打开的 `.py` 不会污染文档管理的"最近文档"列表。
  - `currentRoot` = `props.projectRoot`（与 FileBrowserView 同一字符串，保证 localStorage bucket key 一致 → 同一 worktree 的两条记录合并）
- 事件：
  - `select` → DocumentManager 把 absolute path 转 docsRoot-relative（用 `docsRootRelativePath`）→ 走既有的 `onTreeSelect(rel)` 路径（dirty edit 检查 + reset viewMode / editMode / editBuffer）
  - `remove` → `recentFiles.remove(absPath)`，从 bucket 移除
  - `clear` → 打开同款二次确认 dialog，确认后调 `recentFiles.clear()`
- recordOpen 也镜像：DocumentManager 监听 `(selectedDoc, docsRoot, projectRoot)` 的变化，把 `absoluteFromSelectedDoc(...)` 结果喂给 `recentFiles.recordOpen()`，让"在文档管理打开一个 .md"也写入同一 bucket

## 6. 接线点

### 6.1 `GitDiffSidebar.vue` 新增

```ts
import { useRecentFiles } from "@/composables/useRecentFiles";

// 2026-07-20 v2: 单一全局桶，composable 不再接参数
const recentFiles = useRecentFiles();

// 打开文件 → 记录。null write（关闭 preview / 切换 worktree）跳过。
// 不再校验 path 与 currentRoot 的包含关系——桶是全局的。
watch(
  () => fileBrowserPreviewPath.value,
  (newPath) => {
    if (!newPath) return;
    recentFiles.recordOpen(newPath);
  },
);
```

并把 `<RecentFilesBlock>` 经由新增 props 透传到 `FileBrowserView`：
- `:recent-entries="recentFiles.entries.value"`
- `clear-recent-open` dialog state + handler

### 6.2 `FileBrowserView.vue` 新增

```vue
<template>
  <div class="file-browser-left">
    <RecentFilesBlock
      v-if="rootPath"
      :entries="recentEntries"
      @select="onRecentSelect"
      @remove="onRecentRemove"
      @clear="confirmClearRecentOpen = true"
    />
    <!-- 既有的 <FileTreeList> 保持不变，紧接其后 -->
  </div>
</template>
```

> 2026-07-20 v2：移除 `:current-root` 透传——全局桶下，组件不再关心当前根目录。

`onRecentSelect(path)`：走既有 `navigateToFile(path)` / 等价于 `setSearchTarget(path)`：
将 `fileBrowserPreviewPath = path` + `fileBrowserCurrentPath = dirOf(path)`，
触发 FileBrowser 既有 fetch 流程。
`onRecentRemove(path)`：调 composable `remove(path)`（props 已传 ref，自取）。

### 6.3 二次确认（Clear）

复用 sidebar 既有 `v-dialog` 模式（与现有 delete-file / restore-confirm 同形）：

```vue
<v-dialog v-model="confirmClearRecentOpen" max-width="420">
  <v-card>
    <v-card-title class="text-h3 pa-4 pb-0 pl-6">
      {{ tm("spcodeProjectLoad.fileBrowser.recentFiles.clearConfirmTitle") }}
    </v-card-title>
    <v-card-text class="pt-4">
      {{ tm("spcodeProjectLoad.fileBrowser.recentFiles.clearConfirmMessage") }}
    </v-card-text>
    <v-card-actions class="pa-4 pt-0">
      <v-spacer />
      <v-btn variant="text" @click="confirmClearRecentOpen = false">
        {{ tm("spcodeProjectLoad.fileBrowser.editor.cancel") }}
      </v-btn>
      <v-btn variant="text" color="error" @click="onConfirmClearRecent">
        {{ tm("spcodeProjectLoad.fileBrowser.recentFiles.clear") }}
      </v-btn>
    </v-card-actions>
  </v-card>
</v-dialog>
```

## 7. 状态与边界

| 情况 | 处理 |
|---|---|
| 初次挂载、localStorage 无桶 | `entries` 为 `[]`；UI 显示「无最近文件」占位 |
| 同 path 重复 recordOpen | 去重 + 更新 `openedAt` → 移到头部 |
| localStorage 抛错（quota / 私密浏览） | `safeSetItem` 已 silent catch；Recent 退化为 no-op |
| localStorage 返回非法 JSON | `loadBucket` 内 `try/catch` 返回空 entries |
| 跨 worktree / 跨目录切换 | 桶不切；列表对所有视图可见 |
| 5 条溢出（第 6 个写入） | `slice(0, 5)`，超出按 `openedAt` 升序丢弃 |
| 点击 Recent 里已被删/改名文件 | 走 FileBrowserView 既有 reason → error 占位 |
| 当前 preview 打开的是 `null` | watch 早返，不记录 |
| `recordOpen` 收到空字符串 / 纯空格 | 静默忽略，不污染桶 |

## 8. 错误处理

| 场景 | 表现 |
|---|---|
| localStorage 写入失败 | silent no-op，主流程不受影响 |
| localStorage 读取返回非法 JSON | 视为空 entries，不抛错 |
| `recordOpen` 传入空 path | 静默忽略 |

## 9. i18n

新增键全部挂在 `spcodeProjectLoad.fileBrowser.recentFiles.*`：
- `title` = "Recent Files"
- `titleWithCount` = "Recent Files ({count})"
- `empty` = "无最近文件"
- `more` = "+{n} more"
- `clear` = "清空"
- `clearConfirmTitle` = "清空最近文件"
- `clearConfirmMessage` = "确定要清空当前工作区的所有最近打开文件吗？此操作不影响其他工作区。"
- `removeTooltip` = "从最近文件移除"
- `quickOpenToast` = "按住 Ctrl+P 快速跳转所有文件"

双语同步更新到 `dashboard/src/i18n/zh-CN/...` 与 `en-US/...`。

## 10. 测试

### 10.1 Composable（`useRecentFiles.spec.ts`）

| 用例 | 期望 |
|---|---|
| 空桶初始化 → recordOpen 1 条 | entries 长度 1，openedAt≈now |
| recordOpen 后 entries 顺序 | 新条在 `[0]` |
| 重复 recordOpen 同一 path | entries 长度不变，openedAt 更新，位置在头 |
| 累积 6 条后 recordOpen | entries 长度 5，最旧的被丢弃 |
| recordOpen 空 / 纯空格 path | 无变化（no-op） |
| 两个 composable 实例读写同一桶 | 两边 `entries` 实时一致 |
| 不同目录 / worktree 路径写入同一桶 | 不分桶，按 LIFO 排序 |
| remove 单条 | entries 移除该 path，持久化 |
| clear | entries 长度 0，持久化 |

### 10.2 Component（`RecentFilesBlock.spec.ts`）

| 用例 | 期望 |
|---|---|
| 默认 mount → 显示折叠态 | 看到 `(count)` 标题，不显示列表行 |
| 点击标题 → 展开列表 | 5 条行渲染，超出显示 `+N more` |
| 点击 × 按钮 → remove 事件 + 不冒泡到 select | emit('remove', path) 被调用一次 |
| 点击行 → select 事件 | emit('select', path) 被调用一次 |
| 点击 Clear 链接 → clear 事件 | emit('clear') |
| entries=[] 展开态 | 显示「无最近文件」占位 |
| currentRoot 变更 | 标题前缀/路径显示相应更新 |

## 11. 改动清单

1. `dashboard/src/composables/useRecentFiles.ts`（新，~90 行）
2. `dashboard/src/components/chat/message_list_comps/RecentFilesBlock.vue`（新，~120 行）
3. `dashboard/src/components/chat/GitDiffSidebar.vue`（增 ~6 行：import + watch + props 透传）
4. `dashboard/src/components/chat/message_list_comps/FileBrowserView.vue`（增 ~10 行：嵌入块 + 事件接线 + dialog 状态）
5. `dashboard/tests/composables/useRecentFiles.spec.ts`（新）
6. `dashboard/tests/components/RecentFilesBlock.spec.ts`（新）
7. `dashboard/src/i18n/{zh-CN,en-US}/...`（新增 9 个键的双语 entry）
8. **无新增 package.json 依赖**

## 12. 元信息

- 估计代码量：~180 行净增（composable ~90 + 组件 ~120 - import/空行）
- 不改变现有 sidebar API 形态
- 不引入新 npm 依赖
- 浏览频次：用户每次打开文件后立即被记录；UI 默认折叠后零首屏干扰
- 为将来的 A1 Quick Open 准备好 composable 接口
