# ChatUI 会话「分支」功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ChatUI 任意 bot 消息尾部提供「分支」按钮，一键创建继承截至该消息上下文与展示历史的全新会话。

**Architecture:** 后端快照复制——新增 `ChatService.branch_session()` 原子化完成「新建 PlatformSession + 截断复制 ConversationV2（含 persona）+ 复制 PlatformMessageHistory + 插入 branch_info 分界记录」，经 `POST /api/v1/chat/sessions/{sid}/messages/{mid}/branch` 暴露；前端在 `ChatMessageList.vue` 消息尾部新增分支按钮，`branch_info` 记录渲染为可折叠分界条。

**Tech Stack:** Python 3.10+ / FastAPI / SQLAlchemy (aiosqlite) / pytest+asyncio；Vue 3 + Vuetify + TypeScript / vue-i18n。

**Spec:** `docs/superpowers/specs/2026-07-24-chatui-session-branch-design.md`

## Global Constraints

- 所有注释与日志使用 **English**（AGENTS.md）；docstring 用 Google 格式（`Args:`/`Returns:`/`Raises:`）。
- 代码风格：`ruff format .` + `ruff check .` 必须通过。
- 路径处理用 `pathlib.Path`；本功能不涉及文件路径，无需引入。
- 后端 API 路由变更后必须重新生成前端 client：`cd dashboard && pnpm generate:api`。
- Commit 使用 conventional commits（如 `feat: add session branch support to ChatUI`），**仅本地提交，禁止 push、禁止 PR**。
- KISS：不抽象新 helper，逻辑内联在 `branch_session()` 中（与相邻的 `prepare_regenerate_message_payload` 同构）。
- 分支粒度：任意 bot 消息；截断含该消息的 checkpoint（`history[:checkpoint_index+1]`）。
- 展示历史：完整复制 + `branch_info` 分界记录；前端继承部分可折叠，折叠状态按 umo 存 localStorage。
- 配置继承：仅 `ConversationV2.persona_id` 随对话复制；前端分支成功后按 `newSession()` 同款逻辑把当前选中 config 绑定到新 umo。
- 命名避坑：zh-CN `features/chat.json` 中 `thread.*` 已占用「分支」一词（side thread 功能）；本功能新 key 一律放在 `branch.*` 下，中文文案用「分支会话」。
- 明确不做：不复制附件文件、不复制 side threads、不复制 token_usage / session_variables、不动 legacy `/api/chat/*` 路由。

---

### Task 1: 后端 `ChatService.branch_session()`（TDD）

**Files:**
- Modify: `astrbot/dashboard/services/chat_service.py`（在 `prepare_regenerate_message_payload_from_dashboard_payload` 方法之后追加新方法，约 :2168 处）
- Test: `tests/test_chat_branch.py`（新建）

**Interfaces:**
- Consumes（均已存在，签名已核实）:
  - `self.db.get_platform_session_by_id(session_id) -> PlatformSession | None`（字段：`session_id, platform_id, creator, is_group, display_name`）
  - `self.db.get_platform_message_history_by_id(message_id) -> PlatformMessageHistory | None`（字段：`id, platform_id, user_id, content, sender_id, sender_name, llm_checkpoint_id, created_at`）
  - `self.db.create_platform_session(creator, platform_id="webchat", session_id=None, display_name=None, is_group=0) -> PlatformSession`
  - `self.load_current_conversation_history(session) -> tuple[str, list]`（同文件 :997）
  - `self.get_sorted_platform_history(session) -> list`（同文件 :1018，按 `(created_at, id)` 升序）
  - `self.conv_mgr.get_conversation(unified_msg_origin, conversation_id) -> Conversation | None`（字段：`history(str JSON), title, persona_id, cid`）
  - `self.conv_mgr.new_conversation(unified_msg_origin, platform_id=None, content=None, title=None, persona_id=None) -> str`
  - `self.platform_history_mgr.insert(platform_id, user_id, content, sender_id=None, sender_name=None, llm_checkpoint_id=None)`
  - `find_checkpoint_index(history, checkpoint_id) -> int | None`（同文件 :675）
  - `build_webchat_unified_msg_origin(session) -> str`（同文件 :628）
  - `deepcopy`（同文件 :9 已导入）
- Produces:
  - `ChatService.branch_session(username: str, session_id: str, message_id: int | str) -> dict`
  - 返回 `{"session_id": str, "display_name": str | None, "inherited_count": int}`
  - `branch_info` 展示记录 content 结构：`{"type": "branch_info", "source_session_id": str, "source_message_id": int, "inherited_count": int}`

