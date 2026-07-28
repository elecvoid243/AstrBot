# ChatUI 文件夹式项目 × spcode 真实代码项目 整合设计

> **作者**: elecvoid243
> **创建日期**: 2026-07-28
> **状态**: Draft (待用户 review)
> **关联 spec**:
> - spcode 端点契约: `astrbot_plugin_spcode_toolkit/docs/api/v2026-07-28-project-load-silent-frontend.md` (v2.21.1)

---

## 1. 背景与目标

### 1.1 现状

- **ChatUI 文件夹式项目**（`workspace_type ∈ {session, project, custom}`）：仅做"会话分组"语义，不感知代码目录。
  - `session`（默认）：无工作区概念。
  - `project`：当前**没有**"挂代码目录"语义，枚举值存在但无实际行为。
  - `custom`：用户任意目录，挂载到会话但不调 spcode。
- **spcode 真实代码项目**（通过 `/spcode/project-load`）：注入 AGENTS.md、初始化 codegraph、登记 per-umo 状态。
  - 当前 dashboard 只能通过 `ChatInput` 的"加载项目目录"按钮**手动**调一次。
  - 切到别的项目/会话后，**不会**自动重 load。

### 1.2 用户原始需求

> 保留原有的"文件夹"式项目的功能，但允许加载一个实际的代码项目，该文件夹下的所有会话在启动时都会静默执行对应的 `/project load` 行为。

### 1.3 目标

- 保留现有文件夹式项目（`session` / `custom`）的全部行为；
- `workspace_type=project` 升级为"真实代码项目"：项目下任何会话被打开/创建时，前端**静默**调 `POST /spcode/project-load`（不向聊天框 yield 任何 ⏳/❌/✅ 消息）；
- 失败可恢复：spcode 加载失败时只 toast，**不**阻塞 ChatUI 对话；
- 后端 dashboard API 完全向后兼容（旧客户端不传新字段时行为不变）。

### 1.4 非目标

- 不动 spcode 插件任何文件。
- 不动 `/project load` 命令行为。
- 不在 dashboard 引入 worktree 概念。
- 不持久化"用户拒绝自动 load"的偏好。

---

## 2. 已澄清的决策

| 编号 | 决策 | 选择 |
|---|---|---|
| T2 | 触发时机 | 每次进入会话都重试（幂等） |
| F3 | 跨项目 force 策略 | 项目级 `spcode_force` 字段，默认 `false` |
| E2 | 失败兜底 UX | 按 reason 分级：feature_disabled/invalid/path_unsafe → toast；no_project_loaded(force=false)/git_error → toast + 详情 popover |
| U2 | ProjectView 头部展示 | 插入 SpcodeProjectStatusChip（绿/灰/红 + 详情 popover） |
| M1 | 数据迁移 | 零迁移（旧项目 `workspace_type=session` 不触发新逻辑） |
| C1 | 新会话创建时触发 | 走 `currSessionId` watcher 统一管，不在 useMessages 额外挂钩 |

---

## 3. 架构

### 3.1 总览图

```
┌─────────────────────────── ChatUI Dashboard ───────────────────────────┐
│                                                                        │
│  Sidebar (ProjectList)                Main (ProjectView)              │
│  ┌────────────────────┐                ┌──────────────────────────┐   │
│  │ 📁 backend         │  selectProject  │ 📁 backend (project)     │   │
│  │ 📁 frontend  ◀─────│────────────────▶│ ── SpcodeStatusChip ─── │   │
│  │   •  feat/foo  ◀───│──selectSession─▶│ ── ChatInput ────────── │   │
│  │   •  feat/bar      │                │ ── sessions list ────── │   │
│  │ 📁 infra           │                │                          │   │
│  └────────────────────┘                └──────────────────────────┘   │
│            │                                    │                     │
│            │ click                              │ currSessionId ★     │
│            ▼                                    ▼                     │
│      Chat.vue central state (selectedProject, currSessionId)          │
│            │                                                            │
│            │ ★ currSessionId watcher                                    │
│            ▼                                                            │
│   useSpcodeProjectAutoLoad.silentLoad({project, umo})                  │
│            │                                                            │
│            │ POST /spcode/project-load (HTTP)                           │
└────────────┼────────────────────────────────────────────────────────────┘
             │
             ▼
   ┌──── spcode 插件 (跨进程, webapi) ─────────────────┐
   │ POST /spcode/project-load                         │
   │   → ProjectManager.load_impl_silent               │
   │     → agentsmd.init/load + codegraph.init/set     │
   │     → state.put(umo, {directory, loaded_at})     │
   │   → return envelope {success, reason, data}       │
   └───────────────────────────────────────────────────┘
```

