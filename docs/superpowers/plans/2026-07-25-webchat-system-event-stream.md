# WebChat 系统事件流（System Event Stream）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 goal 循环等系统驱动事件的 LLM 输出像正常聊天一样实时显示在 webchat 聊天页并按原生方式落盘历史。

**Architecture:** platform adapter 在 `event.send()`/`send_streaming()` 写 per-request back_queue 后，镜像一份到新增的会话级系统事件订阅（pub-sub）；dashboard 新开 SSE `/api/v1/chat/sessions/{session_id}/system-stream` 消费它，跳过主 SSE 正在服务的 run（`self.chat_runs`），其余事件直播推送 + 用与 `_consume_chat_run` 相同的 accumulate-then-flush 策略落盘 `platform_message_history`。前端 `useMessages` 开第二条流，复用 `processStreamPayload` 渲染。

**Tech Stack:** Python 3.10+ / FastAPI / asyncio（后端），Vue 3 + TypeScript + Vitest（前端），pytest + pytest-asyncio（后端测试）。

**Spec:** `docs/superpowers/specs/2026-07-25-webchat-system-event-stream-design.md`（同分支，commit `d6e16c3`）

**Worktree:** `F:\github\Astrbot\.worktrees\feat-webchat-system-stream`（分支 `feat/webchat-system-stream`）。**所有命令在该目录下执行。**

## Global Constraints

- 仅本地提交，**禁止 push 远端、禁止 PR**
- 注释与日志用 **English**；docstring 用 Google 格式（`Args:`/`Returns:`/`Raises:`）
- 路径用 `pathlib.Path`；后端测试命令 `uv run pytest tests/<file> -v`（worktree 根目录）
- 前端测试命令 `cd dashboard && pnpm vitest run <file>`
- 提交信息用 conventional commits（`feat:`/`test:`/`fix:`/`docs:`）
- 每个 Task 完成后运行 `uv run ruff format <改动文件> && uv run ruff check <改动文件>`
- 现有流程零回归：per-request SSE、back_queue 键控、`send_by_session` 行为不得改变
- 生成代码标注 `// Author: elecvoid243` / `# Author: elecvoid243` 与日期 `2026-07-25`（仓库既有惯例）

---

### Task 1: webchat_queue_mgr — 系统事件 pub-sub + `_extract_conversation_id` 下沉

**Files:**
- Modify: `astrbot/core/platform/sources/webchat/webchat_queue_mgr.py`
- Modify: `astrbot/core/platform/sources/webchat/webchat_adapter.py`（仅 import 与删除本地函数）
- Test: `tests/test_webchat_system_stream.py`（新建）

**Interfaces:**
- Consumes: 无（基础模块）
- Produces:
  - `webchat_queue_mgr.subscribe_system(conversation_id: str) -> asyncio.Queue`
  - `webchat_queue_mgr.unsubscribe_system(conversation_id: str, queue: asyncio.Queue) -> None`
  - `webchat_queue_mgr.has_system_subscribers(conversation_id: str) -> bool`
  - `webchat_queue_mgr.put_system_event(conversation_id: str, payload: dict) -> bool`（async；无订阅者返回 False；订阅者队列满则丢 + debug 日志，不抛不阻塞）
  - `astrbot.core.platform.sources.webchat.webchat_queue_mgr._extract_conversation_id(session_id: str) -> str`（从 webchat_adapter.py 原样下沉）

- [ ] **Step 1: 确认 `_extract_conversation_id` 没有其它 import 方**

Run: `grep -rn "_extract_conversation_id" astrbot/ --include="*.py"`
Expected: 仅出现在 `webchat_adapter.py`（定义 + 内部使用）。若出现其它文件 import，本 Task 一并改为从 `webchat_queue_mgr` 导入。

- [ ] **Step 2: 写失败测试**

Create `tests/test_webchat_system_stream.py`:

```python
"""Tests for the webchat conversation-level system event channel."""

# Author: elecvoid243
# Date: 2026-07-25

import asyncio

import pytest

from astrbot.core.platform.sources.webchat.webchat_queue_mgr import (
    WebChatQueueMgr,
    _extract_conversation_id,
)


class TestExtractConversationId:
    def test_umop_session_id(self):
        assert (
            _extract_conversation_id("webchat!abc!session-1") == "session-1"
        )

    def test_plain_session_id_passthrough(self):
        assert _extract_conversation_id("session-1") == "session-1"


class TestSystemEventPubSub:
    @pytest.mark.asyncio
    async def test_put_without_subscriber_is_zero_cost_noop(self):
        mgr = WebChatQueueMgr()
        accepted = await mgr.put_system_event("conv-1", {"type": "plain"})
        assert accepted is False
        assert not mgr.has_system_subscribers("conv-1")

    @pytest.mark.asyncio
    async def test_subscribe_receives_payload(self):
        mgr = WebChatQueueMgr()
        queue = mgr.subscribe_system("conv-1")
        payload = {"type": "plain", "data": "hello", "message_id": "m1"}
        accepted = await mgr.put_system_event("conv-1", payload)
        assert accepted is True
        assert queue.get_nowait() is payload

    @pytest.mark.asyncio
    async def test_fanout_to_multiple_subscribers(self):
        mgr = WebChatQueueMgr()
        q1 = mgr.subscribe_system("conv-1")
        q2 = mgr.subscribe_system("conv-1")
        await mgr.put_system_event("conv-1", {"type": "end"})
        assert q1.get_nowait()["type"] == "end"
        assert q2.get_nowait()["type"] == "end"

    @pytest.mark.asyncio
    async def test_unsubscribe_stops_delivery_and_cleans_up(self):
        mgr = WebChatQueueMgr()
        queue = mgr.subscribe_system("conv-1")
        mgr.unsubscribe_system("conv-1", queue)
        assert not mgr.has_system_subscribers("conv-1")
        accepted = await mgr.put_system_event("conv-1", {"type": "plain"})
        assert accepted is False

    @pytest.mark.asyncio
    async def test_full_subscriber_queue_drops_without_blocking(self):
        mgr = WebChatQueueMgr()
        queue = mgr.subscribe_system("conv-1")
        for i in range(queue.maxsize):
            queue.put_nowait({"n": i})
        # Must not raise and must not block.
        accepted = await asyncio.wait_for(
            mgr.put_system_event("conv-1", {"type": "overflow"}), timeout=1
        )
        assert accepted is True
        assert queue.qsize() == queue.maxsize
```

- [ ] **Step 3: 运行测试确认失败**

Run: `uv run pytest tests/test_webchat_system_stream.py -v`
Expected: FAIL（`WebChatQueueMgr` 无 `subscribe_system` 等方法；`_extract_conversation_id` 不可导入）

- [ ] **Step 4: 实现**

在 `astrbot/core/platform/sources/webchat/webchat_queue_mgr.py` 中：

1. 文件头部常量与下沉的 helper（`asyncio`、`logger` 已在 imports 中）：

```python
SYSTEM_SUBSCRIBER_QUEUE_SIZE = 256
"""Max buffered system-event payloads per subscriber; overflow is dropped."""


def _extract_conversation_id(session_id: str) -> str:
    """Extract raw webchat conversation id from event/session id."""
    if session_id.startswith("webchat!"):
        parts = session_id.split("!", 2)
        if len(parts) == 3:
            return parts[2]
    return session_id
```

2. `WebChatQueueMgr.__init__` 末尾追加：

```python
        self.system_subscribers: dict[str, set[asyncio.Queue]] = {}
        """Conversation ID to system-event subscriber queues (fan-out)."""
```

3. 类中新增四个方法（放在 `remove_back_queue` 之后）：

```python
    def subscribe_system(self, conversation_id: str) -> asyncio.Queue:
        """Register a system-event subscriber queue for a conversation.

        Args:
            conversation_id: Raw webchat conversation id.

        Returns:
            A new bounded queue receiving mirrored event payloads.
        """
        queue: asyncio.Queue = asyncio.Queue(maxsize=SYSTEM_SUBSCRIBER_QUEUE_SIZE)
        self.system_subscribers.setdefault(conversation_id, set()).add(queue)
        return queue

    def unsubscribe_system(self, conversation_id: str, queue: asyncio.Queue) -> None:
        """Remove a system-event subscriber; cleans up the empty bucket."""
        subscribers = self.system_subscribers.get(conversation_id)
        if not subscribers:
            return
        subscribers.discard(queue)
        if not subscribers:
            self.system_subscribers.pop(conversation_id, None)

    def has_system_subscribers(self, conversation_id: str) -> bool:
        """Return True when at least one system-event subscriber exists."""
        return bool(self.system_subscribers.get(conversation_id))

    async def put_system_event(self, conversation_id: str, payload: dict) -> bool:
        """Mirror one event payload to all system-event subscribers.

        Zero-cost no-op when nobody subscribes. A full subscriber queue drops
        the payload (chat display is best-effort) and never blocks the sender.

        Args:
            conversation_id: Raw webchat conversation id.
            payload: The exact payload dict also written to the back queue.

        Returns:
            True when at least one subscriber existed, False otherwise.
        """
        subscribers = self.system_subscribers.get(conversation_id)
        if not subscribers:
            return False
        for subscriber in list(subscribers):
            try:
                subscriber.put_nowait(payload)
            except asyncio.QueueFull:
                logger.debug(
                    f"System event subscriber queue full for {conversation_id}, "
                    "dropping payload"
                )
        return True
```