- [ ] **Step 1: 写失败测试**

新建 `tests/test_chat_branch.py`：

```python
"""Tests for ChatService.branch_session (ChatUI session branching).

Author: elecvoid243
Date: 2026-07-24
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from astrbot.dashboard.services.chat_service import ChatService, ChatServiceError

SRC_SESSION_ID = "src-session"
NEW_SESSION_ID = "new-session"


def _history_record(
    record_id: int,
    type_: str,
    checkpoint: str | None = None,
    user_id: str = SRC_SESSION_ID,
):
    return SimpleNamespace(
        id=record_id,
        platform_id="webchat",
        user_id=user_id,
        content={"type": type_, "message": [{"type": "plain", "text": f"m{record_id}"}]},
        sender_id="alice" if type_ == "user" else "bot",
        sender_name="alice" if type_ == "user" else "bot",
        llm_checkpoint_id=checkpoint,
        created_at=datetime(2026, 7, 24, 0, 0, record_id, tzinfo=UTC),
    )


def _llm_history() -> list[dict]:
    # Two turns; each turn ends with an internal checkpoint message.
    return [
        {"role": "user", "content": "u1"},
        {"role": "assistant", "content": "a1"},
        {"role": "_checkpoint", "content": {"id": "cp-1"}},
        {"role": "user", "content": "u2"},
        {"role": "assistant", "content": "a2"},
        {"role": "_checkpoint", "content": {"id": "cp-2"}},
    ]


def _make_service(
    *,
    session_creator: str = "alice",
    target_record=None,
    llm_history: list[dict] | None = None,
) -> ChatService:
    """Build a ChatService with mocked persistence for branch tests."""
    session = SimpleNamespace(
        session_id=SRC_SESSION_ID,
        platform_id="webchat",
        creator=session_creator,
        is_group=0,
        display_name="源会话",
    )
    new_session = SimpleNamespace(
        session_id=NEW_SESSION_ID,
        platform_id="webchat",
        creator="alice",
        is_group=0,
        display_name="分支 · 源会话",
    )
    history_records = [
        _history_record(1, "user", "cp-1"),
        _history_record(2, "bot", "cp-1"),
        _history_record(3, "user", "cp-2"),
        _history_record(4, "bot", "cp-2"),
    ]
    if target_record is None:
        target_record = history_records[1]  # branch at turn-1 bot message

    db = Mock()
    db.get_platform_session_by_id = AsyncMock(return_value=session)
    db.get_platform_message_history_by_id = AsyncMock(return_value=target_record)
    db.create_platform_session = AsyncMock(return_value=new_session)

    conversation = SimpleNamespace(
        cid="conv-1",
        history='[]',  # unused; load_current_conversation_history is stubbed below
        title="源对话",
        persona_id="persona-1",
    )
    conv_mgr = Mock()
    conv_mgr.get_conversation = AsyncMock(return_value=conversation)
    conv_mgr.new_conversation = AsyncMock(return_value="new-conv-id")

    platform_history_mgr = Mock()
    platform_history_mgr.get = AsyncMock(return_value=history_records)
    platform_history_mgr.insert = AsyncMock(
        return_value=SimpleNamespace(id=99, created_at=datetime.now(UTC))
    )

    core_lifecycle = SimpleNamespace(
        conversation_manager=conv_mgr,
        platform_message_history_manager=platform_history_mgr,
        umop_config_router=Mock(),
    )
    service = ChatService(Mock(), core_lifecycle)
    service.db = db
    service.load_current_conversation_history = AsyncMock(
        return_value=("conv-1", llm_history if llm_history is not None else _llm_history())
    )
    return service


@pytest.mark.asyncio
async def test_branch_session_copies_context_and_display_history():
    service = _make_service()

    result = await service.branch_session("alice", SRC_SESSION_ID, 2)

    assert result == {
        "session_id": NEW_SESSION_ID,
        "display_name": "分支 · 源会话",
        "inherited_count": 2,
    }

    # New platform session carries the branch-prefixed display name.
    create_kwargs = service.db.create_platform_session.await_args.kwargs
    assert create_kwargs["creator"] == "alice"
    assert create_kwargs["platform_id"] == "webchat"
    assert create_kwargs["display_name"] == "分支 · 源会话"

    # LLM history is truncated at the branch checkpoint (inclusive) and
    # persona/title are inherited.
    new_conv_kwargs = service.conv_mgr.new_conversation.await_args.kwargs
    assert new_conv_kwargs["content"] == _llm_history()[:3]
    assert new_conv_kwargs["persona_id"] == "persona-1"
    assert new_conv_kwargs["title"] == "源对话"

    # Display history: records 1-2 copied, then one branch_info divider.
    inserts = service.platform_history_mgr.insert.await_args_list
    assert len(inserts) == 3
    assert inserts[0].kwargs["user_id"] == NEW_SESSION_ID
    assert inserts[0].kwargs["content"]["type"] == "user"
    assert inserts[0].kwargs["llm_checkpoint_id"] == "cp-1"
    assert inserts[1].kwargs["content"]["type"] == "bot"
    divider = inserts[2].kwargs["content"]
    assert divider["type"] == "branch_info"
    assert divider["source_session_id"] == SRC_SESSION_ID
    assert divider["source_message_id"] == 2
    assert divider["inherited_count"] == 2


@pytest.mark.asyncio
async def test_branch_session_rejects_user_message():
    service = _make_service(target_record=_history_record(1, "user", "cp-1"))
    with pytest.raises(ChatServiceError, match="Only bot messages"):
        await service.branch_session("alice", SRC_SESSION_ID, 1)


@pytest.mark.asyncio
async def test_branch_session_rejects_message_without_checkpoint():
    service = _make_service(target_record=_history_record(2, "bot", None))
    with pytest.raises(ChatServiceError, match="not linked to LLM history"):
        await service.branch_session("alice", SRC_SESSION_ID, 2)


@pytest.mark.asyncio
async def test_branch_session_rejects_foreign_session():
    service = _make_service(session_creator="bob")
    with pytest.raises(ChatServiceError, match="Permission denied"):
        await service.branch_session("alice", SRC_SESSION_ID, 2)


@pytest.mark.asyncio
async def test_branch_session_rejects_unknown_checkpoint():
    service = _make_service(
        target_record=_history_record(2, "bot", "cp-missing"),
    )
    with pytest.raises(ChatServiceError, match="Linked checkpoint not found"):
        await service.branch_session("alice", SRC_SESSION_ID, 2)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd F:\github\Astrbot && uv run pytest tests/test_chat_branch.py -v`
