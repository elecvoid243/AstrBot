# WebChat 系统事件流（System Event Stream）设计

- 作者：elecvoid243
- 日期：2026-07-25
- 分支：`feat/webchat-system-stream`（worktree：`.worktrees/feat-webchat-system-stream`）
- 状态：已评审通过（用户逐节确认）

## 1. 背景与问题

webchat 的回包通道 `webchat_queue_mgr.back_queues` 以 `request_id = message_id` 为键。dashboard 的 SSE（`chat_service.build_chat_stream`）只订阅**用户主动发消息**时创建的那条 back_queue。

因此任何"非用户触发"的事件（每次都会生成新 `message_id`）其 `event.send()` 产出落到**孤儿 back_queue**——无人订阅、无人消费、`BotMessageAccumulator` 从未运行、`platform_message_history` 从未写入。表现为：**消息在前端完全不可见，且刷新后也无法从历史恢复**。

受影响场景（2026-07-25 实测）：

- `astrbot_plugin_goal` 的目标循环合成轮（kickoff / continuation）：LLM 推理、工具调用全部正常执行，但聊天页无任何显示
- 未来同类系统驱动流：subagent 中间产出、cron 主动消息（cron 目前走 `send_by_session` 有自己的兜底持久化，不在本期范围）

## 2. 目标与非目标

### 目标

- 系统驱动事件的 LLM 输出**像正常聊天一样**实时显示在 webchat 聊天页（自然显示，无特殊样式）
- 系统驱动事件的输出**按 AstrBot 原生方式落盘** `platform_message_history`（内存累积 + 每轮 1 次 INSERT），刷新/重开页面后完整可见
- **现有流程零影响**：per-request SSE、back_queue 键控、消息解析、渲染全部保留；功能可一键关闭
- 通用机制：goal 循环、未来 subagent 等**业务侧零修改**即可接入

### 非目标

- 不改其他 IM 平台（aiocqhttp / lark / ...）——它们没有 dashboard 显示问题
- 不为系统事件做特殊 UI（徽章/卡片/侧栏）——本期选择"自然显示"
- 不持久化合成轮的**用户侧输入**（continuation prompt 文本）——见已知限制
- cron / `send_by_session` 主动消息通道不改动

## 3. 方案总览

**并行通道 + 全量镜像 + 后端过滤 + 原生落盘**：

platform adapter 在 `event.send()` / `send_streaming()` 把数据写到原 per-request back_queue 后，**再镜像一份**到新增的"会话级系统事件队列"。dashboard 新开一条 SSE 订阅它；消费者跳过主 SSE 正在消费的 `request_id`（避免重复），对其余（孤儿）事件直播推送 + 按原生 accumulator 模式落盘。

```
   ── 现有流程（完全保留）──
   User 打字 ──▶ dashboard ──▶ /chat/send (SSE) ──▶ back_queue[req_id] ──▶ MessageList

   ── 新增流程（并行 / 镜像）──
   event.send() / send_streaming() (platform adapter)
         │
         ├──▶ back_queue[req_id]                    （原路径，不变）
         └──▶ system_subscribers[conversation_id]   （新增镜像；无订阅者时零成本跳过）
                       │
                       ▼
              GET /chat/sessions/{session_id}/system-stream （新路由）
                       │
              chat_service.build_system_stream：
                - 跳过 active_run_ids（主 SSE 在消费的 request_id）
                - 其余事件 → SSE 直播推送
                - 按 message_id 分桶 BotMessageAccumulator
                - complete/end 时 save_bot_message（每轮 1 次 INSERT）
                       │
                       ▼
              dashboard useMessages（第二 EventSource，合并渲染）
```

## 4. 后端改动

### 4.1 `astrbot/core/platform/sources/webchat/webchat_queue_mgr.py`

新增会话级系统事件订阅（pub-sub，fan-out 支持多 tab）：

