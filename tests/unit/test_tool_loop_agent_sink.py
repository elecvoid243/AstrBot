"""Tests that Context.tool_loop_agent forwards runner responses to a sink."""

# Author: elecvoid243
# Date: 2026-07-26
# Plan: docs/superpowers/plans/2026-07-26-subagent-chatui-progress.md (Task 2)

from types import SimpleNamespace

import pytest

import astrbot.core.star.context as star_context
from astrbot.core.agent.response import AgentResponse
from astrbot.core.message.message_event_result import MessageChain
from astrbot.core.provider.entities import LLMResponse
from astrbot.core.provider.provider import Provider


class _StubProvider(Provider):
    def __init__(self):
        super().__init__({"id": "stub", "type": "stub"}, {})

    def get_current_key(self):
        return ""

    def set_key(self, key):
        pass

    async def get_models(self):
        return []

    async def text_chat(self, **kwargs):
        raise NotImplementedError


class _FakeRunner:
    """Stands in for ToolLoopAgentRunner; replays canned responses."""

    responses = []
    final_resp = None

    def __init__(self):
        self.run_context = SimpleNamespace(messages=[])

    async def reset(self, **kwargs):
        pass

    async def step_until_done(self, max_steps):
        for resp in self.responses:
            yield resp

    def get_final_llm_resp(self):
        return self.final_resp


def _final_resp(text="done"):
    resp = LLMResponse(role="assistant")
    resp.completion_text = text
    return resp


def _make_context(monkeypatch):
    monkeypatch.setattr(star_context, "ToolLoopAgentRunner", _FakeRunner)
    ctx = object.__new__(star_context.Context)
    provider = _StubProvider()

    async def _get_provider_by_id(pid):
        return provider

    ctx.provider_manager = SimpleNamespace(
        get_provider_by_id=_get_provider_by_id,
        llm_tools=SimpleNamespace(),
    )
    return ctx


def _agent_context(ctx):
    event = SimpleNamespace(unified_msg_origin="webchat:FriendMessage:x")
    return SimpleNamespace(context=ctx, event=event)


@pytest.mark.asyncio
async def test_response_sink_receives_every_response_in_order(monkeypatch):
    ctx = _make_context(monkeypatch)
    seen = []

    async def sink(resp):
        seen.append(resp.type)

    _FakeRunner.responses = [
        AgentResponse(
            type="streaming_delta", data={"chain": MessageChain().message("a")}
        ),
        AgentResponse(type="tool_call", data={"chain": MessageChain(type="tool_call")}),
    ]
    _FakeRunner.final_resp = _final_resp()

    result = await ctx.tool_loop_agent(
        event=SimpleNamespace(unified_msg_origin="webchat:FriendMessage:x"),
        chat_provider_id="stub",
        prompt="hi",
        agent_context=_agent_context(ctx),
        response_sink=sink,
    )
    assert seen == ["streaming_delta", "tool_call"]
    assert result.completion_text == "done"


@pytest.mark.asyncio
async def test_no_sink_keeps_legacy_behavior(monkeypatch):
    ctx = _make_context(monkeypatch)
    _FakeRunner.responses = [
        AgentResponse(
            type="streaming_delta", data={"chain": MessageChain().message("a")}
        ),
    ]
    _FakeRunner.final_resp = _final_resp()
    result = await ctx.tool_loop_agent(
        event=SimpleNamespace(unified_msg_origin="webchat:FriendMessage:x"),
        chat_provider_id="stub",
        prompt="hi",
        agent_context=_agent_context(ctx),
    )
    assert result.completion_text == "done"