Expected: FAIL — `AttributeError: 'ChatService' object has no attribute 'branch_session'`

- [ ] **Step 3: 实现 `branch_session()`**

在 `astrbot/dashboard/services/chat_service.py` 的 `prepare_regenerate_message_payload_from_dashboard_payload` 方法（:2160-2168）之后插入：

```python
    async def branch_session(
        self,
        username: str,
        session_id: str,
        message_id: int | str,
    ) -> dict:
        """Create a new session inheriting context up to a given bot message.

        Snapshots the source session: truncates the LLM conversation history
        at the message's checkpoint (inclusive), copies platform display
        history up to the message, and appends a ``branch_info`` divider
        record so the dashboard can render the inherited part collapsible.

        Args:
            username: Dashboard username; must own the source session.
            session_id: Source webchat session ID.
            message_id: Platform message history ID of the bot message to
                branch at.

        Returns:
            Dict with ``session_id``, ``display_name`` and ``inherited_count``
            of the newly created session.

        Raises:
            ChatServiceError: On validation failures (missing session or
                message, wrong owner, non-bot message, missing checkpoint).
        """
        try:
            message_id = int(message_id)
        except (TypeError, ValueError) as exc:
            raise ChatServiceError("Invalid key: message_id") from exc

        session = await self.db.get_platform_session_by_id(session_id)
        if not session:
            raise ChatServiceError(f"Session {session_id} not found")
        if session.creator != username:
            raise ChatServiceError("Permission denied")

        target_record = await self.db.get_platform_message_history_by_id(message_id)
        if not target_record:
            raise ChatServiceError(f"Message {message_id} not found")
        if (
            target_record.platform_id != session.platform_id
            or target_record.user_id != session_id
        ):
            raise ChatServiceError("Message does not belong to the session")
        if not isinstance(target_record.content, dict):
            raise ChatServiceError("Invalid message content")
        if target_record.content.get("type") != "bot":
            raise ChatServiceError("Only bot messages can be branched")

        checkpoint_id = target_record.llm_checkpoint_id
        if not checkpoint_id:
            raise ChatServiceError("Message is not linked to LLM history")

        conversation_id, history = await self.load_current_conversation_history(
            session
        )
        checkpoint_index = find_checkpoint_index(history, checkpoint_id)
        if not conversation_id or checkpoint_index is None:
            raise ChatServiceError("Linked checkpoint not found")

        source_conversation = await self.conv_mgr.get_conversation(
            unified_msg_origin=build_webchat_unified_msg_origin(session),
            conversation_id=conversation_id,
        )

        source_title = (
            session.display_name
            or (source_conversation.title if source_conversation else None)
            or "新对话"
        )
        new_session = await self.db.create_platform_session(
            creator=username,
            platform_id=session.platform_id,
            is_group=session.is_group,
            display_name=f"分支 · {source_title}",
        )

        await self.conv_mgr.new_conversation(
            build_webchat_unified_msg_origin(new_session),
            platform_id=session.platform_id,
            content=deepcopy(history[: checkpoint_index + 1]),
            title=source_conversation.title if source_conversation else None,
            persona_id=source_conversation.persona_id if source_conversation else None,
        )

        platform_history = await self.get_sorted_platform_history(session)
        inherited_count = 0
        for item in platform_history:
            if item.id is None or item.id > target_record.id:
                break
            await self.platform_history_mgr.insert(
                platform_id=session.platform_id,
                user_id=new_session.session_id,
                content=deepcopy(item.content),
                sender_id=item.sender_id,
                sender_name=item.sender_name,
                llm_checkpoint_id=item.llm_checkpoint_id,
            )
            inherited_count += 1

        await self.platform_history_mgr.insert(
            platform_id=session.platform_id,
            user_id=new_session.session_id,
            content={
                "type": "branch_info",
                "source_session_id": session_id,
                "source_message_id": message_id,
                "inherited_count": inherited_count,
            },
            sender_id="bot",
            sender_name="bot",
        )

        return {
            "session_id": new_session.session_id,
            "display_name": new_session.display_name,
            "inherited_count": inherited_count,
        }
```