4. `webchat_adapter.py`：删除本地 `_extract_conversation_id` 定义（line 32-38），import 行改为：

```python
from .webchat_queue_mgr import _extract_conversation_id, webchat_queue_mgr
```

（保留原有 `webchat_queue_mgr` 导入，把 `_extract_conversation_id` 并入同一行。）

- [ ] **Step 5: 运行测试确认通过 + 回归**

Run: `uv run pytest tests/test_webchat_system_stream.py -v`
Expected: 6 passed

Run: `uv run pytest tests/test_chat_route.py -v`
Expected: 全 pass（adapter import 改动无回归）

- [ ] **Step 6: Lint + Commit**

```bash
uv run ruff format astrbot/core/platform/sources/webchat/ tests/test_webchat_system_stream.py
uv run ruff check astrbot/core/platform/sources/webchat/ tests/test_webchat_system_stream.py
git add astrbot/core/platform/sources/webchat/ tests/test_webchat_system_stream.py
git commit -m "feat(webchat): add conversation-level system event pub-sub channel"
```

---

### Task 2: `_send` 镜像写入 + `send_by_session` 排除

**Files:**
- Modify: `astrbot/core/platform/sources/webchat/webchat_event.py`（`_send` 签名与每处 `put_back_queue` 调用点）
- Modify: `astrbot/core/platform/sources/webchat/webchat_adapter.py`（`send_by_session` 两处 `_send` 调用）
- Test: `tests/test_webchat_system_stream.py`（追加）

**Interfaces:**
- Consumes: Task 1 的 `put_system_event` / `_extract_conversation_id`
- Produces: `WebChatMessageEvent._send(..., mirror_system: bool = True)`——Task 3 的消费者依赖镜像 payload 含 `message_id` 键

- [ ] **Step 1: 写失败测试（追加到 `tests/test_webchat_system_stream.py`）**

```python
from astrbot.api.event import MessageChain
from astrbot.api.message_components import Plain
from astrbot.core.platform.sources.webchat.webchat_event import WebChatMessageEvent


class TestSendMirroring:
    @pytest.mark.asyncio
    async def test_send_mirrors_to_system_subscribers(self):
        from astrbot.core.platform.sources.webchat.webchat_queue_mgr import (
            webchat_queue_mgr,
        )

        queue = webchat_queue_mgr.subscribe_system("conv-mirror")
        try:
            await WebChatMessageEvent._send(
                "req-1",
                MessageChain(chain=[Plain("hi")]),
                "webchat!user!conv-mirror",
            )
            mirrored = queue.get_nowait()
            assert mirrored["type"] == "plain"
            assert mirrored["message_id"] == "req-1"
        finally:
            webchat_queue_mgr.unsubscribe_system("conv-mirror", queue)
            await webchat_queue_mgr.remove_back_queue("req-1")

    @pytest.mark.asyncio
    async def test_send_mirror_disabled_writes_nothing(self):
        from astrbot.core.platform.sources.webchat.webchat_queue_mgr import (
            webchat_queue_mgr,
        )

        queue = webchat_queue_mgr.subscribe_system("conv-nomirror")
        try:
            await WebChatMessageEvent._send(
                "req-2",
                MessageChain(chain=[Plain("hi")]),
                "webchat!user!conv-nomirror",
                mirror_system=False,
            )
            assert queue.empty()
        finally:
            webchat_queue_mgr.unsubscribe_system("conv-nomirror", queue)
            await webchat_queue_mgr.remove_back_queue("req-2")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/test_webchat_system_stream.py::TestSendMirroring -v`
Expected: FAIL（`_send() got an unexpected keyword argument 'mirror_system'`）

- [ ] **Step 3: 实现**

`webchat_event.py` 顶部 import 改为：

```python
from .webchat_queue_mgr import _extract_conversation_id, webchat_queue_mgr
```

`_send` 签名加参数（其余不变）：

