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