注意：`item.id > target_record.id` 依赖展示历史 id 自增单调（与 `(created_at, id)` 排序一致），与 regenerate 中按 id 操作的既有假设相同。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd F:\github\Astrbot && uv run pytest tests/test_chat_branch.py -v`
Expected: 5 passed

- [ ] **Step 5: 回归既有 chat 路由测试 + 格式化**

Run: `cd F:\github\Astrbot && uv run pytest tests/test_chat_route.py -v && ruff format astrbot/dashboard/services/chat_service.py tests/test_chat_branch.py && ruff check astrbot/dashboard/services/chat_service.py tests/test_chat_branch.py`
Expected: all passed; ruff 无输出错误

- [ ] **Step 6: Commit**

```bash
git add astrbot/dashboard/services/chat_service.py tests/test_chat_branch.py
git commit -m "feat: add ChatService.branch_session for ChatUI session branching"
```

---

### Task 2: 后端 API 路由 + 重新生成前端 client

**Files:**
- Modify: `astrbot/dashboard/api/chat.py`（在 `regenerate_chat_message` 路由 :223 之后插入）
- Modify（自动生成）: `dashboard/src/api/generated/openapi-v1/sdk.gen.ts`, `types.gen.ts`
- Test: `tests/test_chat_branch.py`（追加路由级用例）

**Interfaces:**
- Consumes: Task 1 的 `ChatService.branch_session(username, session_id, message_id)`；路由文件既有工具 `_run`、`require_chat_scope`、`get_service`、`AuthContext`。
- Produces: `POST /api/v1/chat/sessions/{session_id}/messages/{message_id}/branch` → `{status: "ok", data: {session_id, display_name, inherited_count}}`；生成 client 函数 `branchChatMessage({path: {session_id, message_id}})`。

- [ ] **Step 1: 追加路由级失败测试**

在 `tests/test_chat_branch.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_branch_route_returns_ok_payload():
    from astrbot.dashboard.api.chat import branch_chat_message

    service = SimpleNamespace(
        branch_session=AsyncMock(
            return_value={
                "session_id": NEW_SESSION_ID,
                "display_name": "分支 · 源会话",
                "inherited_count": 2,
            }
        )
    )
    auth = SimpleNamespace(username="alice")

    response = await branch_chat_message(SRC_SESSION_ID, "2", auth, service)

    # `_run` wraps the result via `ok()` which returns a plain dict.
    assert response["status"] == "ok"
    assert response["data"]["session_id"] == NEW_SESSION_ID
    service.branch_session.assert_awaited_once_with("alice", SRC_SESSION_ID, "2")