```python
    @staticmethod
    async def _send(
        message_id: str,
        message: MessageChain | None,
        session_id: str,
        streaming: bool = False,
        emit_complete: bool = False,
        mirror_system: bool = True,
    ) -> str | None:
```

方法体内，`request_id = str(message_id)` 之后加一行：

```python
        system_cid = _extract_conversation_id(session_id) if mirror_system else None
```

然后对**每一处** `put_back_queue(request_id, {...})` / `put_back_queue(request_id, payload)` 调用，在调用成功之后追加镜像（共 9 处，含 `end`、`plain`×2、`image`、`record`、`file`、`complete`、`follow_up_captured`、`run_started`、以及 line ~223 的通用 `payload` 分支）。模式统一为：

```python
                if system_cid is not None:
                    await webchat_queue_mgr.put_system_event(system_cid, payload_dict)
```

其中 `payload_dict` 是刚传给 `put_back_queue` 的同一个 dict 对象（零拷贝；消费者不原地修改）。对直接内联 dict 字面量的调用点，先把字面量赋给局部变量再两处复用，例如：

```python
                payload = {
                    "type": "end",
                    "data": "",
                    "streaming": False,
                    "message_id": message_id,
                }
                await webchat_queue_mgr.put_back_queue(request_id, payload)
                if system_cid is not None:
                    await webchat_queue_mgr.put_system_event(system_cid, payload)
```

注意：保持各 payload 原有键与值**逐字不变**——不新增、不删除、不改名任何键，只把同一个 dict 镜像给系统通道。

`webchat_adapter.py` `send_by_session` 中两处 `WebChatMessageEvent._send(...)` 调用追加 `mirror_system=False`。

- [ ] **Step 4: 运行测试确认通过 + 回归**

Run: `uv run pytest tests/test_webchat_system_stream.py -v`
Expected: 8 passed

Run: `uv run pytest tests/test_chat_route.py tests/test_openapi_chat_bridge.py -v 2>nul`
Expected: 全 pass（若后者不存在则只跑前者）

- [ ] **Step 5: Lint + Commit**

```bash
uv run ruff format astrbot/core/platform/sources/webchat/ tests/test_webchat_system_stream.py
uv run ruff check astrbot/core/platform/sources/webchat/ tests/test_webchat_system_stream.py
git add astrbot/core/platform/sources/webchat/ tests/test_webchat_system_stream.py
git commit -m "feat(webchat): mirror event.send payloads to system event channel"
```

---

### Task 3: `ChatService.build_system_stream` 消费者

**Files:**
- Modify: `astrbot/dashboard/services/chat_service.py`
- Test: `tests/test_chat_system_stream.py`（新建）

**Interfaces:**
- Consumes: Task 1 `subscribe_system`/`unsubscribe_system`；既有 `BotMessageAccumulator`、`self.chat_runs`、`self.save_bot_message`
- Produces: `ChatService.build_system_stream(username: str, session_id: str) -> AsyncIterator[str]`——Task 4 路由消费

- [ ] **Step 1: 写失败测试**

Create `tests/test_chat_system_stream.py`:

```python
"""Tests for ChatService.build_system_stream (orphan/system event consumer)."""

# Author: elecvoid243
# Date: 2026-07-25

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from astrbot.core.platform.sources.webchat.webchat_queue_mgr import (
    webchat_queue_mgr,
)
from astrbot.dashboard.services.chat_service import ChatService


def _make_service() -> ChatService:
    service = ChatService.__new__(ChatService)
    service.db = MagicMock()
    service.core_lifecycle = MagicMock()
    service.conv_mgr = MagicMock()
    service.platform_history_mgr = MagicMock()
    service.umop_config_router = MagicMock()
    service.running_convs = {}
    service.chat_runs = {}
    service.chat_runs_by_session = {}
    service._branch_relations = None
    service.save_bot_message = AsyncMock()
    return service


async def _collect(stream, n_events: int) -> list[dict]:
    events = []
    async for chunk in stream:
        for block in chunk.strip().split("\n\n"):
            if block.startswith("data: "):
                events.append(json.loads(block[6:]))
                if len(events) >= n_events:
                    return events
    return events


class TestBuildSystemStream:
    @pytest.mark.asyncio
    async def test_orphan_event_streamed_and_saved_on_complete(self):
        service = _make_service()
        session_id = f"conv-{id(self)}-a"
        stream = await service.build_system_stream("tester", session_id)
        task = asyncio.create_task(_collect(stream, 2))
        await asyncio.sleep(0)  # let the consumer subscribe

        await webchat_queue_mgr.put_system_event(
            session_id,
            {
                "type": "plain",
                "data": "goal turn output",
                "streaming": False,
                "message_id": "orphan-1",
            },
        )
        await webchat_queue_mgr.put_system_event(
            session_id,
            {
                "type": "complete",
                "data": "goal turn output",
                "streaming": False,
                "message_id": "orphan-1",
            },
        )
        events = await asyncio.wait_for(task, timeout=2)
        assert [e["type"] for e in events] == ["plain", "complete"]
        # flush happens after the yield; poll until the save lands.
        for _ in range(100):
            if service.save_bot_message.await_count:
                break
            await asyncio.sleep(0.01)
        service.save_bot_message.assert_awaited_once()
        args = service.save_bot_message.await_args.args
        assert args[0] == session_id
        assert args[1][-1]["text"] == "goal turn output"
        await stream.aclose()

    @pytest.mark.asyncio
    async def test_active_run_payloads_are_skipped(self):
        service = _make_service()
        session_id = f"conv-{id(self)}-b"
        service.chat_runs["user-run-1"] = MagicMock()  # primary run in flight
        stream = await service.build_system_stream("tester", session_id)
        task = asyncio.create_task(_collect(stream, 1))
        await asyncio.sleep(0)

        await webchat_queue_mgr.put_system_event(
            session_id,
            {
                "type": "plain",
                "data": "user message echo",
                "streaming": True,
                "message_id": "user-run-1",
            },
        )
        await webchat_queue_mgr.put_system_event(
            session_id,
            {
                "type": "plain",
                "data": "orphan output",
                "streaming": False,
                "message_id": "orphan-2",
            },
        )
        events = await asyncio.wait_for(task, timeout=2)
        assert len(events) == 1
        assert events[0]["message_id"] == "orphan-2"
        await stream.aclose()
        # The orphan plain payload was accumulated but no complete/end arrived,
        # so aclose triggers the finally-flush and persists it.
        service.save_bot_message.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_disconnect_flushes_partial_turn(self):
        service = _make_service()
        session_id = f"conv-{id(self)}-c"
        stream = await service.build_system_stream("tester", session_id)
        task = asyncio.create_task(_collect(stream, 1))
        await asyncio.sleep(0)

        await webchat_queue_mgr.put_system_event(
            session_id,
            {
                "type": "plain",
                "data": "partial",
                "streaming": True,
                "message_id": "orphan-3",
            },
        )
        events = await asyncio.wait_for(task, timeout=2)
        assert events[0]["data"] == "partial"
        await stream.aclose()
        service.save_bot_message.assert_awaited_once()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/test_chat_system_stream.py -v`
Expected: FAIL（`AttributeError: 'ChatService' object has no attribute 'build_system_stream'`）

- [ ] **Step 3: 实现**

`chat_service.py` 中 `build_chat_stream` 之后新增（`webchat_queue_mgr`、`json`、`asyncio`、`AsyncIterator`、`BotMessageAccumulator`、`logger` 均已在本文件 imports 中）：

```python
    async def build_system_stream(
        self,
        username: str,
        session_id: str,
    ) -> AsyncIterator[str]:
        """Stream system-driven (non-user-initiated) webchat events.

        Consumes the conversation-level system event queue mirrored by the
        webchat platform adapter. Payloads whose ``message_id`` belongs to an
        active primary chat run are skipped (the primary SSE already serves
        and persists them). Orphan turns (goal-loop synthetic turns and
        future system flows) are streamed live and persisted with the same
        accumulate-then-flush policy as ``_consume_chat_run``.

        Args:
            username: Dashboard username owning the connection.
            session_id: Raw webchat conversation id.

        Returns:
            SSE iterator yielding ``data: {json}\\n\\n`` chunks.
        """
        queue = webchat_queue_mgr.subscribe_system(session_id)
        accumulators: dict[str, BotMessageAccumulator] = {}

        async def flush(message_id: str) -> None:
            acc = accumulators.pop(message_id, None)
            if acc is None or not acc.has_content():
                return
            parts = acc.build_message_parts(include_pending_tool_calls=True)
            try:
                await self.save_bot_message(
                    session_id,
                    parts,
                    {},
                    {},
                    None,
                    "webchat",
                )
            except Exception as exc:
                logger.error(
                    f"Failed to persist system event turn {message_id}: {exc}",
                    exc_info=True,
                )

        async def stream():
            try:
                while True:
                    payload = await queue.get()
                    if not isinstance(payload, dict):
                        continue
                    message_id = payload.get("message_id")
                    if not message_id or message_id in self.chat_runs:
                        # Primary run stream owns this message_id.
                        continue
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

                    msg_type = payload.get("type")
                    streaming = bool(payload.get("streaming"))
                    chain_type = payload.get("chain_type")
                    acc = accumulators.setdefault(
                        message_id, BotMessageAccumulator()
                    )
                    if msg_type == "plain":
                        acc.add_plain(
                            payload.get("data", ""),
                            chain_type=chain_type,
                            streaming=streaming,
                        )
                    elif msg_type in ("complete", "end"):
                        if (
                            msg_type == "complete"
                            and not streaming
                            and payload.get("data")
                        ):
                            acc.add_plain(
                                payload["data"],
                                chain_type=chain_type,
                                streaming=False,
                            )
                        await flush(message_id)
            finally:
                for pending_id in list(accumulators):
                    await flush(pending_id)
                webchat_queue_mgr.unsubscribe_system(session_id, queue)

        return stream()
```

