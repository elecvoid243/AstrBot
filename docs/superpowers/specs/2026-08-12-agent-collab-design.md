# Agent Collab — 跨会话 Agent 协作设计文档

- Author: elecvoid243
- Date: 2026-08-12
- Status: Approved (brainstorming concluded, pending implementation plan)
- Branch: `feat/agent-collab`

## 1. 目标与范围

用户可以在 dashboard chat 页面将多个 **webchat 会话**绑定为一个协作组，发起一场「讨论」：组内各会话的 agent 依次接收彼此的输出并进行回应。每个 agent 的思考内容、流式输出、工具调用在**该会话自己的 chat 页面**和**协作面板的聚合时间线**中都实时可见。若目标会话正忙（存在活跃 run），路由器不向其投递，消息挂起为 pending，待其空闲后自动投递。

### 明确的范围决策（已与用户确认）

| 决策点 | 结论 |
|---|---|
| 可绑定会话范围 | 仅 webchat 会话（外部平台会话不支持实时可见性，不做） |
| 交互拓扑 | 主持人路由（星型）：**组内指定一个会话的 agent 兼任主持人**，所有回复先回给主持人，由主持人决定下一站（支持点对点，其他 agent 不发言）；**组内仅 2 个会话时退化为一问一答**，无路由指令，主持人保留 `end` 指令终止权 |
| 观察入口 | chat 页面内新增「协作面板」聚合时间线；各会话页面实时可见为既有能力，零改动 |
| 终止方式 | 主持人输出 `{"action": "end"}` 指令块 / 用户手动停止 + 全局跳数上限（默认 50）兜底 |
| busy 语义 | 拒绝即时投递，消息进入 pending 队列，目标空闲后自动投递（不丢弃） |

### 非目标（YAGNI）

- 外部平台会话（QQ、飞书等）的绑定与镜像
- agent 自主发起跨会话呼叫的 LLM 工具（可作为后续扩展）
- 多栏并排视图

## 2. 总体架构

```
┌─ Dashboard 前端 ─────────────────────────────────────┐
│ Chat 页: [协作] 按钮 + CollabPanel(聚合时间线)         │
└──────┬───────────────────────────────▲──────────────┘
       │ REST(绑定/开始/停止)            │ SSE 聚合流(新增端点)
┌──────▼───────────────────────────────┴──────────────┐
│ AgentCollabService (新增, dashboard/services)        │
│  · 绑定组管理(持久化)  · 路由状态机  · 跳数计数        │
│  · busy 检测 + pending 队列                          │
└──┬───────────────────────────────▲──────────────────┘
   │ ①投递: 写入目标会话的            │ ②观察: subscribe_system()
   │   webchat 输入队列               │   监听 turn 完成, 收集回复
┌──▼───────────────────────────────┴──────────────────┐
│ 现有链路(零改动): 输入队列→listener→convert_message    │
│ →commit_event→EventBus→Pipeline→Agent turn           │
│ →响应 mirror 到 system subscribers → 各会话页实时可见   │
└──────────────────────────────────────────────────────┘
```

### 核心机制：投递即「orphan turn」

投递**不**走 `StarTools.create_event`，而是向 `webchat_queue_mgr.get_or_create_queue(conv_id)` 写入与 `ChatService.build_chat_stream` 完全相同的入队载荷（`(username, conv_id, {message, message_id, llm_checkpoint_id, ...})` 三元组），但**不注册 chat run**。这样产生的 turn 对 webchat 子系统而言就是现成的 orphan turn —— goal-loop 合成 turn 已经验证了这条路径：

- 响应通过 `WebChatQueueMgr.put_system_event` mirror 到所有 system subscribers；
- `ChatService.build_system_stream` 将其实时推送给该会话打开的 chat 页面并自动落库（`save_bot_message`），思考块、工具调用、流式输出全部原生渲染；
- 各会话 chat 页面**不需要任何改动**。

路由器用 `webchat_queue_mgr.subscribe_system(session_id)` 订阅组内每个会话，按 `message_id` 用 `BotMessageAccumulator` 累积载荷，收到 `end`/`complete` 事件即视为一轮回复完成，提取纯文本回复作为路由输入。