### 3.2 核心架构原则

1. **唯一触发器** = `Chat.vue` 中的 `watch(currSessionId, ...)`；项目切换、子会话切换、新会话创建全部汇入这一个 watcher。
2. **spcode 端零修改** — 复用已发布的 `POST /spcode/project-load` 端点。
3. **后端 dashboard 零新接口** — `chatui_projects` 表 +3 列即可，CRUD API 自然回传。
4. **失败优先不阻塞** — E2 分级，ChatUI 对话流永远可继续。

### 3.3 关键不变量

- 任何 `workspace_type !== 'project'` 的项目**不**触发静默 load。
- 任何 `spcode_auto_load=false` 的项目**不**触发。
- 静默 load **绝不**向 `ChatMessageList` 写任何用户消息。
- spcode 端 `state[umo]` 维度是 per-session；前端负责把"项目级"语义降级为"对每个 session umo 调一次"。

---

## 4. 组件与文件清单

### 4.1 后端（5 个文件）

| # | 文件 | 改动 | 行数估计 |
|---|---|---|---|
| B1 | `astrbot/core/db/po.py` | `ChatUIProject` 加 3 个 `bool` 列 | +12 |
| B2 | `astrbot/core/db/sqlite.py` | `create_chatui_project` / `update_chatui_project` 加 3 个参数 | +24 |
| B3 | `astrbot/dashboard/schemas.py` | `ChatProjectRequest` 加 3 个字段 | +6 |
| B4 | `astrbot/dashboard/services/chatui_project_service.py` | 透传 + `_serialize_project` 输出 + `_normalize_workspace_config` 对 `project` 类型强校验 | +30 |
| B5 | `tests/unit/test_chatui_project_service.py` | 新增 `workspace_type='project'` 的路径校验 / 序列化测试 | +60 |

**数据库迁移**：用 SQLModel `metadata.create_all` 增量 + 启动时 `try add_column` 兜底（不引入 alembic）。

### 4.2 前端（7 个文件改动 + 2 个新文件）

| # | 文件 | 改动 | 行数估计 |
|---|---|---|---|
| F1 | `dashboard/src/components/chat/ProjectList.vue` | `Project` interface +3 字段 | +6 |
| F2 | `dashboard/src/components/chat/ProjectDialog.vue` | 新增"挂载到代码目录"UI 区 + 3 个新 form 字段 + canSave 校验 | +80 |
| F3 | `dashboard/src/composables/useSpcodeProjectAutoLoad.ts`（**新**） | 静默 load 封装，含 inflight mutex + 幂等适配 | +120 |
| F4 | `dashboard/src/components/chat/ProjectView.vue` | 头部插入 `SpcodeProjectStatusChip`（只读展示） | +30 |
| F5 | `dashboard/src/components/chat/SpcodeProjectStatusChip.vue`（**新**） | 状态条 UI（绿/灰/红 + 详情 popover） | +100 |
| F6 | `dashboard/src/components/chat/Chat.vue` | 引入 `useSpcodeProjectAutoLoad` + `currSessionId` watcher + 失败 toast 接入 | +60 |
| F7 | `dashboard/src/api/v1.ts` | `chatApi.createProject` / `updateProject` payload 类型自动重生成（`pnpm generate:api`） | 0 |
| F8 | i18n `dashboard/src/i18n/zh-CN/features/chat.json` | 新增 `project.spcode.*` 文案键 | +15 |
| F9 | 单测 `dashboard/src/composables/__tests__/useSpcodeProjectAutoLoad.spec.ts`（新） | 覆盖：成功 / 幂等 / 失败分级 / inflight 串行 | +150 |

**总计 ~10 个文件改动 + 2 个新文件**。

### 4.3 关键组件职责