@pytest.mark.asyncio
async def test_branch_route_surfaces_service_error():
    from astrbot.dashboard.api.chat import branch_chat_message

    service = SimpleNamespace(
        branch_session=AsyncMock(side_effect=ChatServiceError("Permission denied"))
    )
    auth = SimpleNamespace(username="alice")

    response = await branch_chat_message(SRC_SESSION_ID, "2", auth, service)

    assert response["status"] == "error"
    assert response["message"] == "Permission denied"
```

（路由经 `_run()` 返回 `ok()`/`error()` 产生的普通 dict，不是 JSONResponse，无需 `json.loads`。）

- [ ] **Step 2: 运行测试确认失败**

Run: `cd F:\github\Astrbot && uv run pytest tests/test_chat_branch.py -v -k route`
Expected: FAIL — `ImportError: cannot import name 'branch_chat_message'`

- [ ] **Step 3: 添加路由**

在 `astrbot/dashboard/api/chat.py` 的 `regenerate_chat_message`（:223-245）之后插入：

```python
@router.post("/chat/sessions/{session_id}/messages/{message_id}/branch")
async def branch_chat_message(
    session_id: str,
    message_id: str,
    auth: AuthContext = Depends(require_chat_scope),
    service: ChatService = Depends(get_service),
):
    return await _run(
        lambda: service.branch_session(auth.username, session_id, message_id)
    )
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd F:\github\Astrbot && uv run pytest tests/test_chat_branch.py -v`
Expected: 7 passed

- [ ] **Step 5: 重新生成前端 OpenAPI client**

Run: `cd F:\github\Astrbot\dashboard && pnpm generate:api`
Expected: 成功；`sdk.gen.ts` 中出现 `branchChatMessage`，url 为 `/api/v1/chat/sessions/{session_id}/messages/{message_id}/branch`

- [ ] **Step 6: ruff + Commit**

```bash
cd F:\github\Astrbot
ruff format astrbot/dashboard/api/chat.py tests/test_chat_branch.py
ruff check astrbot/dashboard/api/chat.py tests/test_chat_branch.py
git add astrbot/dashboard/api/chat.py tests/test_chat_branch.py dashboard/src/api/generated
git commit -m "feat: add branch endpoint for webchat chat sessions"
```

---

### Task 3: 前端分支按钮 + 跳转流程（含 i18n）

**Files:**
- Modify: `dashboard/src/api/v1.ts`（`chatApi` 中 `regenerateMessageUrl` 之后，约 :873）
- Modify: `dashboard/src/components/chat/ChatMessageList.vue`（props/emits/canBranchMessage/按钮）
- Modify: `dashboard/src/components/chat/Chat.vue`（`enable-branch` 绑定、`@branch` 监听、`handleBranchMessage`，约 :505-519 与 :2259 附近）
- Modify: `dashboard/src/i18n/locales/zh-CN/features/chat.json`、`en-US/features/chat.json`、`ru-RU/features/chat.json`

**Interfaces:**
- Consumes: 生成的 `openApiV1.branchChatMessage`（Task 2）；`Chat.vue` 既有 `selectSession(sessionId)`（:1870）、`getSessions()`、`toast`、`tm`、`chatApi`、`isUserMessage`；`useSessions.ts` 的 `newSession()` 同款 config 绑定模式（`getStoredSelectedChatConfigId` + `buildWebchatUmoDetails` + `configRouteApi.upsert`，见 useSessions.ts:50-66）。
- Produces:
  - `chatApi.branchMessage(sessionId: string, messageId: string | number)` → `{status, data: {session_id, display_name, inherited_count}}`
  - `ChatMessageList` 新 prop `enableBranch?: boolean`（默认 `false`）、新 emit `branch: [message: ChatRecord]`
  - `Chat.vue.handleBranchMessage(message: ChatRecord)`

- [ ] **Step 1: 添加 i18n 文案**

`zh-CN/features/chat.json` 的 `"actions"` 对象同级（注意是 `features.chat` 根下）新增：

```json
  "branch": {
    "action": "分支会话",
    "success": "已创建分支会话",
    "failed": "创建分支会话失败"
  },
```

`en-US/features/chat.json`：

```json
  "branch": {
    "action": "Branch",
    "success": "Branched session created",
    "failed": "Failed to create branched session"
  },
```

`ru-RU/features/chat.json`：

```json
  "branch": {
    "action": "Создать ветку",
    "success": "Ветка диалога создана",
    "failed": "Не удалось создать ветку диалога"
  },