```python
class WebChatQueueMgr:
    system_subscribers: dict[str, set[asyncio.Queue]]  # conversation_id -> 订阅者队列

    def subscribe_system(self, conversation_id: str) -> asyncio.Queue:
        """创建订阅者队列（maxsize=256）并登记，返回该队列。"""

    def unsubscribe_system(self, conversation_id: str, queue: asyncio.Queue) -> None:
        """注销订阅者；集合为空时清理键。"""

    def has_system_subscribers(self, conversation_id: str) -> bool: ...

    async def put_system_event(self, conversation_id: str, payload: object) -> bool:
        """镜像写入所有订阅者队列。

        - 无订阅者：立即 return False（零成本，懒创建语义）
        - 队列满：put_nowait 失败则丢弃该 payload + debug 日志，绝不阻塞
        """
```

### 4.2 `astrbot/core/platform/sources/webchat/webchat_event.py`

`WebChatMessageEvent._send` 新增参数 `mirror_system: bool = True`：

```python
@staticmethod
async def _send(message_id, message, session_id, streaming=False,
                emit_complete=False, mirror_system: bool = True):
    ...原有 put_back_queue 逻辑逐字保留...
    # 每个 payload 成功写入 back_queue 后，镜像一份到系统通道：
    if mirror_system:
        cid = _extract_conversation_id(session_id)
        await webchat_queue_mgr.put_system_event(cid, payload)
```

- `send()` / `send_streaming()` 使用默认值 `True` → goal 合成轮输出自动入系统通道
- **`WebChatAdapter.send_by_session` 显式传 `mirror_system=False`** → 主动消息已有自己的广播 + `_save_proactive_message` 持久化，不重复
- `_extract_conversation_id` 当前定义在 `webchat_adapter.py`，而 `webchat_adapter` 已 import `webchat_event`——若 `webchat_event` 反向 import 会循环依赖。**将其下沉到 `webchat_queue_mgr.py`**（`webchat_event` 与 `webchat_adapter` 都已依赖该模块），两处改为从队列管理模块导入

### 4.3 `astrbot/dashboard/api/chat.py`

新路由，鉴权与响应头同现有流式端点：

```python
@router.get("/chat/sessions/{session_id}/system-stream")
async def system_stream(request, session_id: str,
                        auth=Depends(require_chat_scope),
                        service=Depends(get_service)):
    # webchat.system_stream_enabled 为 false 时返回 404（前端静默降级）
    return StreamingResponse(
        service.build_system_stream(auth.username, session_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
```

### 4.4 `astrbot/dashboard/services/chat_service.py`

新增 `build_system_stream(username, session_id)`：

```python
queue = webchat_queue_mgr.subscribe_system(cid)
accumulators: dict[str, BotMessageAccumulator] = {}   # message_id -> 分桶累积
try:
    while True:
        payload = await queue.get()
        if payload.get("message_id") in self.active_run_ids:
            continue                     # 主 SSE 正在消费，跳过（不推、不存）
        yield format_sse(payload)        # 直播推给前端
        acc = accumulators.setdefault(payload["message_id"], BotMessageAccumulator())
        # 按 payload["type"] 累积 plain / reasoning / tool_call / attachment...
        if payload["type"] in ("complete", "end"):
            parts = acc.build_message_parts(include_pending_tool_calls=True)
            await self.save_bot_message(
                cid, parts, {}, {}, platform_history_id="webchat",
            )                            # llm_checkpoint_id=None
            del accumulators[payload["message_id"]]
finally:
    # 连接断开：未完成的桶按部分累积落盘（与主流程 finally 兜底同款），注销订阅
    for mid, acc in accumulators.items():
        if acc.has_content():
            await self.save_bot_message(cid, acc.build_message_parts(...), {}, {})
    webchat_queue_mgr.unsubscribe_system(cid, queue)
```

`active_run_ids: set[str]`：`build_chat_stream` 开始时登记 run_id、结束（含异常）注销。这是**用户主消息不双写、不双推**的关键；goal 事件的 `message_id` 天然不同，全部通过。