- **`Chat.vue`**: 新增 1 个 watcher + 1 个 helper（`tryAutoLoadSpcodeForSession`）。
- **`useSpcodeProjectAutoLoad.ts`**: 纯逻辑 composable，封装 `silentLoad`、inflight mutex、幂等适配。
- **`SpcodeProjectStatusChip.vue`**: 纯展示组件，订阅 `useSpcodeProjectStatus` 同一 umo。
- **`ProjectView.vue`**: 改 1 处，插入 `<SpcodeProjectStatusChip :umo="currentUmo" :workspace_path="project.workspace_path" />`。
- **`ProjectDialog.vue`**: 改 1 区，`workspace_type === 'project'` 时显示路径输入 + 3 个 v-switch。

### 4.4 明确不改动

- ❌ spcode 插件任何文件
- ❌ `ChatMessageList.vue` / 消息渲染
- ❌ `useSpcodeProjectLoad.ts`（管"加载项目"按钮可见性）
- ❌ `useSpcodeProjectStatus.ts`（直接复用）
- ❌ 不引入新 webapi 路由
- ❌ 不在 dashboard 加 worktree 概念

---

## 5. 数据模型

### 5.1 `ChatUIProject`（astrbot/core/db/po.py）

```python
class ChatUIProject(TimestampMixin, SQLModel, table=True):
    __tablename__: str = "chatui_projects"

    inner_id: int | None = Field(primary_key=True, default=None)
    project_id: str = Field(max_length=36, nullable=False, unique=True,
                            default_factory=lambda: str(uuid.uuid4()))
    creator: str = Field(nullable=False)
    emoji: str | None = Field(default="📁", max_length=10)
    title: str = Field(nullable=False, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    workspace_type: str = Field(default="session", nullable=False, max_length=32)
    workspace_path: str | None = Field(default=None, max_length=1024)

    # 新增字段（仅 workspace_type='project' 时使用）
    spcode_auto_load: bool = Field(default=True, nullable=False)
    """若 True,该 project 下的会话被打开/创建时,前端会静默
    POST /spcode/project-load(directory=workspace_path, umo=...)"""

    spcode_force: bool = Field(default=False, nullable=False)
    """静默 load 时若 umo 已加载其他项目,是否强制覆盖。"""

    spcode_no_codegraph: bool = Field(default=False, nullable=False)
    """挂载时跳过 codegraph(只 load AGENTS.md,适合轻量场景)。"""

    __table_args__ = (
        UniqueConstraint("project_id", name="uix_chatui_project_id"),
    )
```

### 5.2 字段语义表

| `workspace_type` | `workspace_path` 含义 | 触发静默 spcode load |
|---|---|---|
| `session`（默认） | 无意义（创建时被强制置 null） | ❌ |
| `project` | **绝对代码目录**，spcode project load 的目标 | ✅（当 `spcode_auto_load=true`） |
| `custom` | 用户任意目录，挂载到会话但不调 spcode | ❌ |

### 5.3 兼容性

- 已有项目 `workspace_type` 均为 `session`，新字段默认值对新行为无影响，**零回归**。
- `workspace_type='project'` 的语义**唯一变化**：原仅"挂项目名" → 现"挂代码目录"。

---

## 6. 数据流

### 6.1 端到端时序（成功路径）

```
User → click ProjectList 项目行
  → Chat.vue: selectedProjectId=X, currSessionId=""
  → loadProjectSessions(X)
  → ProjectView 渲染

User → click ProjectView 内子会话
  → Chat.vue: selectProjectSession(cid)
    → selectedProjectId=null
    → selectSession(cid) → currSessionId=cid
      → watch(currSessionId) 触发
        → selectedProject=X 存在
        → X.workspace_type='project'
        → X.spcode_auto_load=true
        → tryAutoLoadSpcodeForSession(umo)
          → silentLoad({project:X, umo})
            → POST /spcode/project-load
              → 4 步流水线 (agentsmd init/load + codegraph init/set)
              → state.put(umo, {directory, loaded_at})
            → return {success: true, data: {...}}
          → spcodeStatus.refresh(umo)  ← 顶部 chip 同步
```

### 6.2 触发矩阵

| 用户操作 | watch currSessionId 触发 | watcher 内是否 load |
|---|---|---|
| 点项目行 | 是（被清空 ""） | ❌（`next==""` 提前 return） |
| 点子会话 | 是 | ✅ |
| 在项目下 ChatInput 发消息创建新会话 | 是（C1 确认） | ✅ |
| 从项目切到非项目会话 | 是 | ❌（`selectedProject.value==null`） |
| 从一个项目切到另一个项目 | 是（通过子会话） | ✅（selectedProject 已是新项目） |
| 刷新页面 | 是（router 重新计算） | ✅ |
| ProjectDialog 保存修改项目 | 否（currSessionId 不变） | ❌（下次切会话自然重 load） |

