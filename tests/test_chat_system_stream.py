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


async def _pump(stream, sink: list) -> None:
    async for chunk in stream:
        for block in chunk.strip().split("\n\n"):
            if block.startswith("data: "):
                sink.append(json.loads(block[6:]))


async def _wait_until(predicate, timeout: float = 2.0) -> None:
    for _ in range(int(timeout / 0.01)):
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise TimeoutError("condition not met within timeout")


class TestBuildSystemStream:
    @pytest.mark.asyncio
    async def test_orphan_event_streamed_and_saved_on_complete(self):
        service = _make_service()
        session_id = f"conv-{id(self)}-a"
        stream = await service.build_system_stream("tester", session_id)
        sink: list = []
        pump = asyncio.create_task(_pump(stream, sink))
        try:
            await _wait_until(
                lambda: webchat_queue_mgr.has_system_subscribers(session_id)
            )
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
            await _wait_until(lambda: service.save_bot_message.await_count == 1)
            assert [e["type"] for e in sink] == ["plain", "complete"]
            args = service.save_bot_message.await_args.args
            assert args[0] == session_id
            assert args[1][-1]["text"] == "goal turn output"
        finally:
            pump.cancel()
            await asyncio.gather(pump, return_exceptions=True)
            await stream.aclose()

    @pytest.mark.asyncio
    async def test_active_run_payloads_are_skipped(self):
        service = _make_service()
        session_id = f"conv-{id(self)}-b"
        service.chat_runs["user-run-1"] = MagicMock()  # primary run in flight
        stream = await service.build_system_stream("tester", session_id)
        sink: list = []
        pump = asyncio.create_task(_pump(stream, sink))
        try:
            await _wait_until(
                lambda: webchat_queue_mgr.has_system_subscribers(session_id)
            )
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
            await _wait_until(lambda: len(sink) == 1)
            assert sink[0]["message_id"] == "orphan-2"
        finally:
            pump.cancel()
            await asyncio.gather(pump, return_exceptions=True)
            await stream.aclose()
        # The orphan plain payload was accumulated but no complete/end arrived,
        # so aclose triggers the finally-flush and persists it.
        service.save_bot_message.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_disconnect_flushes_partial_turn(self):
        service = _make_service()
        session_id = f"conv-{id(self)}-c"
        stream = await service.build_system_stream("tester", session_id)
        sink: list = []
        pump = asyncio.create_task(_pump(stream, sink))
        try:
            await _wait_until(
                lambda: webchat_queue_mgr.has_system_subscribers(session_id)
            )
            await webchat_queue_mgr.put_system_event(
                session_id,
                {
                    "type": "plain",
                    "data": "partial",
                    "streaming": True,
                    "message_id": "orphan-3",
                },
            )
            await _wait_until(lambda: len(sink) == 1)
            assert sink[0]["data"] == "partial"
        finally:
            pump.cancel()
            await asyncio.gather(pump, return_exceptions=True)
            await stream.aclose()
        service.save_bot_message.assert_awaited_once()


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
