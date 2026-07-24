# ChatUI 会话「分支」功能设计

- **Author**: elecvoid243
- **Date**: 2026-07-24 (CST)
- **Status**: Approved (pending implementation plan)
- **Scope**: AstrBot Dashboard ChatUI (webchat) + Dashboard 后端

---

## 1. 背景与目标

在 ChatUI 对话中，用户经常希望"基于当前上下文另起一条探索路径"，而不污染原会话。现有能力只有：

- **regenerate（重试）**：仅限最后一条 bot 消息，原地重放，会删除原有回答；
- 代码中已留有语义预期：`chat_service.py` 的 `prepare_regenerate_message_payload` 对旧轮次重试抛出 `"Regenerating older turns requires branching"`，但分支能力尚不存在。

**目标**：在任意 bot 消息尾部提供「分支」按钮，点击后创建一个全新会话，完整继承截至该消息（含其所在轮次）的 LLM 上下文与展示历史，原会话不受任何影响。

### 已确认的产品决策

| 决策点 | 结论 |
|--------|------|
| 分支粒度 | 任意 bot 消息均可分支；新会话继承**截止到该消息（含其 checkpoint 轮次）**的上下文 |
| 展示历史 | 完整复制分支点之前的展示消息；新会话中继承部分**可折叠/隐藏** |
| 配置继承 | 仅 `ConversationV2.persona_id` 随对话复制带走；provider/模型走用户当前 ChatUI 选中配置；不复制 session_variables |

## 2. 现有实现摘要（设计依据）

### 2.1 消息发送链路

```
ChatInput.vue / Chat.vue
  → useMessages.ts send()
  → POST /api/v1/chat (fetchWithAuth, SSE)
  → dashboard/api/chat.py::_send_chat()
  → ChatService.build_chat_stream()
      ├─ platform_history_mgr.insert(user 消息, 带 llm_checkpoint_id)
      ├─ 创建 ChatRunState + back_queue, 启动 _consume_chat_run (SSE 产出)
      └─ webchat_queue_mgr 会话队列.put((username, session_id, payload))
  → WebChatAdapter QueueListener callback → convert_message → handle_msg → commit_event
  → Pipeline → AgentRequestSubStage → InternalAgentSubStage.process
  → astr_main_agent.tool_loop_agent() 构建 ProviderRequest → ToolLoopAgentRunner → LLM
  → 流式产出经 WebChatMessageEvent._send → back_queue → SSE → 前端 readSseStream
```

### 2.2 上下文组装（astr_main_agent.py）

1. `_get_session_conv()`：`ConversationManager.get_curr_conversation_id(umo)`（内存缓存 + `sp` 的 `sel_conv_id`）→ `ConversationV2`，无则 `new_conversation()`；
2. `req.contexts = json.loads(conversation.history)` —— `ConversationV2.content` 即完整 LLM 历史（user/assistant/tool，**不含 system**）；每轮结束 `_save_to_history()` 回写并追加 `CheckpointMessageSegment`；
3. system prompt 逐层叠加（安全模式 / persona+skills / workspace / 工具提示 / system_reminder），均为运行时注入、不落库；
4. checkpoint_id 同时写入平台展示消息（`PlatformMessageHistory.llm_checkpoint_id`），是"展示消息 ↔ LLM 历史轮次"的关联锚点。

### 2.3 消息尾部按钮（ChatMessageList.vue `.message-meta`）

- 显示条件 `showMessageMeta()`：非 loading、非流式；
- 编辑：仅最后一条 user 消息（`canEditMessage`）；
- 重试：`RegenerateMenu`，仅最后一条消息且带 `llm_checkpoint_id`（`canRegenerateMessage`）；
- 复制 / stats / thread 菜单（`mdi-source-branch` 已被 thread 占用，分支按钮改用 `mdi-source-fork`）。

## 3. 方案选择

| 方案 | 结论 |
|------|------|
| **1. 后端快照复制（采纳）** | 单原子 API 完成建新 session + 截断复制 LLM 历史 + 复制展示历史；复用 checkpoint 工具函数；快照语义清晰 |
| 2. 前端组装复用现有 API | 否决：展示历史无公开写入 API，多请求有竞态 |
| 3. 惰性引用 copy-on-write | 否决：侵入上下文读取热路径，父对话删除/修改会破坏分支 |