### 6.3 静默 load 内部时序（useSpcodeProjectAutoLoad）

```
silentLoad({project, umo, signal})
  │
  ├─ project.workspace_type !== 'project'      → return null
  ├─ project.spcode_auto_load === false         → return null
  ├─ !project.workspace_path                    → return null
  │
  ├─ if (inflight.has(key)) return inflight.get(key)   ← per-(project,umo) 串行化
  │
  ├─ inflight.set(key, (async () => {
  │     let resp = await tryPost({directory, umo, force: project.spcode_force, ...})
  │     │
  │     ├─ resp.success === true
  │     │   → return resp.data
  │     │
  │     ├─ resp.reason === 'no_project_loaded'
  │     │     ├─ resp.data.previous_directory === project.workspace_path
  │     │     │   → 视为幂等成功, return { ...resp.data, loaded: true }
  │     │     │
  │     │     ├─ 不一致 && project.spcode_force === true
  │     │     │   → 再 POST 一次 { force: true }
  │     │     │   → 仍失败则 throw new ProjectLoadError(reason, data)
  │     │     │
  │     │     └─ 不一致 && project.spcode_force === false
  │     │         → throw new ProjectLoadError(reason, data)  // toast 提示
  │     │
  │     └─ 其他 reason
  │         → throw new ProjectLoadError(reason, data)
  │   })())
  │
  └─ try { return await inflight.get(key) } finally { inflight.delete(key) }
```

### 6.4 与现有 Chat.vue 协作点

| 现有代码 | 我们的改动 |
|---|---|
| `import { useSpcodeProjectStatus } from "@/composables/useSpcodeProjectStatus";` | 同文件加 `import { useSpcodeProjectAutoLoad } from "@/composables/useSpcodeProjectAutoLoad";` |
| `const spcodeStatus = useSpcodeProjectStatus();` | 同位置加 `const { silentLoad } = useSpcodeProjectAutoLoad();` |
| 已有 `watch(currSessionId, async (next) => { ... })` 块 | **不**改这块（管 spcodeStatus.refresh / reset），**新增**另一块 watch 专门管 auto-load |
| `useToast()` | 调用 `toast.error(...)` 走 E2 分级 |

---

## 7. 错误处理

### 7.1 E2 分级错误处理（按 reason）

| `reason` | 严重度 | UI 反应 | 阻塞 ChatUI | toast 文案 | 状态条 |
|---|---|---|---|---|---|
| `invalid_body` | 内部 bug | toast error | ❌ | "项目加载失败: invalid_body" | 红 + popover |
| `invalid_param` | 内部 bug | toast error | ❌ | "项目加载失败: invalid_param" | 红 + popover |
| `feature_disabled` | 用户配置 | toast warn | ❌ | "spcode 功能未启用,已跳过自动加载" | 灰 + 提示"功能未启用" |
| `no_project_loaded` + 不一致 + `spcode_force=false` | 用户策略冲突 | toast warn | ❌ | "已加载其他项目 X,未切换到 Y" | 红 + popover（显示 previous_directory） |
| `no_project_loaded` + 一致 | 幂等 | （无 toast） | ❌ | — | 绿（status 刷新） |
| `no_project_loaded` + `spcode_force=true` + 重发后仍失败 | 极端 | toast error | ❌ | "强制切换失败" | 红 + popover |
| `path_unsafe` | 路径问题 | toast error | ❌ | "项目路径不允许" | 红 + popover |
| `git_error` | 子系统故障 | toast error + popover 详情 | ❌ | "项目加载失败,详情见状态条" | 红 + popover（含 substep_messages 末尾 ❌ 行） |
| 网络错误 / 30s timeout | 基础设施 | toast warn | ❌ | "spcode 服务无响应" | 灰 + "未连接" |

**总原则**：**任何** 失败都**不**抛到 `ChatMessageList`，**不**弹模态确认框，**不**禁用 ChatInput。

### 7.2 边界场景