## 3. 后端设计

### 3.1 新增文件

| 文件 | 职责 |
|---|---|
| `astrbot/dashboard/services/agent_collab_service.py` | `AgentCollabService`：绑定组 CRUD、讨论生命周期、路由状态机、busy/pending、跳数 |
| `astrbot/dashboard/api/agent_collab.py` | REST + SSE 路由（见 3.4） |
| `tests/unit/test_agent_collab_service.py` | 状态机单元测试 |
| `tests/test_agent_collab_integration.py` | 端到端集成测试 |

### 3.2 数据模型

**CollabGroup（持久化）** — 存入 sqlite（复用 dashboard 既有 DB 连接，新表 `agent_collab_groups`）：

```python
{
    "id": str,                # uuid
    "name": str,
    "owner_username": str,    # dashboard 用户
    "members": list[{         # 至少 2 个
        "session_id": str,    # webchat conversation id
        "alias": str,         # 用户取的别名, 如 "编程agent"; 不填则默认为会话 ID 末尾 8 位
    }],
    "moderator_session_id": str,  # 主持人会话, 必须在 members 中
    "created_at": str,        # ISO datetime
}
```

别名校验：组内唯一（大小写/空白归一化后比较）、trim 后非空、长度 ≤ 32 字符。别名是路由指令 `target` 的**第一匹配键**，也是聚合时间线中消息来源的展示名。

**CollabDiscussion（运行时为内存态，状态字段落库以便重启后恢复为 stopped）**：

```python
{
    "id": str,
    "group_id": str,
    "topic": str,
    "status": Literal["running", "paused", "stopped"],
    "hop_count": int,
    "hop_limit": int,              # 默认 50
    "current_turn": {              # None 表示空闲
        "session_id": str,
        "message_id": str,
    } | None,
    "last_member_reply": str,      # 最近一次成员回复原文, 供 mode=forward 引用; 初始为 topic
    "pending": list[{              # busy 挂起队列
        "target_session_id": str,
        "text": str,
        "sender_label": str,
    }],
}
```

### 3.3 路由状态机

每个 running 的 discussion 对应一个 asyncio task。所有消息流动都经过主持人会话（`moderator_session_id`），循环：

1. **投递给主持人**：首个 hop 为 topic 本身；后续 hop 为某成员 agent 的回复（包装为 `[来自 {sender_label}]: {text}`）。>2 人组中，注入主持人的消息**附带成员名册与路由协议说明**（见下方「路由指令协议」）；2 人组仅附带 end 指令说明。
2. **busy 检测**：满足任一条件则把该消息压入 `pending` 并等待：
   - `ChatService.chat_runs_by_session.get(target_session)` 非空（用户正在该会话对话）；
   - 路由器记录该会话有进行中的 collab turn。
   等待信号：本路由器订阅的 system 流中出现该会话的 turn 结束事件，或 chat run 结束（轮询 `chat_runs_by_session`，间隔 2s）。目标空闲后自动出队投递。busy 检测对主持人和成员会话一视同仁。