```

（放入与 `"thread"` 对象相邻的位置，保持 JSON 结构合法。）

- [ ] **Step 2: API wrapper**

`dashboard/src/api/v1.ts` 的 `chatApi` 中 `regenerateMessageUrl(...)`（:871-873）之后插入：

```typescript
  branchMessage(sessionId: string, messageId: string | number) {
    return typed<any>(
      openApiV1.branchChatMessage({
        path: { session_id: sessionId, message_id: String(messageId) },
      }) as any,
    );
  },
```

- [ ] **Step 3: ChatMessageList.vue — prop、emit、显示条件、按钮**

3a. props 定义（:513-517 区域）`enableRegenerate?: boolean;` 之后加一行：

```typescript
    enableBranch?: boolean;
```

`withDefaults` 默认值块（:533-537 区域）`enableRegenerate: false,` 之后加：

```typescript
    enableBranch: false,
```

3b. emits（:550-554 区域）`regenerateWithModel: [...]` 之后加：

```typescript
  branch: [message: ChatRecord];
```

3c. `canRegenerateMessage` 函数（:970-978）之后加：

```typescript
function canBranchMessage(message: ChatRecord, messageIndex: number) {
  return (
    props.enableBranch &&
    !isUserMessage(message) &&
    !isBranchDivider(message) &&
    !messageContent(message).isLoading &&
    !isMessageStreaming(message, messageIndex) &&
    Boolean(message.llm_checkpoint_id) &&
    message.id != null &&
    !String(message.id).startsWith("local-")
  );
}
```

（`isBranchDivider` 在 Task 4 定义；本任务先写 `function isBranchDivider(message: ChatRecord) { return messageContent(message).type === "branch_info"; }`，Task 4 复用。）

3d. `.message-meta` 块中 `RegenerateMenu`（:331-335）之后插入按钮：

```vue
            <v-btn
              v-if="canBranchMessage(msg, msgIndex)"
              icon="mdi-source-fork"
              size="x-small"
              variant="text"
              :title="tm('branch.action')"
              @click="emit('branch', msg)"
            />
```

- [ ] **Step 4: Chat.vue — 绑定与处理函数**

4a. `ChatMessageList` 使用处（:505 附近 `enable-regenerate` 一行之后）加：

```vue
              enable-branch
```

并在 `@regenerate-with-model="handleRegenerateMessage"`（:514）之后加：

```vue
              @branch="handleBranchMessage"
```

4b. `handleRegenerateMessage`（:2259-2270）之后插入：

```typescript
async function handleBranchMessage(message: ChatRecord) {
  if (!currSessionId.value || isUserMessage(message) || message.id == null)
    return;
  try {
    const response = await chatApi.branchMessage(currSessionId.value, message.id);
    if (response.data?.status !== "ok") {
      toast.error(response.data?.message || tm("branch.failed"));
      return;
    }
    const data = response.data?.data as
      | { session_id?: string }
      | undefined;
    const newSessionId = data?.session_id;
    if (!newSessionId) {
      toast.error(tm("branch.failed"));
      return;
    }
    // Bind the currently selected chat config to the branched session,
    // mirroring the binding logic in useSessions.newSession().
    const selectedConfigId = getStoredSelectedChatConfigId();
    if (selectedConfigId && selectedConfigId !== "default") {
      try {
        const umoDetails = buildWebchatUmoDetails(newSessionId, false);
        await configRouteApi.upsert(umoDetails.umo, {
          config_id: selectedConfigId,
        });
      } catch (err) {
        console.error("Failed to bind config to branched session", err);
      }
    }
    await getSessions();
    toast.success(tm("branch.success"));
    await selectSession(newSessionId);
  } catch (error) {
    console.error("Failed to branch session:", error);
    toast.error(tm("branch.failed"));
  }
}
```

4c. 检查并补齐 import（Chat.vue 顶部）：`getStoredSelectedChatConfigId`、`buildWebchatUmoDetails`（来自 `@/utils/chatConfigBinding`）、`configRouteApi`（来自 `@/api/v1`）。若已存在则跳过。

- [ ] **Step 5: 类型检查 + Commit**

Run: `cd F:\github\Astrbot\dashboard && pnpm vue-tsc --noEmit`（若仓库 script 有 `pnpm type-check` 则用它）
Expected: 无新增类型错误

```bash
cd F:\github\Astrbot
git add dashboard/src/api/v1.ts dashboard/src/components/chat/ChatMessageList.vue dashboard/src/components/chat/Chat.vue dashboard/src/i18n/locales
git commit -m "feat: add branch button to ChatUI message actions"
```

---

### Task 4: 继承历史分界条与折叠（含 i18n）

**Files:**
- Modify: `dashboard/src/composables/useMessages.ts`（`normalizeHistoryRecord`，约 :666-688）
- Modify: `dashboard/src/components/chat/ChatMessageList.vue`（模板 v-for 行、divider 渲染、折叠状态）
- Modify: 三个 locale 的 `features/chat.json`（`branch.*` 追加 key）

**Interfaces:**
- Consumes: Task 3 的 `isBranchDivider()`；`normalizeHistoryRecord`；`props.currentUmo`（折叠状态 storage key）；`tm(key, params)` 支持插值（参照 `threadCountLabel`，:1015-1017）。
- Produces:
  - `branch_info` 记录经 normalize 后 `content.inherited_count: number` 保留；
  - `ChatMessageList` 内：`branchDividerIndex: ComputedRef<number>`、`branchCollapsed: Ref<boolean>`、`toggleBranchCollapsed()`、`isInheritedCollapsedRow(index: number)`。

- [ ] **Step 1: i18n 追加**

三个 locale 的 `branch` 对象中各加一行：

```json
    "inherited": "已继承 {count} 条上文"
