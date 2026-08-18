"""WebChatAdapter.create_event propagates the collab context payload field.

Covers the payload -> event-extra hop of the agent collab context pipeline
(deliver() puts collab_context into the queue payload; build_main_agent
reads it from event extras and injects it as a temp provider part).
"""

from astrbot.core.platform import MessageMember, MessageType
from astrbot.core.platform.astrbot_message import AstrBotMessage
from astrbot.core.platform.platform_metadata import PlatformMetadata
from astrbot.core.platform.sources.webchat.webchat_adapter import WebChatAdapter

_COLLAB_CONTEXT = "[协作讨论] 你正在参与一场多会话协作讨论，主题：评审这个设计"


def _adapter() -> WebChatAdapter:
    """Adapter instance without the base-class side effects (dirs, db)."""
    adapter = object.__new__(WebChatAdapter)
    adapter.metadata = PlatformMetadata(
        id="webchat", name="webchat", description="webchat"
    )
    return adapter


def _message(payload: dict) -> AstrBotMessage:
    msg = AstrBotMessage()
    msg.type = MessageType.FRIEND_MESSAGE
    msg.self_id = "webchat"
    msg.session_id = "webchat!alice!conv123"
    msg.message_id = "mid1"
    msg.sender = MessageMember("alice", "alice")
    msg.message = []
    msg.message_str = "[来自 主持人]: 内容"
    msg.raw_message = ("alice", "conv123", payload)
    return msg


def test_collab_context_propagates_to_event_extra():
    event = _adapter().create_event(_message({"collab_context": _COLLAB_CONTEXT}))
    assert event.get_extra("collab_context") == _COLLAB_CONTEXT


def test_missing_collab_context_is_noop():
    event = _adapter().create_event(_message({}))
    assert event.get_extra("collab_context") is None


def test_blank_collab_context_is_noop():
    event = _adapter().create_event(_message({"collab_context": "   "}))
    assert event.get_extra("collab_context") is None


def test_persist_user_history_writes_record(monkeypatch):
    import asyncio

    from astrbot.core.platform.sources.webchat import webchat_adapter as wa

    inserted = []

    async def fake_insert(**kwargs):
        inserted.append(kwargs)
        return None

    monkeypatch.setattr(wa.db_helper, "insert_platform_message_history", fake_insert)
    payload = {
        "message": [{"type": "plain", "text": "[来自 主持人]: 内容"}],
        "persist_user_history": True,
    }
    asyncio.run(_adapter().convert_message(("alice", "conv123", payload)))
    assert len(inserted) == 1
    record = inserted[0]
    assert record["platform_id"] == "webchat"
    assert record["user_id"] == "conv123"
    assert record["content"]["type"] == "user"
    assert record["content"]["message"] == payload["message"]
    assert record["sender_id"] == "alice"


def test_regular_messages_do_not_write_history(monkeypatch):
    import asyncio

    from astrbot.core.platform.sources.webchat import webchat_adapter as wa

    called = False

    async def fake_insert(**kwargs):
        nonlocal called
        called = True
        return None

    monkeypatch.setattr(wa.db_helper, "insert_platform_message_history", fake_insert)
    asyncio.run(
        _adapter().convert_message(
            ("alice", "conv123", {"message": [{"type": "plain", "text": "普通消息"}]})
        )
    )
    assert not called