落盘记录结构与原生完全一致（`{"type": "bot", "message": parts}` + `agent_stats` / `refs`），历史按时间序与正常消息混排。

## 5. 前端改动（`dashboard/src/composables/useMessages.ts`，纯加法）

1. **第二 EventSource 生命周期**：chat 页挂载/切换会话时 `new EventSource('/chat/sessions/{id}/system-stream')`；卸载/切换时 `close()`。断线用 EventSource 原生 retry，不重放
2. **消息合并**：payload 格式与主 SSE 相同（`{type, data, streaming, message_id}`），复用现有 stream parser；`message_id` 不在列表 → 新建 assistant 消息条目按 chunk 累积；`complete`/`end` 收尾
3. **渲染**：与正常 assistant 消息同一组件（自然显示，无特殊样式）
4. **防御性 dedup**：按 `message_id` 索引，重复 payload 跳过（backend 已过滤，此为兜底）
5. **历史加载**：页面打开时 goal 轮已从 `platform_message_history` 加载混排；直播流只处理页面打开后的新事件

## 6. 配置

新增 dashboard 配置项 `webchat.system_stream_enabled`（默认 `true`）。为 `false` 时新路由返回 404，前端 catch 后静默跳过——一键回到现状。

## 7. 错误处理

| 故障点 | 策略 |
|---|---|
| system 订阅者队列满 | 丢 chunk + debug 日志，绝不阻塞 `event.send()` |
| SSE 断开（一轮未完） | `finally` flush 部分累积落盘 + 注销订阅 |
| `save_bot_message` 失败 | log error，不中断直播流（显示优先） |
| 前端系统流连接失败 | catch 静默，主聊天功能不受影响 |

## 8. 测试

- **后端单测**：`webchat_queue_mgr` 订阅/退订/fan-out/满则丢/无订阅者零成本；`_send` 镜像开关（含 `send_by_session` 不镜像）；系统消费者 `active_run_ids` 过滤；accumulator 分桶与 `complete`/`end` 恰好落盘一次；断开时 finally 兜底落盘
- **前端**：`useMessages` 系统流事件建消息条目、dedup、会话切换时关闭连接
- **E2E 手测**：`/goal set` → 聊天页实时看到每轮输出与工具调用 → 刷新页面历史完整 → 期间正常发消息验证主流程零回归

## 9. 已知限制

1. 合成轮的用户侧输入（continuation prompt）不入库——历史中 goal 轮的 bot 回复看不到对应 prompt（内容自解释，可接受；后续可加钩子补）
2. 系统事件落盘记录 `llm_checkpoint_id=None`，不支持 thread / regenerate / branch
3. 仅覆盖 webchat 平台
4. 历史加载与直播流交接的瞬间竞态可能短暂出现一条重复消息，下一事件到来自然修正
5. SSE 断线重连若恰好发生在一轮进行中：断开时 `finally` 已把部分累积落盘，重连后的新订阅用新 accumulator 接收该轮后续 chunk，`complete` 时会**再落一条部分记录**——同一轮在历史中可能出现前后两条残缺消息。发生概率低、无数据损坏，本期不处理（后续可用 `message_id` 关联 UPDATE 而非重复 INSERT）

## 10. 性能论证（评审记录）

- 写端：每条消息多 1 次 `Queue.put_nowait`（纳秒级）；**无订阅者时 `put_system_event` 立即返回，零成本**
- 内存：流式一轮 5-20KB 镜像；订阅者队列 `maxsize=256` 封顶，满则丢
- DB：**每轮 1 次 INSERT**，与 AstrBot 原生聊天流完全一致（原生即为内存累积 + `end`/`complete`/`finally` 落盘，非流式写库）
- SSE 流量：仅系统事件增量（用户主消息被 `active_run_ids` 过滤，不重复传输）