| # | 场景 | 行为 |
|---|---|---|
| Q1 | 项目刚创建，还没进任何会话 | 状态条 `umo=null` → 渲染"未选择会话"占位文字（灰色），不发起请求 |
| Q2 | 用户在项目视图里发消息前就把 ChatInput 切到另一个非项目会话 | watcher 触发但 `selectedProject.value==null` → return。spcode state 中该项目 umo 记录**保留** |
| Q3 | 项目路径在创建后被用户在文件系统层面删除/重命名 | 下次切入会话 → silent load 失败 `path_unsafe` 或 `git_error`。**不**自动禁用项目 |
| Q4 | spcode 插件未安装 / 未启用 | 走 7.1 toast 路径，状态条变红，不阻塞 |
| Q5 | `agentsmd_enabled=false` / `codegraph_enabled=false` | 返回 `feature_disabled` → toast 提示 |
| Q6 | 用户连续快速点 3 个不同项目 | selectedProjectId 变化不影响 currSessionId；watcher 不触发。**用户最终必点子会话** |
| Q7 | inflight 复用 | inflight 键按 `(project_id, umo)` 区分，不共享单 mutex（用 `Map<string, Promise<...>>`；同 `(project, umo)` 并发复用同一 promise，不同 `(project, umo)` 互不阻塞） |
| Q8 | 创建新会话时 watcher 与 LLM 消息并行 | 0.5-5s 内并行，对话流不污染 |
| Q9 | 编辑项目路径后当前会话已 load 旧目录 | watcher 不触发；用户需切出会话再切回才能重 load |
| Q10 | spcode 端 per-umo state 在用户登出后 | 不清理；前端 `spcodeStatus.reset()` 在 `currSessionId=""` 时已 reset |

### 7.3 超时

- `fetch` + `AbortController` + 30s timeout。
- 超时 → 走"网络错误"路径，toast warn，**不**抛。

### 7.4 项目删除的副作用

- `deleteProject` 时 DB 级联清理 `session_project_relations`（已有逻辑）。
- spcode 端 `state[umo]` **不**清理。
- **接受**此行为；可选优化（`deleteProject` 调 `POST /spcode/project-unload`）留作后续。

---

## 8. 测试计划

### 8.1 后端单元测试（`tests/unit/test_chatui_project_service.py`）

| # | 用例 | 期望 |
|---|---|---|
| UT-1 | 创建 `workspace_type='project'` + `workspace_path='/non/existent'` | 抛 `ChatUIProjectServiceError("Custom workspace path does not exist")` |
| UT-2 | 创建 `workspace_type='project'` + 合法绝对路径 | 成功；`spcode_auto_load` 默认 `True` |
| UT-3 | 创建 `workspace_type='session'` 显式带 `workspace_path` | 服务层把 `workspace_path` 置 None |
| UT-4 | 更新项目仅传 `spcode_force=True` | DB 列更新，其他字段保留 |
| UT-5 | 序列化项目回传新字段 | dict 包含 3 个 spcode 字段 |
| UT-6 | 创建者权限校验 | 越权访问 `_get_owned_project` 抛 `Permission denied` |

### 8.2 前端单元测试（`useSpcodeProjectAutoLoad.spec.ts`）

| # | 用例 | 期望 |
|---|---|---|
| FT-1 | `silentLoad` 对 `workspace_type='session'` | 立即 `return null` |
| FT-2 | `silentLoad` 对 `spcode_auto_load=false` | `return null` |
| FT-3 | `silentLoad` 成功 | 返回 `data`，`pluginExtensionApi.post` 被调 1 次 |
| FT-4 | `silentLoad` 收到 `no_project_loaded` + 目录一致 | 视为成功，`data.loaded=true`，**不**重试 |
| FT-5 | `silentLoad` 收到 `no_project_loaded` + 不一致 + `spcode_force=true` | 第 2 次请求带 `force=true` |
| FT-6 | `silentLoad` 收到 `no_project_loaded` + 不一致 + `spcode_force=false` | 抛 `ProjectLoadError('no_project_loaded', data)` |
| FT-7 | `silentLoad` 收到 `git_error` | 抛 `ProjectLoadError('git_error', data)` |
| FT-8 | `silentLoad` 收到 `feature_disabled` | 抛 `ProjectLoadError('feature_disabled', data)` |
| FT-9 | inflight 串行化：同 `(project, umo)` 两次并发 | 只发 1 次请求 |
| FT-10 | inflight 隔离：不同 `project` 的并发 | 各发各的，不阻塞 |
| FT-11 | 网络超时（30s）| 抛 `ProjectLoadError('network_timeout', ...)` |