- [ ] **Step 4: 运行测试确认通过 + 回归**

Run: `uv run pytest tests/test_chat_system_stream.py -v`
Expected: 3 passed

Run: `uv run pytest tests/test_chat_route.py tests/test_chat_branch.py -v`
Expected: 全 pass

- [ ] **Step 5: Lint + Commit**

```bash
uv run ruff format astrbot/dashboard/services/chat_service.py tests/test_chat_system_stream.py
uv run ruff check astrbot/dashboard/services/chat_service.py tests/test_chat_system_stream.py
git add astrbot/dashboard/services/chat_service.py tests/test_chat_system_stream.py
git commit -m "feat(dashboard): add system event stream consumer with history persistence"
```

---

### Task 4: SSE 路由 + 配置开关

**Files:**
- Modify: `astrbot/core/config/default.py`（`"dashboard"` 段加一行）
- Modify: `astrbot/dashboard/api/chat.py`
- Test: `tests/test_chat_system_stream.py`（追加路由测试）

**Interfaces:**
- Consumes: Task 3 `build_system_stream`
- Produces: `GET /api/v1/chat/sessions/{session_id}/system-stream`（SSE）；配置 `dashboard.system_stream_enabled`（默认 `True`，读时取 `service.core_lifecycle.astrbot_config`）

- [ ] **Step 1: 写失败测试（追加到 `tests/test_chat_system_stream.py`）**

```python
class TestSystemStreamConfigGate:
    def test_enabled_by_default(self):
        service = _make_service()
        service.core_lifecycle.astrbot_config = {"dashboard": {}}
        assert service.system_stream_enabled() is True

    def test_disabled_via_config(self):
        service = _make_service()
        service.core_lifecycle.astrbot_config = {
            "dashboard": {"system_stream_enabled": False}
        }
        assert service.system_stream_enabled() is False
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/test_chat_system_stream.py::TestSystemStreamConfigGate -v`
Expected: FAIL（无 `system_stream_enabled` 方法）

- [ ] **Step 3: 实现**

1. `astrbot/core/config/default.py` `"dashboard"` 段（`"auth_rate_limit"` 之前）加：

```python
        "system_stream_enabled": True,
```

2. `chat_service.py` 新增方法：

```python
    def system_stream_enabled(self) -> bool:
        """Return whether the webchat system event stream is enabled.

        Reads live config so a dashboard config update takes effect on the
        next connection without a restart.
        """
        dashboard_cfg = self.core_lifecycle.astrbot_config.get("dashboard", {})
        return bool(dashboard_cfg.get("system_stream_enabled", True))
```

3. `astrbot/dashboard/api/chat.py` 在 `create_chat_session` 路由附近新增：

```python
@router.get("/chat/sessions/{session_id}/system-stream")
async def system_stream(
    request: Request,
    session_id: str,
    auth: AuthContext = Depends(require_chat_scope),
    service: ChatService = Depends(get_service),
):
    if not service.system_stream_enabled():
        return JSONResponse(error("System stream disabled"), status_code=404)
    return StreamingResponse(
        await service.build_system_stream(auth.username, session_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Transfer-Encoding": "chunked",
            "Connection": "keep-alive",
        },
    )
```

注意 `build_system_stream` 是 async 函数返回异步迭代器，路由里 `await` 拿到迭代器再传给 `StreamingResponse`。

- [ ] **Step 4: 运行测试确认通过 + 手验路由**

Run: `uv run pytest tests/test_chat_system_stream.py -v`
Expected: 5 passed