## 4. 详细设计

### 4.1 后端

#### `ChatService.branch_session(username, session_id, message_id) -> dict`

位于 `astrbot/dashboard/services/chat_service.py`，校验逻辑与 `prepare_regenerate_message_payload` 同构：

1. **校验**：
   - session 存在且 `session.creator == username`，否则 404/403；
   - 目标消息存在、属于该 session、`content.type == "bot"`，否则 400；
   - 目标消息带 `llm_checkpoint_id`，否则 400（无 checkpoint 的旧消息前端不显示按钮，此为兜底）；
2. `load_current_conversation_history(session)` 取 `(conversation_id, history)`；
   `find_checkpoint_index(history, checkpoint_id)` 定位，**截断为 `history[:checkpoint_index+1]`**（含该轮 checkpoint，保证结构自洽）；找不到则 400；
3. `db.create_platform_session(creator=username, platform_id=session.platform_id, is_group=session.is_group)`，并 `update_platform_session(display_name="分支 · {原标题或'新对话'}")`；
4. 构造新 umo（`build_webchat_unified_msg_origin(新session)`），
   `conv_mgr.new_conversation(new_umo, platform_id, content=截断历史, persona_id=原对话 persona_id, title=原对话 title)`；
   （`new_conversation` 现有签名已支持 `content/persona_id/title`，且会写 `sel_conv_id`）
5. **复制展示历史**：取 `get_sorted_platform_history(session)` 中 `(created_at, id) <= 目标消息` 的记录，逐条 `platform_history_mgr.insert(platform_id, user_id=新session_id, content=deepcopy(原content), sender_id, sender_name, llm_checkpoint_id=原值)`；
6. **插入分界记录**（供前端折叠条）：
   `content = {"type": "branch_info", "source_session_id": session_id, "source_message_id": message_id, "inherited_count": N}`，
   `sender_id="bot"`, `sender_name="bot"`，无 checkpoint；
7. 返回 `{"session_id": 新id, "display_name": ..., "inherited_count": N}`。

注意：
- 复制用 `deepcopy`，避免可变 dict 共享；
- 展示历史复制的消息数可能很多，逐条 insert 在 SQLite 下为毫秒级，不引入批量接口（KISS）；
- 快照只读已落库数据，原会话正在流式输出时允许分支。

#### API 路由（`astrbot/dashboard/api/chat.py`）

```
POST /api/v1/chat/sessions/{session_id}/messages/{message_id}/branch
```

- 无 body（或预留可选 `{"display_name": str}`）；
- 返回 `{status: "ok", data: {session_id, display_name, inherited_count}}`；
- 错误经 `ChatServiceError` → `ApiError`（与现有 chat 路由一致）；
- 按 AGENTS.md 规则，路由变更后运行 `cd dashboard && pnpm generate:api` 重新生成前端 client。

### 4.2 前端

| 位置 | 改动 |
|------|------|
| `dashboard/src/api/v1.ts` | `chatApi.branchMessage(sessionId, messageId)`，调用再生成的 `openApiV1.branchChatMessage()` |
| `dashboard/src/composables/useMessages.ts` | `branchMessage(sessionId, messageId)`: POST → 成功后触发 `onSessionsChanged` → 返回 `{sessionId, inheritedCount}`；失败 toast |
| `dashboard/src/components/chat/ChatMessageList.vue` | (a) `.message-meta` 新增分支按钮：`mdi-source-fork`，位于重试按钮旁；显示条件 `canBranchMessage(msg, idx)` = `props.enableBranch && !isUserMessage(msg) && Boolean(msg.llm_checkpoint_id) && !isMessageStreaming && !isLoading && id 非 local-*`（**任意 bot 消息**，比 regenerate 宽松）；emit `branch`。(b) 渲染 `branch_info` 记录为可折叠分界条「继承自原会话的 N 条上文 ▾」，点击折叠/展开其上的继承消息；折叠状态按 session 存 localStorage |
| `dashboard/src/components/chat/Chat.vue` | `handleBranchMessage(msg)` → `branchMessage()` → `selectSession(新id)`（getSession 返回含分界条的完整历史，直接渲染）→ 成功 snackbar |
| i18n | zh-CN / en-US 新增：`branch` 按钮 tooltip、分界条文案（含计数）、成功/失败提示 |

