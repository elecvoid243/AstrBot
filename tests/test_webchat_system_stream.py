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
        assert _extract_conversation_id("webchat!abc!session-1") == "session-1"

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