### 8.3 前端组件测试

| # | 组件 | 用例 | 期望 |
|---|---|---|---|
| FC-1 | `ProjectDialog` | workspace_type 切到 'project' | 显示代码目录区 |
| FC-2 | `ProjectDialog` | `workspace_type='project'` + `workspace_path` 空 | "保存" 按钮 disabled |
| FC-3 | `ProjectDialog` | `spcode_force` 切换 | v-model 正确 |
| FC-4 | `SpcodeProjectStatusChip` | 加载中 | spinner + "加载中..." |
| FC-5 | `SpcodeProjectStatusChip` | 成功 | 绿勾 + 目录 + loaded_at |
| FC-6 | `SpcodeProjectStatusChip` | 失败 | 红 + 错误图标 + popover 展开 substep_messages |
| FC-7 | `SpcodeProjectStatusChip` | `umo=null` | 灰 + "未选择会话" |

### 8.4 端到端测试

| # | 场景 | 期望 |
|---|---|---|
| E2E-1 | 创建 `project` 类型项目 + 路径 + 3 个开关默认 | 成功创建 |
| E2E-2 | 进入该项目 → 点子会话 | 状态条变绿（≤2s），chip "已加载" 亮 |
| E2E-3 | 同上 + 关掉 spcode 插件 | 状态条变红，popover "feature_disabled"；对话流正常 |
| E2E-4 | 创建 `session` 类型项目（旧逻辑回归） | 走原流程，**不**触发静默 load |
| E2E-5 | 在项目 A 加载后切到项目 B（不重叠会话） | 按 spcode_force 决定是否覆盖 |
| E2E-6 | 旧项目（迁移前创建） | 仍按 `workspace_type=session` 工作，零回归 |
| E2E-7 | 极端：用户连续点 5 个项目 | 状态条最终显示最近进入的项目；spcode state 一致 |
| E2E-8 | 编辑项目路径后再切入会话 | 状态条按新路径重 load |

### 8.5 回归保护清单

| 回归点 | 保护手段 |
|---|---|
| `SessionProjectRelation` 唯一约束 | E2E-4 验证 |
| `workspace_path` 路径校验 | UT-1/UT-2 复测 |
| `useSpcodeProjectStatus` 现有 chip 行为 | 不动该 composable；FC-4~6 验证新 chip 与它一致 |
| `useSpcodeProjectLoad`（"加载项目"按钮） | 不动该 composable；E2E-1 验证按钮仍正常 |
| spcode 端 `_silent_unload` 的 force 行为 | 不动 spcode；E2E-5 验证 |

---

## 9. 不在本方案范围

- ❌ spcode 端 `load_impl_silent` 本身（已有测试）
- ❌ 跨浏览器一致性（M1 不做迁移；旧项目无新字段）
- ❌ 性能压测（spcode load 0.5-5s 已在 spcode 文档描述）
- ❌ 国际化文案完整性（仅 zh-CN）
- ❌ 项目删除时联动 unload spcode state（留作后续优化）
- ❌ 手动 reload 按钮（属于 spcode 命令范畴 `/project reload`，另起 spec）
- ❌ 状态条上"快速切换项目"按钮（同上）

---

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 旧 DB 缺新列 | 启动时 `try add_column` 兜底 |
| 切会话高频率触发 load 写 state | per-(project,umo) `Map` mutex + 幂等适配 |
| spcode 插件未启用 / 功能未启用 | 端点已校验 `feature_disabled` 失败，dashboard 捕获 → toast，不阻塞 |
| 跨项目切换时目录不一致 | `spcode_force` 字段用户配置 + 客户端"目录一致 = 成功"适配 |
| `workspace_type='project'` 但 `workspace_path` 是相对路径 | 后端 `Path.resolve()` 后断言 `is_dir()` |
| 网络中断 | 30s timeout，AbortController，错误走 toast |
| 并发：静默 load 未完成时切到别的项目 | inflight key per-(project,umo) 隔离 |
| 跨平台路径（Windows / macOS / Linux） | 后端 `Path.resolve()` + spcode 端 `is_path_safe` 跨平台校验 |

---

## 11. 变更历史

| 日期 | 版本 | 作者 | 改动 |
|---|---|---|---|
| 2026-07-28 | v0.1 (draft) | elecvoid243 | 初版（brainstorming 阶段产物，待用户 review） |
