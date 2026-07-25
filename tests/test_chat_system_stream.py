"""Tests for ChatService.build_system_stream (orphan/system event consumer)."""

# Author: elecvoid243
# Date: 2026-07-25

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from astrbot.api.event import MessageChain
from astrbot.api.message_components import Plain
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


class TestSendToSystemStreamIntegration:
    """Cross-layer: WebChatMessageEvent._send mirror → build_system_stream."""

    @pytest.mark.asyncio
    async def test_event_send_reaches_system_stream_and_persists(self):
        from astrbot.core.platform.sources.webchat.webchat_event import (
            WebChatMessageEvent,
        )

        service = _make_service()
        session_id = f"conv-{id(self)}-int"
        stream = await service.build_system_stream("tester", session_id)
        sink: list = []
        pump = asyncio.create_task(_pump(stream, sink))
        try:
            await _wait_until(
                lambda: webchat_queue_mgr.has_system_subscribers(session_id)
            )
            webchat_queue_mgr.get_or_create_back_queue("req-int-1", session_id)
            await WebChatMessageEvent._send(
                "req-int-1",
                MessageChain(chain=[Plain("orphan turn")]),
                f"webchat!user!{session_id}",
                emit_complete=True,
            )
            await _wait_until(lambda: service.save_bot_message.await_count == 1)
            assert [e["type"] for e in sink] == ["plain", "complete"]
            assert sink[0]["data"] == "orphan turn"
            assert sink[0]["message_id"] == "req-int-1"
        finally:
            pump.cancel()
            await asyncio.gather(pump, return_exceptions=True)
            await stream.aclose()
            webchat_queue_mgr.remove_back_queue("req-int-1")

    @pytest.mark.asyncio
    async def test_send_by_session_style_call_does_not_leak(self):
        from astrbot.core.platform.sources.webchat.webchat_event import (
            WebChatMessageEvent,
        )

        service = _make_service()
        session_id = f"conv-{id(self)}-int2"
        stream = await service.build_system_stream("tester", session_id)
        sink: list = []
        pump = asyncio.create_task(_pump(stream, sink))
        try:
            await _wait_until(
                lambda: webchat_queue_mgr.has_system_subscribers(session_id)
            )
            webchat_queue_mgr.get_or_create_back_queue("req-int-2", session_id)
            await WebChatMessageEvent._send(
                "req-int-2",
                MessageChain(chain=[Plain("proactive")]),
                session_id,
                emit_complete=True,
                mirror_system=False,
            )
            await asyncio.sleep(0.1)
            assert sink == []
        finally:
            pump.cancel()
            await asyncio.gather(pump, return_exceptions=True)
            await stream.aclose()
            webchat_queue_mgr.remove_back_queue("req-int-2")