```

```json
    "inherited": "{count} inherited messages"
```

```json
    "inherited": "Унаследовано сообщений: {count}"
```

- [ ] **Step 2: normalizeHistoryRecord 保留 inherited_count**

`useMessages.ts` 的 `normalizeHistoryRecord`（:666-688）中，`normalizedContent` 字面量改为：

```typescript
    const normalizedContent: ChatContent = {
      type: content.type || (record.sender_id === "bot" ? "bot" : "user"),
      message: normalizedMessage,
      reasoning: extractReasoningText(
        normalizedMessage,
        content.reasoning || "",
      ),
      agentStats: content.agentStats || content.agent_stats,
      refs: content.refs,
      inherited_count: content.inherited_count,
    };
```

若 `ChatContent` 类型（同文件上部定义）没有 `inherited_count` 字段，补充可选字段：

```typescript
  inherited_count?: number;
```

- [ ] **Step 3: ChatMessageList.vue — 折叠状态与分界条**

3a. script 中（`isBranchDivider` 附近）新增：

```typescript
const BRANCH_COLLAPSED_STORAGE_PREFIX = "chat.branchCollapsed.";

const branchDividerIndex = computed(() =>
  props.messages.findIndex((message) => isBranchDivider(message)),
);

function branchStorageKey() {
  return `${BRANCH_COLLAPSED_STORAGE_PREFIX}${props.currentUmo || "default"}`;
}

const branchCollapsed = ref(false);

onMounted(() => {
  try {
    branchCollapsed.value =
      localStorage.getItem(branchStorageKey()) === "1";
  } catch {
    // Ignore storage errors (e.g. private mode).
  }
});

function toggleBranchCollapsed() {
  branchCollapsed.value = !branchCollapsed.value;
  try {
    localStorage.setItem(branchStorageKey(), branchCollapsed.value ? "1" : "0");
  } catch {
    // Ignore storage errors.
  }
}

function isInheritedCollapsedRow(messageIndex: number) {
  return (
    branchCollapsed.value &&
    branchDividerIndex.value > 0 &&
    messageIndex < branchDividerIndex.value
  );
}

function branchInheritedCount(message: ChatRecord) {
  return messageContent(message).inherited_count ?? 0;
}
```

（`computed`、`ref`、`onMounted` 已在 :471 的 vue import 中，确认 `onMounted` 已导入；`ChatContent` 上 `inherited_count` 通过 `messageContent()` 返回类型带出，若类型缺失则在 `messageContent` 返回类型处一并补充。）

3b. 模板：消息行 `v-for` 的根 div（:7-12）加 `v-show`：

```vue
      <div
        v-for="(msg, msgIndex) in messages"
        v-show="!isInheritedCollapsedRow(msgIndex)"
        :key="msg.id || `${msgIndex}-${msg.created_at || ''}`"
        class="message-row"
        :class="[
          isUserMessage(msg) ? 'from-user' : 'from-bot',
          { 'branch-divider-row': isBranchDivider(msg) },
        ]"
      >
```

3c. 行内容分流：在 `<v-avatar v-if="!isUserMessage(msg)" ...>`（:13）之前插入分界条，并给原有头像与 `<div class="message-stack">` 的显示加条件。最小改动方案——在 avatar 之前插入：

```vue
        <button
          v-if="isBranchDivider(msg)"
          class="branch-divider-bar"
          type="button"
          @click="toggleBranchCollapsed"
        >
          <v-icon size="14">mdi-source-fork</v-icon>
          <span>{{
            tm("branch.inherited", { count: branchInheritedCount(msg) })
          }}</span>
          <v-icon size="14">{{
            branchCollapsed ? "mdi-chevron-down" : "mdi-chevron-up"
          }}</v-icon>
        </button>