启动后端（`uv run main.py`），带 dashboard token 访问 `GET /api/v1/chat/sessions/<某会话id>/system-stream`，确认连接挂起不报错（无事件时无输出）。不可用人工启动时跳过，E2E 阶段统一验证。

- [ ] **Step 5: Lint + Commit**

```bash
uv run ruff format astrbot/core/config/default.py astrbot/dashboard/api/chat.py astrbot/dashboard/services/chat_service.py tests/test_chat_system_stream.py
uv run ruff check astrbot/core/config/default.py astrbot/dashboard/api/chat.py astrbot/dashboard/services/chat_service.py tests/test_chat_system_stream.py
git add astrbot/core/config/default.py astrbot/dashboard/api/chat.py astrbot/dashboard/services/chat_service.py tests/test_chat_system_stream.py
git commit -m "feat(dashboard): expose system event stream SSE route behind config gate"
```

---

### Task 5: 前端 — useMessages 系统流客户端

**Files:**
- Create: `dashboard/src/composables/systemStreamRecords.ts`（纯函数叶子模块，可单测）
- Modify: `dashboard/src/composables/useMessages.ts`
- Modify: `dashboard/src/api/v1.ts`（`sendStreamUrl` 旁加 URL builder）
- Test: `dashboard/src/composables/systemStreamRecords.test.ts`（新建）

**Interfaces:**
- Consumes: Task 4 路由；既有 `readSseStream`、`processStreamPayload`、`fetchWithAuth`、`messagesBySession`、`options.onStreamUpdate`
- Produces:
  - `createSystemBotRecord(messageId: string): ChatRecord`（叶子模块）
  - composable 新增返回 `startSystemStream(sessionId: string): void` / `stopSystemStream(): void`；`loadSessionMessages` 与 `cleanupConnections` 内部自动接线（调用方零改动）

- [ ] **Step 1: 写失败测试**

Create `dashboard/src/composables/systemStreamRecords.test.ts`:

```typescript
// Author: elecvoid243
// Date: 2026-07-25
import { describe, expect, it } from "vitest";
import { createSystemBotRecord } from "./systemStreamRecords";

describe("createSystemBotRecord", () => {
  it("creates an empty bot record keyed by message id", () => {
    const record = createSystemBotRecord("msg-1");
    expect(record.id).toBe("msg-1");
    expect(record.sender_id).toBe("bot");
    expect(record.content.type).toBe("bot");
    expect(record.content.message).toEqual([]);
  });

  it("creates independent records per call", () => {
    const a = createSystemBotRecord("msg-1");
    const b = createSystemBotRecord("msg-1");
    a.content.message.push({ type: "plain", text: "x" } as never);
    expect(b.content.message).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd dashboard && pnpm vitest run src/composables/systemStreamRecords.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现叶子模块**

Create `dashboard/src/composables/systemStreamRecords.ts`:

```typescript
// Author: elecvoid243
// Date: 2026-07-25
// Plan: docs/superpowers/plans/2026-07-25-webchat-system-event-stream.md
// Pure factory for system-stream bot records, kept in a leaf module so it
// can be unit-tested from a bare node runner (same pattern as
// normalizeMessageParts.ts).
import type { ChatRecord } from "./useMessages";