# Author: elecvoid243
# Date: 2026-07-25
# Regression tests for orphan goal-loop turn `agent_stats`
# persistence. Covers the second half of the system-event-stream fix:
# the backend flush path now propagates `pending_agent_stats` from
# `BotMessageAccumulator` to `save_bot_message`. The frontend leaf
# (`systemStream.ts`) was fixed earlier today; these tests guard the
# backend contract it depends on.
#
# Normal turn flow is intentionally not exercised here. The primary
# `_consume_chat_run` path decouples agent_stats from the accumulator
# (stores on `ChatRunState` directly) and never calls
# `add_plain(chain_type="agent_stats")` — so changes to `add_plain`
# and `flush()` cannot affect Normal turn. See
# `tests/unit/test_chat_service_sanitize_history.py` for Normal turn
# regression baselines.
class TestOrphanTurnAgentStatsPersistence:
    """BotMessageAccumulator.add_plain(chain_type='agent_stats')."""

    def _stats_payload(
        self,
        *,
        token_usage: dict | None = None,
        agent_duration: float | None = 12.3,
        other: dict | None = None,
    ) -> str:
        payload: dict = {}
        if token_usage is not None:
            payload["token_usage"] = token_usage
        if agent_duration is not None:
            payload["agent_duration"] = agent_duration
        if other:
            payload.update(other)
        return json.dumps(payload, ensure_ascii=False)

    def test_agent_stats_chain_type_parses_and_stores(self):
        from astrbot.dashboard.services.chat_service import BotMessageAccumulator

        accumulator = BotMessageAccumulator()
        stats_json = self._stats_payload(
            token_usage={"input_other": 123, "input_cached": 456, "output": 78},
            agent_duration=9.6,
        )
        accumulator.add_plain(stats_json, chain_type="agent_stats", streaming=False)

        # `pending_agent_stats` carries the parsed dict; default
        # initialised empty.
        assert accumulator.pending_agent_stats == {
            "token_usage": {
                "input_other": 123,
                "input_cached": 456,
                "output": 78,
            },
            "agent_duration": 9.6,
        }

        # The stats blob MUST NOT leak into message_parts as plain
        # text — that's the original bug this fix addresses.
        parts = accumulator.build_message_parts()
        assert parts == [], f"expected no parts, got {parts!r}"

    def test_agent_stats_does_not_pollute_other_chain_types(self):
        """Adding `agent_stats` then a normal `plain` chunk keeps the
        plain chunk isolated as a regular plain part and the stats
        blob fully inside `pending_agent_stats`.

        This is the regression safety net for the **Normal turn
        flow**: any added branch must be purely additive and never
        bleed into the default `pending_text` slot.
        """
        from astrbot.dashboard.services.chat_service import BotMessageAccumulator

        accumulator = BotMessageAccumulator()
        accumulator.add_plain(
            self._stats_payload(token_usage={"input_other": 5, "output": 7}),
            chain_type="agent_stats",
            streaming=False,
        )
        accumulator.add_plain("hello ", chain_type=None, streaming=True)
        accumulator.add_plain("world", chain_type=None, streaming=True)

        # Stats blob stays in its own slot.
        assert accumulator.pending_agent_stats == {
            "token_usage": {"input_other": 5, "output": 7},
            "agent_duration": 12.3,
        }
        # Plain text chunk resolves through the regular append path;
        # the stats JSON never gets concatenated into `pending_text`.
        parts = accumulator.build_message_parts()
        assert len(parts) == 1
        assert parts[0]["type"] == "plain"
        assert parts[0]["text"] == "hello world"
        assert "token_usage" not in parts[0]["text"]

    def test_agent_stats_malformed_json_degrades_to_empty(self):
        from astrbot.dashboard.services.chat_service import BotMessageAccumulator

        accumulator = BotMessageAccumulator()
        accumulator.add_plain(
            "{this is not valid json", chain_type="agent_stats", streaming=False
        )
        # Better to drop than to persist a JSON literal as plain text.
        assert accumulator.pending_agent_stats == {}

    def test_has_content_true_when_only_agent_stats(self):
        """Orphan turns that produce only an `agent_stats` payload
        (e.g., goal-loop with no user-visible output) still need to
        flush. `has_content` must therefore include
        `pending_agent_stats`.
        """
        from astrbot.dashboard.services.chat_service import BotMessageAccumulator

        accumulator = BotMessageAccumulator()
        accumulator.add_plain(
            self._stats_payload(token_usage={"output": 50}),
            chain_type="agent_stats",
            streaming=False,
        )
        assert accumulator.has_content() is True

    def test_has_content_unchanged_for_normal_turn_path(self):
        """Guard against accidentally making `has_content` return
        True when Normal turn would have returned False. Normal
        turn never calls `add_plain(chain_type='agent_stats')`, so
        `pending_agent_stats` stays empty; the OR-chain must
        resolve identically to the pre-fix expression
        `bool(parts or pending_text or pending_tool_calls)`.
        """
        from astrbot.dashboard.services.chat_service import BotMessageAccumulator

        empty = BotMessageAccumulator()
        assert empty.has_content() is False

        with_plain = BotMessageAccumulator()
        with_plain.add_plain("hi", chain_type=None, streaming=False)
        assert with_plain.has_content() is True

        with_tool = BotMessageAccumulator()
        with_tool.add_plain(
            json.dumps(
                {
                    "id": "call_x",
                    "name": "read_file",
                    "arguments": "{}",
                }
            ),
            chain_type="tool_call",
            streaming=False,
        )
        assert with_tool.has_content() is True


