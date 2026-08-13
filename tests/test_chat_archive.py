"""Tests for ChatUI session archive (ChatService / ChatUIProjectService).

Author: elecvoid243
Date: 2026-08-13
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from astrbot.dashboard.services.chat_service import ChatService, ChatServiceError
from astrbot.dashboard.services.chatui_project_service import ChatUIProjectService

SRC_SESSION_ID = "src-session"


def _session(
    session_id: str = SRC_SESSION_ID,
    creator: str = "alice",
    display_name: str = "会话",
):
    return SimpleNamespace(
        session_id=session_id,
        platform_id="webchat",
        creator=creator,
        is_group=0,
        display_name=display_name,
        created_at=datetime(2026, 8, 13, tzinfo=UTC),
        updated_at=datetime(2026, 8, 13, tzinfo=UTC),
    )


def _make_chat_service() -> ChatService:
    """Build a ChatService with a mocked db for archive tests."""
    db = Mock()
    db.get_platform_session_by_id = AsyncMock(return_value=_session())
    db.update_platform_session = AsyncMock()
    core_lifecycle = SimpleNamespace(
        conversation_manager=Mock(),
        platform_message_history_manager=Mock(),
        umop_config_router=Mock(),
    )
    service = ChatService(Mock(), core_lifecycle)
    service.db = db
    return service


@pytest.mark.asyncio
async def test_get_sessions_excludes_archived():
    """普通会话列表必须排除已归档会话。"""
    service = _make_chat_service()
    service.db.get_platform_sessions_by_creator_paginated = AsyncMock(
        return_value=([], 0)
    )
    service.get_branch_relations = AsyncMock(return_value={})

    await service.get_sessions("alice", "webchat")

    kwargs = service.db.get_platform_sessions_by_creator_paginated.await_args.kwargs
    assert kwargs["archived"] is False
    assert kwargs["exclude_project_sessions"] is True


@pytest.mark.asyncio
async def test_get_archived_sessions_keeps_project_members():
    """归档列表包含项目内会话，并保留项目归属字段。"""
    service = _make_chat_service()
    item = {
        "session": _session(),
        "project_id": "proj-1",
        "project_title": "项目A",
        "project_emoji": "📁",
    }
    service.db.get_platform_sessions_by_creator_paginated = AsyncMock(
        return_value=([item], 1)
    )
    service.get_branch_relations = AsyncMock(return_value={})

    result = await service.get_archived_sessions("alice", "webchat")

    kwargs = service.db.get_platform_sessions_by_creator_paginated.await_args.kwargs
    assert kwargs["archived"] is True
    assert result["items"][0]["project_id"] == "proj-1"
    assert result["items"][0]["project_title"] == "项目A"
    assert result["pagination"] == {
        "page": 1,
        "page_size": 20,
        "total": 1,
        "total_pages": 1,
    }


@pytest.mark.asyncio
async def test_get_archived_sessions_paginates():
    """归档列表按 page/page_size 分页。"""
    service = _make_chat_service()
    sessions = [
        {
            "session": _session(session_id=f"arch-{i}"),
            "project_id": None,
            "project_title": None,
            "project_emoji": None,
        }
        for i in range(5)
    ]
    service.db.get_platform_sessions_by_creator_paginated = AsyncMock(
        return_value=(sessions, 5)
    )
    service.get_branch_relations = AsyncMock(return_value={})

    result = await service.get_archived_sessions("alice", "webchat", page=2, page_size=2)

    assert [item["session_id"] for item in result["items"]] == ["arch-2", "arch-3"]
    assert result["pagination"]["total"] == 5
    assert result["pagination"]["total_pages"] == 3
    assert result["pagination"]["page"] == 2


@pytest.mark.asyncio
async def test_get_archived_sessions_search_filters_by_title():
    """归档列表按会话标题（大小写不敏感子串）过滤。"""
    service = _make_chat_service()
    sessions = [
        {
            "session": _session(session_id="s1", display_name="分支 · 需求分析"),
            "project_id": None,
            "project_title": None,
            "project_emoji": None,
        },
        {
            "session": _session(session_id="s2", display_name="日常闲聊"),
            "project_id": None,
            "project_title": None,
            "project_emoji": None,
        },
    ]
    service.db.get_platform_sessions_by_creator_paginated = AsyncMock(
        return_value=(sessions, 2)
    )
    service.get_branch_relations = AsyncMock(return_value={})

    result = await service.get_archived_sessions(
        "alice", "webchat", search="需求"
    )

    assert [item["session_id"] for item in result["items"]] == ["s1"]
    assert result["pagination"]["total"] == 1


@pytest.mark.asyncio
async def test_set_session_archived_updates_db():
    service = _make_chat_service()

    await service.set_session_archived("alice", SRC_SESSION_ID, True)

    service.db.update_platform_session.assert_awaited_once_with(
        SRC_SESSION_ID, archived=1
    )


@pytest.mark.asyncio
async def test_set_session_archived_restores():
    service = _make_chat_service()

    await service.set_session_archived("alice", SRC_SESSION_ID, False)

    service.db.update_platform_session.assert_awaited_once_with(
        SRC_SESSION_ID, archived=0
    )


@pytest.mark.asyncio
async def test_set_session_archived_rejects_foreign_session():
    service = _make_chat_service()
    service.db.get_platform_session_by_id = AsyncMock(
        return_value=_session(creator="bob")
    )

    with pytest.raises(ChatServiceError, match="Permission denied"):
        await service.set_session_archived("alice", SRC_SESSION_ID, True)


@pytest.mark.asyncio
async def test_set_session_archived_rejects_missing_session():
    service = _make_chat_service()
    service.db.get_platform_session_by_id = AsyncMock(return_value=None)

    with pytest.raises(ChatServiceError, match="not found"):
        await service.set_session_archived("alice", SRC_SESSION_ID, True)


@pytest.mark.asyncio
async def test_project_sessions_exclude_archived():
    """项目会话列表排除归档会话。"""
    service = ChatUIProjectService(Mock())
    service.db.get_project_sessions = AsyncMock(return_value=[])
    service.db.get_branch_relations = AsyncMock(return_value={})
    service._get_owned_project = AsyncMock()

    await service.get_project_sessions("alice", "proj-1")

    service.db.get_project_sessions.assert_awaited_once_with(
        "proj-1", exclude_archived=True
    )


@pytest.mark.asyncio
async def test_message_search_excludes_archived_sessions():
    """侧边栏消息搜索只覆盖未归档会话。"""
    from astrbot.dashboard.services.conversation_service import ConversationService

    core_lifecycle = SimpleNamespace(
        conversation_manager=Mock(), platform_message_history_manager=Mock()
    )
    service = ConversationService(Mock(), core_lifecycle)
    service.db_helper.get_platform_sessions_by_creator_paginated = AsyncMock(
        return_value=([], 0)
    )

    await service.search_messages(
        q="keyword", page=1, page_size=20, username="alice"
    )

    kwargs = (
        service.db_helper.get_platform_sessions_by_creator_paginated.await_args.kwargs
    )
    assert kwargs["archived"] is False


@pytest.mark.asyncio
async def test_batch_archive_sessions_archives_all():
    """批量归档：全部成功。"""
    service = _make_chat_service()
    service.db.get_platform_session_by_id = AsyncMock(
        side_effect=lambda session_id: _session(session_id=session_id)
    )

    result = await service.batch_archive_sessions_from_dashboard_payload(
        "alice", {"session_ids": ["s-1", "s-2"]}
    )

    assert result["archived_count"] == 2
    assert result["failed_count"] == 0
    assert result["failed_items"] == []
    assert service.db.update_platform_session.await_count == 2


@pytest.mark.asyncio
async def test_batch_archive_sessions_reports_failures():
    """批量归档：缺失会话计入失败，不中断整批。"""
    service = _make_chat_service()
    service.db.get_platform_session_by_id = AsyncMock(
        side_effect=[_session(session_id="ok"), None]
    )

    result = await service.batch_archive_sessions_from_dashboard_payload(
        "alice", {"session_ids": ["ok", "missing"]}
    )

    assert result["archived_count"] == 1
    assert result["failed_count"] == 1
    assert result["failed_items"][0]["session_id"] == "missing"


@pytest.mark.asyncio
async def test_batch_archive_sessions_rejects_bad_payload():
    """批量归档：缺少 session_ids 时抛错。"""
    service = _make_chat_service()

    with pytest.raises(ChatServiceError, match="session_ids"):
        await service.batch_archive_sessions_from_dashboard_payload("alice", {})