3. **投递**：构造 payload 写入目标会话输入队列，记录 `current_turn`，`hop_count += 1`。
4. **收集回复**：在该会话的 system subscriber 队列上按 `message_id` 累积，直到 `end` 事件；超时 180s 视为失败 → discussion 置 `paused` 并向前端推送 `error` 事件，等待用户「继续」或「停止」。
5. **路由决策**：
   - 若回复来自**成员会话** → 无条件路由回主持人（回到步骤 1）。
   - 若回复来自**主持人**：
     - **组内成员 = 2**（主持人 + 1 个成员）：无路由概念，退化为一问一答——主持人回复若含合法 `{"action": "end"}` 指令块则正常结束；否则**回复全文**直接转发给唯一的成员会话。不存在 `route_parse_failed` 场景。
     - **组内成员 > 2**：提取并解析路由指令（协议见下节， fenced JSON 块）：
       - `{"action": "route", "target": label, "mode": "forward"}` → **引用转发**：将最近一次收到的成员回复**原文**投递给目标会话，主持人无需复述；
       - `{"action": "route", "target": label, "mode": "forward", "content": note}` → 原文 + 主持人补充说明（拼为 `[来自 {sender_label}]: {原文}\n\n[主持人补充]: {note}`）；
       - `{"action": "route", "target": label, "mode": "literal", "content": text}` → 字面转述：将 `text` 投递给目标会话（主持人需要加工/总结内容时使用，content 必填非空）；
       - `{"action": "end", "summary": text}` → 讨论正常结束，置 `stopped`，summary 推送前端；
       - 解析失败（无合法指令块 / JSON 非法 / schema 校验失败）→ 置 `paused` 并推送 `route_parse_failed` 事件（附主持人原文），协作面板请用户手动选择下一站或结束。

   「最近一次成员回复」由讨论状态中的 `last_member_reply` 字段承载：状态机串行执行，语义上无歧义；其初始值为用户发起的 topic，因此首个 hop 主持人也可用 `"mode": "forward"` 转发 topic。
6. **跳数兜底**：`hop_count >= hop_limit` → 置 `paused`，推送 `hop_limit_reached` 事件，用户可重置计数继续或停止。
7. **停止**：用户调用 stop → 不再投递新消息；若 `current_turn` 非空，等待其自然结束（不强制中断 agent），随后置 `stopped`。绑定组保留。

### 路由指令协议

指令载体为**带自定义语言标记的 fenced code block，内嵌 JSON**。选择该形态的原因：

- **后端易解析**：正则提取 ```` ```collab-route ```` 围栏 → `json.loads` → 严格 schema 校验，无需解析自然语言；
- **前端易识别**：markdown 渲染管线对代码围栏已有处理，为 `collab-route` 语言挂自定义渲染规则即可把指令块渲染为**路由卡片**（而非原始文本），单会话 chat 页与聚合时间线共用同一规则；
- **LLM 输出稳定**：fenced JSON 是模型最熟悉的结构化输出形态。

**指令 schema**（严格校验，未知字段拒绝）：

```json
// 路由到下一发言者
{"action": "route", "target": "<成员别名>", "mode": "forward", "content": "可选补充说明"}
{"action": "route", "target": "<成员别名>", "mode": "literal", "content": "必填, 加工后的内容"}
// 结束讨论
{"action": "end", "summary": "<讨论总结>"}
```

**解析规则**：

- 指令块必须是回复中的**最后一个非空块**，且一条回复**至多一个** `collab-route` 块；多个或不在末尾 → 视为解析失败（>2 人组 → `route_parse_failed`）。
- 2 人组沿用同一提取规则（末尾、至多一个），但只识别 `{"action": "end"}`；含合法 end 块 → 结束讨论；不含合法块 → 普通回复全文直转（若其中夹带非法/非末尾的 `collab-route` 块，也随原文一并转发，不算解析失败）。

**注入主持人的协议说明**（仅 >2 人组，纯文本约定，不修改任何系统提示词模板）：

````text
[协作讨论] 成员名册: 编程agent, 文档agent, ...
[协作讨论] 你是本场讨论的主持人。收到成员回复后，你必须在回复末尾输出一个路由指令块（且只能有一个）：
```collab-route
{"action": "route", "target": "<成员别名>", "mode": "forward"}
```
  mode=forward: 把该成员回复的原文直接转给 target（content 字段可填你的补充说明）
  mode=literal: 把 content 字段中你加工后的内容转给 target
  结束讨论则输出: {"action": "end", "summary": "<总结>"}
[来自 {sender_label}]: {text}
````

- `target` 使用**成员别名**（如 `编程agent`）。名册中每个成员仅以其别名标注，完整会话 ID/UMO 从不出现在注入文本中；若用户未设置别名，该成员的别名即为其会话 ID 末尾 8 位短码。
- **匹配规则（两级）**：① 优先与组内成员**别名**做精确匹配（大小写、首尾空白归一化）；② 未命中时回退到**会话 ID 末尾 8 位后缀匹配**（兼容主持人输出了短码的情况）。两级都未命中 → 解析失败。
- **唯一性校验**：创建/修改绑定组、发起讨论时，检查组内别名两两不冲突，且各会话 ID 末尾 8 位两两不冲突（概率极低但可能）；冲突则拒绝操作并提示用户更换。
- 主持人回复的完整原文在聚合时间线中可见，但其中的 `collab-route` 块由前端渲染为路由卡片；转述内容以指令字段为准。
- 注入普通成员会话的消息仅含 `[来自 {sender_label}]: {text}`，不附带协议说明；`sender_label` 取发送方成员的别名（topic 的首个 hop 为发起用户的 username）。聚合时间线中的消息来源同样以别名展示。

**组内成员 = 2 时**不注入名册与 route 说明，仅告知主持人「你在与对方进行连续讨论，需要结束时在回复末尾输出 ` ```collab-route ` 块，内容为 `{"action": "end", "summary": "<总结>"}`」；主持人的普通回复全文直接转发给对方。