export function createSystemBotRecord(messageId: string): ChatRecord {
  return {
    id: messageId,
    sender_id: "bot",
    sender_name: "bot",
    created_at: new Date().toISOString(),
    content: {
      type: "bot",
      message: [],
      reasoning: "",
      agentStats: {},
      refs: {},
    },
  } as ChatRecord;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd dashboard && pnpm vitest run src/composables/systemStreamRecords.test.ts`
Expected: 2 passed

- [ ] **Step 5: `dashboard/src/api/v1.ts` 加 URL builder（`resumeRunStreamUrl` 之后）**

```typescript
  systemStreamUrl(sessionId: string) {
    return `/api/v1/chat/sessions/${encodeURIComponent(sessionId)}/system-stream`;
  },
```

- [ ] **Step 6: `useMessages.ts` 接线**

1. 顶部 import 叶子模块：

```typescript
import { createSystemBotRecord } from "./systemStreamRecords";
```

2. composable 内部（`activeConnections` 声明附近）新增模块级状态：

```typescript
  // Author: elecvoid243 — 2026-07-25
  // System event stream state: one long-lived connection per viewed session,
  // one bot record per orphan message_id.
  let systemStreamAbort: AbortController | null = null;
  let systemStreamSessionId = "";
  const systemBotRecords = new Map<string, ChatRecord>();
```

3. 新增两个函数（放在 `startResumeStream` 之后）：

```typescript
  function stopSystemStream() {
    systemStreamAbort?.abort();
    systemStreamAbort = null;
    systemStreamSessionId = "";
    systemBotRecords.clear();
  }

  function startSystemStream(sessionId: string) {
    if (!sessionId || systemStreamSessionId === sessionId) return;
    stopSystemStream();
    const abort = new AbortController();
    systemStreamAbort = abort;
    systemStreamSessionId = sessionId;

    void (async () => {
      while (!abort.signal.aborted) {
        try {
          const response = await fetchWithAuth(
            chatApi.systemStreamUrl(sessionId),
            {
              headers: { Accept: "text/event-stream" },
              signal: abort.signal,
            },
          );
          if (!response.ok || !response.body) return; // 404 (disabled) or error: stay silent
          await readSseStream(response.body, (payload) => {
            const messageId = String(payload?.message_id || "");
            if (!messageId) return;
            const records = messagesBySession[sessionId];
            if (!records) return;
            let botRecord = systemBotRecords.get(messageId);
            if (!botRecord) {
              // Defensive dedup: if the primary stream owns this message_id
              // (activeConnections is keyed by it), route to its record and
              // never create a duplicate bubble. Backend already filters
              // active runs; this is a belt-and-suspenders O(1) guard.
              const primary = activeConnections[messageId];
              if (primary?.botRecord) {
                systemBotRecords.set(messageId, primary.botRecord);
                return;
              }
              botRecord = createSystemBotRecord(messageId);
              systemBotRecords.set(messageId, botRecord);
              records.push(botRecord);
            }
            processStreamPayload(botRecord, payload);
            options.onStreamUpdate?.(sessionId);
          });
        } catch (error) {
          if (abort.signal.aborted) return;
          console.error("System stream error, retrying:", error);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    })();
  }
```

4. `loadSessionMessages` 函数体最末尾（历史加载完成后）加一行：

```typescript
    startSystemStream(sessionId);
```

5. `cleanupConnections` 函数体最末尾加一行：

```typescript
    stopSystemStream();
```

6. composable `return { ... }` 中导出两个新函数（供需要手动控制的调用方使用）。

- [ ] **Step 7: 类型检查 + 既有前端测试回归**

Run: `cd dashboard && pnpm typecheck`
Expected: 无 error

Run: `cd dashboard && pnpm vitest run src/composables/useMessages.test.ts src/composables/systemStreamRecords.test.ts`
Expected: 全 pass

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/composables/systemStreamRecords.ts dashboard/src/composables/systemStreamRecords.test.ts dashboard/src/composables/useMessages.ts dashboard/src/api/v1.ts
git commit -m "feat(chatui): subscribe system event stream and render orphan turns inline"
```

---

### Task 6: 全量回归 + E2E 手测 + 收尾

**Files:** 无新增（验证与清理）

- [ ] **Step 1: 后端全量相关测试**

Run: `uv run pytest tests/test_webchat_system_stream.py tests/test_chat_system_stream.py tests/test_chat_route.py tests/test_chat_branch.py -v`
Expected: 全 pass

- [ ] **Step 2: 前端类型检查 + 全量 vitest**

Run: `cd dashboard && pnpm typecheck && pnpm test`
Expected: 无 error，全 pass

- [ ] **Step 3: ruff 全仓检查**

Run: `uv run ruff format . && uv run ruff check .`
Expected: 无改动、无 error

- [ ] **Step 4: E2E 手测清单（启动 `uv run main.py` + `cd dashboard && pnpm dev`）**

- 打开 webchat 聊天页 → `/goal set 每天总结一次新闻` → **实时看到**目标循环每轮回复与工具调用出现在聊天流（自然样式，与普通消息一致）
- 循环进行中**刷新页面** → 历史里 goal 轮与正常消息按时间混排、完整可见
- 循环进行中正常发一条消息 → 主流程流式回复正常，无重复、无串扰
- dashboard 配置把 `system_stream_enabled` 关掉 → 刷新后聊天页回到现状（goal 轮不显示），主聊天不受影响
- 开两个 tab 看同一会话 → 两边都能看到 goal 轮输出（fan-out）

- [ ] **Step 5: 最终提交（如有清理改动）**

```bash
git add -A
git commit -m "chore: final lint and cleanup for system event stream"
git log --oneline -8
```

Expected: 分支上 5-6 个 commit（docs + 5 个 task），无未提交文件。**不 push。**