`normalizeHistoryRecord` 需识别 `content.type === "branch_info"`，映射为特殊 `ChatRecord`（不进入普通气泡渲染分支）；继承消息 = 分界条之前的所有记录。

### 4.3 数据流

```
点击分支按钮 (ChatMessageList emit 'branch')
→ Chat.vue handleBranchMessage
→ POST /api/v1/chat/sessions/{sid}/messages/{mid}/branch
→ branch_session():
    新 PlatformSession("分支 · 原标题")
    + 新 ConversationV2(content=history[:cp+1], persona_id 继承)
    + PlatformMessageHistory 复制 (user_id=新sid, checkpoint 保留)
    + branch_info 分界记录
→ 返回 {session_id}
→ 前端刷新会话列表 → selectSession(新id)
→ getSession 返回含分界条的完整历史 → 渲染（继承部分可折叠）
```

### 4.4 错误处理与边界

- 400：非 bot 消息 / 无 checkpoint / checkpoint 在 LLM 历史中找不到 / 消息不属于会话 → 前端 snackbar；
- 403/404：session 不存在或非本人；
- 分支的分支：天然支持（复制的消息保留原 checkpoint_id，新会话中同样可分支、可重试）；
- 原会话流式进行中：允许分支（快照语义）；
- 分支点后新会话的 regenerate：最新 checkpoint 即分支点 checkpoint，`is_latest_checkpoint` 成立，行为正常。

### 4.5 明确不做（YAGNI）

- 不复制附件文件：展示消息中的 `attachment_id` 继续引用原文件；原会话删除后分支中的图片/附件会失效（v1 接受，文档注明）；
- 不复制 side threads（webchat_threads）；
- 不复制 token_usage（新对话从 0 累计）；
- 不复制 session_variables / provider 偏好等 umo 级状态；
- 不改动 legacy `/api/chat/*` 路由（仅 v1）。

## 5. 测试

### 后端（参照 `tests/test_chat_route.py`）

新增分支端点用例：

1. 构造 session + 多轮（≥3 轮）带 checkpoint 的 ConversationV2 与对应 PlatformMessageHistory；
2. 对中间某轮 bot 消息调用 branch；
3. 断言：
   - 新 session 存在，`display_name` 带「分支」前缀；
   - 新会话 `ConversationV2.content == history[:cp_index+1]`（含分支点 checkpoint），`persona_id` 一致；
   - 新会话展示历史条数 = 分支点前记录数 + 1（branch_info 分界条），记录顺序与内容一致，`llm_checkpoint_id` 保留；
   - 原会话 LLM 历史与展示历史**完全未变**；
   - 错误路径：对 user 消息 / 无 checkpoint 消息 / 他人 session 分支 → 400/403。

### 前端（手动验证清单）

- 任意 bot 消息显示分支按钮；user 消息 / 流式中 / 无 checkpoint 消息不显示；
- 点击后跳转新会话，标题带「分支」前缀，继承消息完整渲染且可折叠/展开，刷新后折叠状态保留；
- 分界条计数正确；新会话中发送消息、regenerate 最后一条均正常。

## 6. 涉及文件清单

**后端**

- `astrbot/dashboard/services/chat_service.py` — `branch_session()`
- `astrbot/dashboard/api/chat.py` — 新路由
- `astrbot/dashboard/api/models/...`（如有请求模型集中定义处）— 可选请求模型
- `tests/test_chat_route.py` — 新用例

**前端**

- `dashboard/src/api/v1.ts`
- `dashboard/src/api/generated/openapi-v1/*`（`pnpm generate:api` 再生成）
- `dashboard/src/composables/useMessages.ts`
- `dashboard/src/components/chat/ChatMessageList.vue`
- `dashboard/src/components/chat/Chat.vue`
- `dashboard/src/i18n/locales/{zh-CN,en-US}`（chat 相关词条）