### 3.4 API 设计

新路由文件 `astrbot/dashboard/api/agent_collab.py`，挂载于 dashboard 应用（遵循既有鉴权依赖）：

| 方法 & 路径 | 说明 |
|---|---|
| `GET /api/agent_collab/groups` | 列出当前用户的绑定组 |
| `POST /api/agent_collab/groups` | 创建组 `{name, members: [{session_id, alias?}], moderator_session_id}`（校验：全部为有权限的 webchat 会话，≥2 个，moderator 在组内，别名组内唯一） |
| `PUT /api/agent_collab/groups/{id}` | 重命名/增删成员/修改别名/更换主持人 |
| `DELETE /api/agent_collab/groups/{id}` | 解散组（有 running 讨论时先拒绝） |
| `POST /api/agent_collab/groups/{id}/discussions` | 发起讨论 `{topic}`，首个 hop 固定投递给主持人会话，返回 discussion id |
| `POST /api/agent_collab/discussions/{id}/stop` | 停止讨论 |
| `POST /api/agent_collab/discussions/{id}/resume` | 从 paused 恢复（可选重置 hop_count） |
| `POST /api/agent_collab/discussions/{id}/route` | 人工路由：`{target_session_id, message}`，用于 `route_parse_failed` 等 paused 场景下由用户指定下一站 |
| `GET /api/agent_collab/discussions/{id}/stream` | **SSE 聚合流** |

SSE 聚合流多路复用两类事件：

- **转发事件**：组内各会话 system stream 的原始载荷（附加 `session_id` 字段），前端用与单会话页相同的渲染逻辑展示；
- **路由事件**：`{type: "route", from, to}` / `{type: "pending", target}` / `{type: "busy", session_id}` / `{type: "hop", count, limit}` / `{type: "route_parse_failed", raw_reply}` / `{type: "hop_limit_reached", count, limit}` / `{type: "paused"|"stopped"|"error", reason}`。

## 4. 前端设计（增量）

| 文件 | 说明 |
|---|---|
| `dashboard/src/components/chat/CollabPanel.vue` | 新组件：聚合时间线 + 状态栏（讨论状态、跳数、各会话 busy/idle 指示点、主持人标识）+ 操作按钮（发起/停止/继续）。讨论 paused 时展示原因并提供**人工路由选择器**（选择下一站会话 + 可编辑的转述内容）。消息渲染复用现有思考折叠块、工具调用卡片组件 |
| `dashboard/src/components/chat/CollabRouteCard.vue` | 新组件：`collab-route` 指令块的专用渲染卡片（路由目标、转发模式、补充说明 / 结束总结），单会话 chat 页与聚合时间线共用 |
| markdown 渲染管线 | **增量改动**：为 `collab-route` 代码围栏语言注册自定义渲染规则，输出 `CollabRouteCard`；未知/非法 JSON 降级为普通代码块展示 |
| `dashboard/src/components/chat/CollabBindDialog.vue` | 新组件：绑定对话框，多选 webchat 会话、**为每个会话填写别名**（默认填充会话 ID 末尾 8 位）并**指定其中一个为主持人**，保存为组。对话框标题遵循 `text-h3 pa-4 pb-0 pl-6`，按钮用 `variant="text"` / `variant="tonal"` |
| `dashboard/src/composables/useAgentCollab.ts` | 新 composable：封装上述 REST 与 SSE |
| `dashboard/src/views/Chat.vue`（或对应 chat 页组件） | **仅挂载点改动**：头部加「协作」按钮 + 引入 CollabPanel |
| `dashboard/src/api/v1.ts` | 增加 `agentCollabApi` 段（纯新增） |