```

并把原 `<v-avatar v-if="!isUserMessage(msg)"` 改为 `v-if="!isUserMessage(msg) && !isBranchDivider(msg)"`，把 `<div class="message-stack">`（:27）改为 `<div v-if="!isBranchDivider(msg)" class="message-stack">`。

3d. 样式（组件 `<style>` 块末尾追加）：

```css
.branch-divider-row {
  justify-content: center;
}

.branch-divider-bar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  margin: 8px auto;
  border-radius: 999px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 12px;
  background: transparent;
  cursor: pointer;
}

.branch-divider-bar:hover {
  color: rgba(var(--v-theme-on-surface), 0.87);
  border-color: rgba(var(--v-theme-on-surface), 0.24);
}
```

- [ ] **Step 4: 类型检查 + Commit**

Run: `cd F:\github\Astrbot\dashboard && pnpm vue-tsc --noEmit`
Expected: 无新增类型错误

```bash
cd F:\github\Astrbot
git add dashboard/src/composables/useMessages.ts dashboard/src/components/chat/ChatMessageList.vue dashboard/src/i18n/locales
git commit -m "feat: render collapsible divider for inherited branch history"
```

---

### Task 5: 端到端验证

**Files:** 无新增（验证任务）

- [ ] **Step 1: 后端全量相关测试**

Run: `cd F:\github\Astrbot && uv run pytest tests/test_chat_branch.py tests/test_chat_route.py tests/test_conversation_checkpoint.py -v`
Expected: all passed

- [ ] **Step 2: 全仓 ruff**

Run: `cd F:\github\Astrbot && ruff format . && ruff check .`
Expected: 无错误（若 `ruff format` 改动了与本功能无关的既有文件，`git checkout -- <those files>` 还原，只保留本功能文件）

- [ ] **Step 3: 手动 UI 验证清单**

启动 `uv run main.py` + `cd dashboard && pnpm dev`，在 ChatUI 中：

1. 进行 ≥3 轮对话；确认**每条** bot 消息尾部出现分叉图标按钮（`mdi-source-fork`），user 消息与流式中的消息没有；
2. 点击第 1 轮的 bot 消息分支按钮 → toast 成功 → 自动跳转到标题为「分支 · xxx」的新会话；
3. 新会话中：展示历史只包含分支点之前的消息 + 分界条「已继承 N 条上文」；点击分界条折叠/展开，刷新页面后状态保留；
4. 在新会话发送消息，确认模型记得分支点之前的上下文（可问"我一开始问了什么"）；
5. 在新会话最后一条 bot 消息上点重试，确认 regenerate 正常（checkpoint 兼容）；
6. 回到原会话，确认其消息与上下文完全未变；
7. 无 checkpoint 的旧会话（升级前数据）中 bot 消息**不显示**分支按钮。

- [ ] **Step 4: 最终 Commit（如有修正）**

```bash
git add -A
git commit -m "fix: address issues found in branch e2e verification"
```

---

## Self-Review 记录

- **Spec 覆盖**：spec §4.1 后端（Task 1、2）✅；§4.2 前端五行表格（Task 2 client 再生成、Task 3 v1.ts/ChatMessageList/Chat.vue、Task 4 useMessages normalize + 分界条）✅；§4.4 错误路径（Task 1 测试 4 条 + 前端 toast）✅；§4.5 YAGNI 项均未引入 ✅；§5 测试（Task 1/2 后端用例、Task 5 手动清单）✅。
- **i18n**：spec 只提 zh/en，实现按仓库三语言惯例补 ru-RU（与既有功能一致）。
- **类型一致性**：`branch_session` 返回键 `session_id/display_name/inherited_count` 在 Task 1 测试、Task 2 路由、Task 3 前端读取处一致；`branch_info.inherited_count` 后端写入、normalize 保留、前端 `branchInheritedCount` 读取一致。
- **已知取舍**：`normalizeHistoryRecord` 只透传 `inherited_count` 一个额外字段（而非全量 spread），避免影响其他记录类型；折叠用 `v-show` 而非数组切片，保证 `canRegenerateMessage`/`canEditMessage` 基于 `props.messages` 的索引语义不变。
