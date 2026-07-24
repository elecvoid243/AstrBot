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
        content={
            "type": type_,
            "message": [{"type": "plain", "text": f"m{record_id}"}],
        },
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
        history="[]",  # unused; load_current_conversation_history is stubbed below
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
        return_value=(
            "conv-1",
            llm_history if llm_history is not None else _llm_history(),
        )
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