单会话 chat 页面无需任何改动（orphan turn 实时可见为既有能力）。

## 5. 防环与错误处理

- 星型拓扑：成员回复无条件回主持人，只有主持人能指定下一站，结构上不存在环；跳数上限兜底失控。
- 主持人未按协议输出路由指令 → `paused` + `route_parse_failed` 事件，由用户人工指定下一站（兜底，不静默猜测）。
- 同一时刻一个 discussion 只有一个 in-flight turn（状态机本身是串行的）。
- 目标会话在讨论进行中被删除 → 自动从组移除并推送 `route` 事件说明；若被删的是主持人或组内剩余会话 <2 → 自动停止讨论。
- 服务重启 → 所有 discussion 恢复为 `stopped`（不自动续跑），绑定组保留。
- system subscriber 队列满（256 条）丢载荷是既有行为；路由器侧对回复收集做 180s 超时兜底，不依赖「每个载荷必达」。

## 6. 增量性保证

| 层面 | 做法 |
|---|---|
| pipeline / EventBus / 平台 adapter | 零改动，只复用公开入口（输入队列、`subscribe_system`、`chat_runs_by_session`、`BotMessageAccumulator`） |
| ChatService | 零改动；CollabService 只读取其公开状态 |
| 前端既有组件 | 仅 Chat 页一个挂载点改动；消息渲染组件只引用不修改 |
| 数据库 | 新增独立表 `agent_collab_groups`，不动既有表结构 |
| 新增文件 | service、api、前端组件/composable、测试全部为新文件 |

## 7. 测试策略

- **单元测试**（`tests/unit/test_agent_collab_service.py`）：
  - 路由指令解析（>2 人组）：fenced `collab-route` 块提取（必须在末尾、至多一个）、JSON 合法性、schema 严格校验（未知字段拒绝）；`forward`（引用 `last_member_reply` 原文）/ `forward + content 补充` / `literal` / `end`；`target` 两级匹配（别名精确匹配优先 → 会话 ID 末尾 8 位后缀兜底；含大小写、空白归一化）；首个 hop 的 forward 引用 topic；别名/后缀碰撞 → 创建/发起时拒绝；
  - 2 人组退化路径：主持人普通回复全文直转对方；含合法 `{"action": "end"}` 块时终止；
  - 成员回复无条件回主持人；主持人 `route` 指令 → 点对点投递到指定成员；
  - busy → pending → 空闲自动投递的完整流转（fake `chat_runs_by_session` + fake 输入队列）；
  - 跳数上限触发 paused；stop 语义（current_turn 自然结束后 stopped）；
  - 180s 超时 → paused + error 事件。
  - 复用 `tests/test_webchat_system_stream.py` 的 `WebChatQueueMgr` 测试模式构造 fake system subscriber。
- **集成测试**（`tests/test_agent_collab_integration.py`）：主持人 + 成员两个 fake webchat 会话，注入 topic，断言双方 system subscriber 均收到完整 turn 载荷、主持人 `route` 指令驱动点对点投递、hop_count 递增、`end` 指令正常终止。
- **前端**：`useAgentCollab.ts` 的 composable 级测试（mock SSE 事件流 → 时间线状态断言）。

## 8. 实施顺序建议

1. `AgentCollabService` 状态机 + 单元测试（纯后端，可独立验证）
2. REST/SSE 路由 + 集成测试
3. 前端 composable + CollabPanel + 挂载点
4. `ruff format` / `ruff check` + 全量测试回归