class TestOrphanTurnSystemStreamStatsE2E:
    """End-to-end: `agent_stats` payload through `build_system_stream`
    reaches `save_bot_message` as a structured dict (not a JSON
    literal baked into a plain part).
    """

    @pytest.mark.asyncio
    async def test_orphan_turn_with_agent_stats_persists_structured(self):
        service = _make_service()
        session_id = f"conv-{id(self)}-stats-e2e"
        stream = await service.build_system_stream("tester", session_id)
        sink: list = []
        pump = asyncio.create_task(_pump(stream, sink))
        try:
            await _wait_until(
                lambda: webchat_queue_mgr.has_system_subscribers(session_id)
            )
            stats_payload = {
                "token_usage": {
                    "input_other": 21658,
                    "input_cached": 42880,
                    "output": 702,
                },
                "agent_ttft": 9.6,
            }
            await webchat_queue_mgr.put_system_event(
                session_id,
                {
                    "type": "plain",
                    "chain_type": "agent_stats",
                    "data": json.dumps(stats_payload, ensure_ascii=False),
                    "streaming": False,
                    "message_id": "orphan-stats-1",
                },
            )
            await webchat_queue_mgr.put_system_event(
                session_id,
                {
                    "type": "plain",
                    "data": "goal-loop final text",
                    "streaming": False,
                    "message_id": "orphan-stats-1",
                },
            )
            await webchat_queue_mgr.put_system_event(
                session_id,
                {
                    "type": "complete",
                    "streaming": False,
                    "message_id": "orphan-stats-1",
                },
            )
            await _wait_until(lambda: service.save_bot_message.await_count == 1)
            args = service.save_bot_message.await_args.args
            # save_bot_message(webchat_conv_id, message_parts,
            #                  agent_stats, refs, llm_checkpoint_id,
            #                  platform_history_id).
            persisted_stats = args[2]
            persisted_parts = args[1]
            assert persisted_stats == stats_payload
            # The plain text part survives alongside the stats.
            assert any(
                p.get("type") == "plain" and p.get("text") == "goal-loop final text"
                for p in persisted_parts
            )
            # And critically: no part carries the raw JSON blob as text.
            assert not any(
                "token_usage" in (p.get("text") or "")
                for p in persisted_parts
                if p.get("type") == "plain"
            )
        finally:
            pump.cancel()
            await asyncio.gather(pump, return_exceptions=True)
            await stream.aclose()

    @pytest.mark.asyncio
    async def test_orphan_stats_only_turn_persists_without_plain_text(self):
        """Orphan turn with ONLY `agent_stats` and no plain output
        (a typical goal-loop synthetic turn) still flushes.
        """
        service = _make_service()
        session_id = f"conv-{id(self)}-stats-only"
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
                    "chain_type": "agent_stats",
                    "data": json.dumps(
                        {"token_usage": {"output": 100}}, ensure_ascii=False
                    ),
                    "streaming": False,
                    "message_id": "orphan-stats-only",
                },
            )
            await webchat_queue_mgr.put_system_event(
                session_id,
                {
                    "type": "end",
                    "streaming": False,
                    "message_id": "orphan-stats-only",
                },
            )
            await _wait_until(lambda: service.save_bot_message.await_count == 1)
            args = service.save_bot_message.await_args.args
            assert args[2] == {"token_usage": {"output": 100}}
            # message_parts may be empty (no plain text emitted) — the
            # important invariant is that the stats slot reached DB.
        finally:
            pump.cancel()
            await asyncio.gather(pump, return_exceptions=True)
            await stream.aclose()
