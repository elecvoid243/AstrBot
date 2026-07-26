# SubAgent Execution Progress in ChatUI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream a subagent's live execution (text deltas, reasoning, tool calls, status) into the WebChat ChatUI as a collapsible `subagent_run` block inside the main agent's bot bubble, persisted into message history.

**Architecture:** A new leaf module `SubAgentEventSink` maps subagent `AgentResponse`s to `subagent_event` SSE payloads written directly into the main run's webchat `back_queue`. `Context.tool_loop_agent()` gains a `response_sink` passthrough so `_execute_handoff` can observe the subagent runner. `ChatService._consume_chat_run` feeds these events into an extended `BotMessageAccumulator` which persists a `subagent_run` message part. The frontend reduces events into that part via a bare-node-testable leaf reducer and renders it with a new `SubAgentRunBlock.vue` in the content-part flow.

**Tech Stack:** Python 3.10+ (FastAPI `StreamingResponse` SSE, asyncio queues), Vue 3 + TypeScript (Vuetify, markstream-vue, vitest).

## Global Constraints

- Worktree: `F:\github\Astrbot\.worktrees\feat-subagent-progress`, branch `feat-subagent-progress`. **Local commits only — never push, never open PRs.**
- Python: ruff format/check clean; Google-style docstrings; English comments/logs; `pathlib.Path` for paths.
- Conventional commit messages (`feat:`, `fix:`, `test:`).
- KISS: no throttling layer (the primary stream already forwards every delta unthrottled); no background-handoff support in v1 (foreground `_execute_handoff` only).
- Non-webchat platforms must be behaviorally untouched (sink is `None` unless `event.get_platform_name() == "webchat"`).
- Frontend bare-node testability: new reducer logic lives in a leaf module importing only other leaf modules (no `@/` aliases), same precedent as `normalizeMessageParts.ts`.
- i18n: new UI strings go into all three locale files (`en-US`, `zh-CN`, `ru-RU`) under `features/chat`.

## Wire Protocol (locked contract)

SSE payload (published verbatim through the existing run fan-out):

```json
{
  "type": "subagent_event",
  "message_id": "<main run message_id>",
  "streaming": true,
  "data": {
    "subagent_run_id": "sa_<12 hex>",
    "agent_name": "<name>",
    "kind": "started|text_delta|reasoning_delta|tool_call|tool_call_result|completed|failed|timeout",
    "payload": { "...kind specific..." },
    "ts": 1753514400.0
  }
}
```

Persisted message part (written by `BotMessageAccumulator`, restored on reload):

```json
{
  "type": "subagent_run",
  "subagent_run_id": "sa_<12 hex>",
  "agent_name": "<name>",
  "status": "running|completed|failed|timeout",
  "input_preview": "<task, first 200 chars>",
  "text": "<aggregated streamed text>",
  "reasoning": "<aggregated reasoning>",
  "tool_calls": [{"id": "...", "name": "...", "args": {}, "result": "..."}],
  "started_ts": 1753514400.0,
  "execution_time": 12.3
}
```

---

### Task 1: `SubAgentEventSink` leaf module

**Files:**
- Create: `astrbot/core/subagent_event_sink.py`
- Test: `tests/unit/test_subagent_event_sink.py`

**Interfaces:**
- Consumes: `AgentResponse` (`astrbot/core/agent/response.py`, fields `.type: str`, `.data["chain"]: MessageChain`); `webchat_queue_mgr.put_back_queue(request_id, payload) -> bool`.
- Produces: `class SubAgentEventSink` with `.subagent_run_id: str`, `async start()`, `async __call__(resp: AgentResponse)`, `async complete(result_text: str, execution_time: float)`, `async fail(status: str, error: str)`. Task 3 instantiates it; Task 2 receives it as `response_sink`.

- [ ] **Step 1: Write the failing test**

```python
"""Tests for SubAgentEventSink AgentResponse -> SSE payload mapping."""

import pytest

from astrbot.core.agent.response import AgentResponse
from astrbot.core.message.message_event_result import MessageChain
from astrbot.core.message.message_components import Json


class _QueueStub:
    def __init__(self, accepted=True):
        self.payloads = []
        self.accepted = accepted

    async def put_back_queue(self, request_id, payload):
        if self.accepted:
            self.payloads.append((request_id, payload))
        return self.accepted


def _delta(text, reasoning=False):
    chain_type = "reasoning" if reasoning else None
    return AgentResponse(
        type="streaming_delta",
        data={"chain": MessageChain(type=chain_type).message(text)},
    )


def _tool_call(call_id="c1", name="web_search", args=None):
    return AgentResponse(
        type="tool_call",
        data={
            "chain": MessageChain(
                type="tool_call",
                chain=[Json(data={"id": call_id, "name": name, "args": args or {}})],
            )
        },
    )


def _tool_result(call_id="c1", result="ok"):
    return AgentResponse(
        type="tool_call_result",
        data={
            "chain": MessageChain(
                type="tool_call",
                chain=[Json(data={"id": call_id, "result": result})],
            )
        },
    )


@pytest.mark.asyncio
async def test_start_emits_started_event(monkeypatch):
    import astrbot.core.subagent_event_sink as sink_mod

    stub = _QueueStub()
    monkeypatch.setattr(sink_mod, "webchat_queue_mgr", stub)
    sink = sink_mod.SubAgentEventSink("msg-1", "researcher", "do research")
    await sink.start()
    (request_id, payload), = stub.payloads
    assert request_id == "msg-1"
    assert payload["type"] == "subagent_event"
    assert payload["message_id"] == "msg-1"
    assert payload["streaming"] is True
    data = payload["data"]
    assert data["subagent_run_id"] == sink.subagent_run_id
    assert data["agent_name"] == "researcher"
    assert data["kind"] == "started"
    assert data["payload"]["input_preview"] == "do research"
    assert isinstance(data["ts"], float)


@pytest.mark.asyncio
async def test_text_and_reasoning_deltas(monkeypatch):
    import astrbot.core.subagent_event_sink as sink_mod

    stub = _QueueStub()
    monkeypatch.setattr(sink_mod, "webchat_queue_mgr", stub)
    sink = sink_mod.SubAgentEventSink("msg-1", "researcher")
    await sink(_delta("hello"))
    await sink(_delta("thinking...", reasoning=True))
    kinds = [p["data"]["kind"] for _, p in stub.payloads]
    assert kinds == ["text_delta", "reasoning_delta"]
    assert stub.payloads[0][1]["data"]["payload"] == {"text": "hello"}
    assert stub.payloads[1][1]["data"]["payload"] == {"text": "thinking..."}


@pytest.mark.asyncio
async def test_tool_call_and_truncated_result(monkeypatch):
    import astrbot.core.subagent_event_sink as sink_mod

    stub = _QueueStub()
    monkeypatch.setattr(sink_mod, "webchat_queue_mgr", stub)
    sink = sink_mod.SubAgentEventSink("msg-1", "researcher")
    await sink(_tool_call(args={"q": "astrbot"}))
    await sink(_tool_result(result="x" * 5000))
    call_payload = stub.payloads[0][1]["data"]["payload"]
    assert call_payload == {"id": "c1", "name": "web_search", "args": {"q": "astrbot"}}
    result_payload = stub.payloads[1][1]["data"]["payload"]
    assert result_payload["id"] == "c1"
    assert len(result_payload["result"]) == 2000


@pytest.mark.asyncio
async def test_complete_and_fail(monkeypatch):
    import astrbot.core.subagent_event_sink as sink_mod

    stub = _QueueStub()
    monkeypatch.setattr(sink_mod, "webchat_queue_mgr", stub)
    sink = sink_mod.SubAgentEventSink("msg-1", "researcher")
    await sink.complete("final answer", 12.5)
    await sink.fail("timeout", "timed out")
    completed = stub.payloads[0][1]["data"]
    assert completed["kind"] == "completed"
    assert completed["payload"]["result_text"] == "final answer"
    assert completed["payload"]["execution_time"] == 12.5
    failed = stub.payloads[1][1]["data"]
    assert failed["kind"] == "timeout"
    assert failed["payload"]["error"] == "timed out"


@pytest.mark.asyncio
async def test_stops_emitting_after_queue_closed(monkeypatch):
    import astrbot.core.subagent_event_sink as sink_mod

    stub = _QueueStub(accepted=False)
    monkeypatch.setattr(sink_mod, "webchat_queue_mgr", stub)
    sink = sink_mod.SubAgentEventSink("msg-1", "researcher")
    await sink(_delta("a"))
    await sink(_delta("b"))
    await sink.complete("done", 1.0)
    assert stub.payloads == []  # nothing recorded, no exception raised


@pytest.mark.asyncio
async def test_ignores_unrelated_response_types(monkeypatch):
    import astrbot.core.subagent_event_sink as sink_mod

    stub = _QueueStub()
    monkeypatch.setattr(sink_mod, "webchat_queue_mgr", stub)
    sink = sink_mod.SubAgentEventSink("msg-1", "researcher")
    await sink(AgentResponse(type="agent_stats", data={"chain": MessageChain()}))
    await sink(AgentResponse(type="llm_result", data={"chain": MessageChain()}))
    assert stub.payloads == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d F:\github\Astrbot\.worktrees\feat-subagent-progress && uv run pytest tests/unit/test_subagent_event_sink.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'astrbot.core.subagent_event_sink'`

- [ ] **Step 3: Implement `astrbot/core/subagent_event_sink.py`**

```python
"""Streams subagent execution progress into the WebChat SSE back queue.

The sink is a thin mapper: it converts subagent ``AgentResponse``s into
``subagent_event`` payloads written to the *main* run's back queue, so the
existing ChatService fan-out forwards them to the dashboard without any
new transport. Only instantiated for webchat foreground handoffs.
"""

import time
import uuid

from astrbot.core.agent.response import AgentResponse
from astrbot.core.message.message_components import Json
from astrbot.core.platform.sources.webchat.webchat_queue_mgr import (
    webchat_queue_mgr,
)

TOOL_RESULT_MAX_CHARS = 2000
"""Cap for persisted/displayed tool results inside a subagent run block."""


class SubAgentEventSink:
    """Maps subagent runner responses to ``subagent_event`` SSE payloads.

    Attributes:
        subagent_run_id: Correlation id shared by every event of one run.
    """

    def __init__(self, message_id: str, agent_name: str, input_preview: str = ""):
        """Create a sink bound to the main run's back queue.

        Args:
            message_id: Main run message id (== back queue request id).
            agent_name: Display name of the subagent.
            input_preview: Truncated task description for the run header.
        """
        self.subagent_run_id = f"sa_{uuid.uuid4().hex[:12]}"
        self._message_id = message_id
        self._agent_name = agent_name
        self._input_preview = input_preview
        self._closed = False

    async def _emit(self, kind: str, payload: dict) -> None:
        if self._closed:
            return
        event = {
            "type": "subagent_event",
            "message_id": self._message_id,
            "streaming": True,
            "data": {
                "subagent_run_id": self.subagent_run_id,
                "agent_name": self._agent_name,
                "kind": kind,
                "payload": payload,
                "ts": time.time(),
            },
        }
        accepted = await webchat_queue_mgr.put_back_queue(self._message_id, event)
        if not accepted:
            # Main run queue is gone (client aborted); stop emitting cheaply.
            self._closed = True

    async def start(self) -> None:
        """Emit the ``started`` event (run header)."""
        await self._emit("started", {"input_preview": self._input_preview})

    async def __call__(self, resp: AgentResponse) -> None:
        """Forward one runner response. Signature matches ``response_sink``."""
        chain = resp.data.get("chain") if isinstance(resp.data, dict) else None
        if chain is None:
            return
        if resp.type == "streaming_delta":
            text = chain.get_plain_text()
            if not text:
                return
            kind = "reasoning_delta" if chain.type == "reasoning" else "text_delta"
            await self._emit(kind, {"text": text})
        elif resp.type == "tool_call":
            for comp in chain.chain:
                if isinstance(comp, Json) and isinstance(comp.data, dict):
                    await self._emit(
                        "tool_call",
                        {
                            "id": comp.data.get("id"),
                            "name": comp.data.get("name"),
                            "args": comp.data.get("args") or {},
                        },
                    )
                    break
        elif resp.type == "tool_call_result":
            for comp in chain.chain:
                if isinstance(comp, Json) and isinstance(comp.data, dict):
                    result = comp.data.get("result")
                    await self._emit(
                        "tool_call_result",
                        {
                            "id": comp.data.get("id"),
                            "result": str(result)[:TOOL_RESULT_MAX_CHARS]
                            if result is not None
                            else "",
                        },
                    )
                    break

    async def complete(self, result_text: str, execution_time: float) -> None:
        """Emit the terminal ``completed`` event."""
        await self._emit(
            "completed",
            {"result_text": result_text or "", "execution_time": execution_time},
        )
        self._closed = True

    async def fail(self, status: str, error: str) -> None:
        """Emit a terminal failure event.

        Args:
            status: ``"failed"`` or ``"timeout"``.
            error: Human-readable error message.
        """
        await self._emit(status, {"error": error})
        self._closed = True
```

Note: `MessageChain(type=None)` is the default for normal text; check `Json` import path actually used in the codebase is `astrbot.api.message_components` in webchat_event.py — verify at execution and import from wherever `webchat_event.py` imports it (`astrbot.api.message_components`). Adjust the import line to match.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_subagent_event_sink.py -q`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add astrbot/core/subagent_event_sink.py tests/unit/test_subagent_event_sink.py
git commit -m "feat: add SubAgentEventSink mapping subagent responses to SSE payloads"
```

---

### Task 2: `tool_loop_agent` response_sink passthrough

**Files:**
- Modify: `astrbot/core/star/context.py` (inside `tool_loop_agent`, the `agent_runner.step_until_done` drive loop, currently lines ~348-349)
- Test: `tests/unit/test_tool_loop_agent_sink.py` (create)

**Interfaces:**
- Consumes: `SubAgentEventSink` (Task 1) passed as `response_sink`.
- Produces: `Context.tool_loop_agent(..., **kwargs)` honours optional kwarg `response_sink: Callable[[AgentResponse], Awaitable[None]] | None` — invoked with every `AgentResponse` from the runner, in order, before the final `LLMResponse` is returned.

- [ ] **Step 1: Write the failing test**

```python
"""Tests that Context.tool_loop_agent forwards runner responses to a sink."""

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


def _make_context(monkeypatch):
    monkeypatch.setattr(star_context, "ToolLoopAgentRunner", _FakeRunner)
    ctx = object.__new__(star_context.Context)
    provider = _StubProvider()
    ctx.provider_manager = SimpleNamespace(
        get_provider_by_id=lambda pid: provider,
        llm_tools=SimpleNamespace(),
    )
    return ctx


@pytest.mark.asyncio
async def test_response_sink_receives_every_response_in_order(monkeypatch):
    ctx = _make_context(monkeypatch)
    seen = []

    async def sink(resp):
        seen.append(resp.type)

    _FakeRunner.responses = [
        AgentResponse(type="streaming_delta", data={"chain": MessageChain().message("a")}),
        AgentResponse(type="tool_call", data={"chain": MessageChain(type="tool_call")}),
    ]
    _FakeRunner.final_resp = LLMResponse(role="assistant", completion_text="done")

    result = await ctx.tool_loop_agent(
        event=SimpleNamespace(unified_msg_origin="webchat:FriendMessage:x"),
        chat_provider_id="stub",
        prompt="hi",
        response_sink=sink,
    )
    assert seen == ["streaming_delta", "tool_call"]
    assert result.completion_text == "done"


@pytest.mark.asyncio
async def test_no_sink_keeps_legacy_behavior(monkeypatch):
    ctx = _make_context(monkeypatch)
    _FakeRunner.responses = [
        AgentResponse(type="streaming_delta", data={"chain": MessageChain().message("a")}),
    ]
    _FakeRunner.final_resp = LLMResponse(role="assistant", completion_text="done")
    result = await ctx.tool_loop_agent(
        event=SimpleNamespace(unified_msg_origin="webchat:FriendMessage:x"),
        chat_provider_id="stub",
        prompt="hi",
    )
    assert result.completion_text == "done"
```

Note: `get_provider_by_id` is awaited in `tool_loop_agent` (`await self.provider_manager.get_provider_by_id(...)`) — if the lambda return is not awaitable the test will fail; if so, wrap in an `async def`. `get_config` is only called inside a `try/except Exception` for notice defaults, so `object.__new__` without config is tolerated. Verify `LLMResponse(role=..., completion_text=...)` constructor signature at execution and adjust.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_tool_loop_agent_sink.py -q`
Expected: FAIL — `TypeError: tool_loop_agent() got an unexpected keyword argument 'response_sink'`... actually `**kwargs` swallows it, so the failure is `assert seen == [...]` with `seen == []`. Confirm that is the observed failure.

- [ ] **Step 3: Modify the drive loop in `astrbot/core/star/context.py`**

Replace:

```python
        async for _ in agent_runner.step_until_done(max_steps):
            pass
```

with:

```python
        response_sink = kwargs.get("response_sink")
        async for resp in agent_runner.step_until_done(max_steps):
            if response_sink is not None:
                await response_sink(resp)
```

Also add `response_sink` to the `**kwargs` doc entry in the docstring:

```python
                response_sink: Callable[[AgentResponse], Awaitable[None]] | None - optional
                    observer invoked with every AgentResponse produced by the runner
                    (used to stream subagent progress to webchat).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_tool_loop_agent_sink.py tests/test_tool_loop_agent_runner.py -q`
Expected: all pass (new 2 + existing runner tests unaffected)

- [ ] **Step 5: Commit**

```bash
git add astrbot/core/star/context.py tests/unit/test_tool_loop_agent_sink.py
git commit -m "feat: add response_sink passthrough to Context.tool_loop_agent"
```

---

### Task 3: Handoff wiring + config gate

**Files:**
- Modify: `astrbot/core/astr_agent_tool_exec.py` (`_execute_handoff`, ~lines 452-640)
- Modify: `astrbot/core/config/default.py` (provider_settings default dict ~line 143, schema ~line 2930, metadata ~line 3827)
- Test: extend `tests/unit/test_astr_agent_tool_exec.py`

**Interfaces:**
- Consumes: `SubAgentEventSink` (Task 1); `response_sink` kwarg (Task 2).
- Produces: `FunctionToolExecutor._maybe_create_subagent_sink(event, prov_settings, agent_name, input_text) -> SubAgentEventSink | None`; config key `provider_settings.show_subagent_progress` (bool, default `True`).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/test_astr_agent_tool_exec.py`:

```python
class TestMaybeCreateSubagentSink:
    def _event(self, platform_name="webchat"):
        from astrbot.core.astr_agent_tool_exec import FunctionToolExecutor  # noqa: F401

        class _Msg:
            message_id = "msg-42"

        class _Event:
            message_obj = _Msg()

            def get_platform_name(self):
                return platform_name

        return _Event()

    def test_returns_sink_for_webchat_when_enabled(self):
        from astrbot.core.astr_agent_tool_exec import FunctionToolExecutor

        sink = FunctionToolExecutor._maybe_create_subagent_sink(
            self._event(), {"show_subagent_progress": True}, "researcher", "do it"
        )
        assert sink is not None
        assert sink._message_id == "msg-42"
        assert sink._agent_name == "researcher"

    def test_returns_none_for_non_webchat(self):
        from astrbot.core.astr_agent_tool_exec import FunctionToolExecutor

        assert (
            FunctionToolExecutor._maybe_create_subagent_sink(
                self._event("aiocqhttp"), {}, "researcher", "do it"
            )
            is None
        )

    def test_returns_none_when_disabled(self):
        from astrbot.core.astr_agent_tool_exec import FunctionToolExecutor

        assert (
            FunctionToolExecutor._maybe_create_subagent_sink(
                self._event(), {"show_subagent_progress": False}, "researcher", "do it"
            )
            is None
        )

    def test_defaults_to_enabled(self):
        from astrbot.core.astr_agent_tool_exec import FunctionToolExecutor

        assert (
            FunctionToolExecutor._maybe_create_subagent_sink(
                self._event(), {}, "researcher", "do it"
            )
            is not None
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_astr_agent_tool_exec.py -q`
Expected: FAIL — `AttributeError: type object 'FunctionToolExecutor' has no attribute '_maybe_create_subagent_sink'`

- [ ] **Step 3: Implement**

In `astrbot/core/astr_agent_tool_exec.py`, add import at top:

```python
from astrbot.core.subagent_event_sink import SubAgentEventSink
```

Add the gated factory as a classmethod on `FunctionToolExecutor` (justified extraction: gating logic is independently testable; the call site stays linear):

```python
    @classmethod
    def _maybe_create_subagent_sink(
        cls,
        event,
        prov_settings: dict,
        agent_name: str,
        input_text: str | None,
    ) -> SubAgentEventSink | None:
        """Create a progress sink for webchat foreground handoffs.

        Returns None (feature off) for non-webchat platforms or when
        ``provider_settings.show_subagent_progress`` is False.
        """
        if not prov_settings.get("show_subagent_progress", True):
            return None
        if event.get_platform_name() != "webchat":
            return None
        message_id = getattr(getattr(event, "message_obj", None), "message_id", None)
        if not message_id:
            return None
        return SubAgentEventSink(
            message_id=str(message_id),
            agent_name=agent_name,
            input_preview=(input_text or "")[:200],
        )
```

In `_execute_handoff`, after `agent_name = getattr(tool.agent, "name", "unknown")` and after `prov_settings` is loaded (both already exist), insert sink creation and lifecycle calls. Change the `_run_subagent` closure and the timeout/normal paths:

```python
        prov_settings: dict = ctx.get_config(umo=umo).get("provider_settings", {})
        agent_max_step = int(prov_settings.get("max_agent_step", 30))
        stream = prov_settings.get("streaming_response", False)
        # NEW: progress sink (None unless webchat + enabled)
        sink = cls._maybe_create_subagent_sink(event, prov_settings, agent_name, input_)
```

Inside `_run_subagent()`, pass the sink:

```python
        async def _run_subagent():
            return await ctx.tool_loop_agent(
                ...existing kwargs...,
                trace_span=subagent_trace,
                response_sink=sink,
            )
```

Before `asyncio.wait_for(...)` (timeout path) / `_run_subagent()` (no-timeout path), emit start; wrap execution:

```python
        if sink:
            await sink.start()
        try:
            if execution_timeout > 0:
                llm_resp = await asyncio.wait_for(
                    _run_subagent(), timeout=execution_timeout
                )
            else:
                llm_resp = await _run_subagent()
        except asyncio.TimeoutError:
            cls._save_subagent_history(umo, runner_messages, agent_name)
            subagent_trace.record(
                "subagent_execution_timeout",
                timeout_seconds=execution_timeout,
            )
            error_msg = f"SubAgent '{agent_name}' execution timeout after {execution_timeout:.1f} seconds."
            logger.warning(f"[SubAgent:Timeout] {error_msg}")
            cls._handle_subagent_timeout(umo=umo, agent_name=agent_name)
            if sink:
                await sink.fail("timeout", error_msg)
            yield mcp.types.CallToolResult(
                content=[mcp.types.TextContent(type="text", text=f"error: {error_msg}")]
            )
            return
        except Exception as exc:
            if sink:
                await sink.fail("failed", str(exc))
            raise
```

Note this restructures the existing `if execution_timeout > 0: try/except` / `else:` block into a single try with two excepts — keep the existing timeout body identical, just relocated.

After `execution_time = time.time() - subagent_trace.started_at` and the `subagent_execution_complete` record, before saving history:

```python
        if sink:
            await sink.complete(
                llm_resp.completion_text
                if hasattr(llm_resp, "completion_text") and llm_resp.completion_text
                else "",
                execution_time,
            )
```

In `astrbot/core/config/default.py`:
- In the `provider_settings` default dict after `"show_tool_call_result": False,` add `"show_subagent_progress": True,`
- In the schema block near `"show_tool_call_result": {"type": "bool"},` add `"show_subagent_progress": {"type": "bool"},`
- In metadata near `"provider_settings.show_tool_use_status"` add:

```python
                    "provider_settings.show_subagent_progress": {
                        "description": "展示子代理执行过程",
                        "type": "bool",
                        "hint": "仅在 WebChat 生效，实时展示 SubAgent 的文本流与工具调用过程。",
                        "condition": {
                            "provider_settings.agent_runner_type": "local",
                        },
                    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_astr_agent_tool_exec.py tests/unit/test_subagent_event_sink.py -q`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add astrbot/core/astr_agent_tool_exec.py astrbot/core/config/default.py tests/unit/test_astr_agent_tool_exec.py
git commit -m "feat: stream foreground subagent progress to webchat back queue"
```

---

### Task 4: Persistence — accumulator + consume routing

**Files:**
- Modify: `astrbot/dashboard/services/chat_service.py` (`BotMessageAccumulator` ~line 307; `_consume_chat_run` ~line 1310)
- Test: `tests/unit/test_subagent_progress.py` (create)

**Interfaces:**
- Consumes: `subagent_event` payloads (Task 3 wire contract).
- Produces: `BotMessageAccumulator.add_subagent_event(data: dict) -> None`; `has_content()` also true when subagent runs exist; persisted part schema per the Wire Protocol section.

- [ ] **Step 1: Write the failing test**

```python
"""Tests for subagent_run part accumulation and consume routing."""

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from astrbot.dashboard.services.chat_service import (
    BotMessageAccumulator,
    ChatRunState,
    ChatService,
)


def _event(run_id, kind, payload, agent="researcher"):
    return {
        "type": "subagent_event",
        "message_id": "run-1",
        "streaming": True,
        "data": {
            "subagent_run_id": run_id,
            "agent_name": agent,
            "kind": kind,
            "payload": payload,
            "ts": 1.0,
        },
    }


class TestAccumulator:
    def test_full_lifecycle_builds_single_part(self):
        acc = BotMessageAccumulator()
        acc.add_subagent_event(_event("sa_1", "started", {"input_preview": "task"})["data"])
        acc.add_subagent_event(_event("sa_1", "text_delta", {"text": "Hello "})["data"])
        acc.add_subagent_event(_event("sa_1", "text_delta", {"text": "world"})["data"])
        acc.add_subagent_event(_event("sa_1", "reasoning_delta", {"text": "hmm"})["data"])
        acc.add_subagent_event(
            _event("sa_1", "tool_call", {"id": "c1", "name": "web_search", "args": {}})["data"]
        )
        acc.add_subagent_event(
            _event("sa_1", "tool_call_result", {"id": "c1", "result": "found"})["data"]
        )
        acc.add_subagent_event(
            _event("sa_1", "completed", {"result_text": "Hello world", "execution_time": 3.0})["data"]
        )
        parts = acc.build_message_parts()
        (part,) = [p for p in parts if p["type"] == "subagent_run"]
        assert part["subagent_run_id"] == "sa_1"
        assert part["agent_name"] == "researcher"
        assert part["status"] == "completed"
        assert part["text"] == "Hello world"
        assert part["reasoning"] == "hmm"
        assert part["tool_calls"] == [
            {"id": "c1", "name": "web_search", "args": {}, "result": "found"}
        ]
        assert part["execution_time"] == 3.0

    def test_part_position_follows_event_order(self):
        acc = BotMessageAccumulator()
        acc.add_plain("before ", chain_type=None, streaming=True)
        acc.add_subagent_event(_event("sa_1", "started", {"input_preview": ""})["data"])
        acc.add_plain("after", chain_type=None, streaming=True)
        types = [p["type"] for p in acc.build_message_parts()]
        assert types == ["plain", "subagent_run", "plain"]

    def test_failure_status(self):
        acc = BotMessageAccumulator()
        acc.add_subagent_event(_event("sa_1", "started", {"input_preview": ""})["data"])
        acc.add_subagent_event(_event("sa_1", "timeout", {"error": "boom"})["data"])
        (part,) = acc.build_message_parts()
        assert part["status"] == "timeout"
        assert part["error"] == "boom"

    def test_has_content_includes_subagent_runs(self):
        acc = BotMessageAccumulator()
        assert not acc.has_content()
        acc.add_subagent_event(_event("sa_1", "started", {"input_preview": ""})["data"])
        assert acc.has_content()

    def test_multiple_runs_stay_separate(self):
        acc = BotMessageAccumulator()
        acc.add_subagent_event(_event("sa_1", "text_delta", {"text": "A"})["data"])
        acc.add_subagent_event(_event("sa_2", "text_delta", {"text": "B"}, agent="writer")["data"])
        parts = [p for p in acc.build_message_parts() if p["type"] == "subagent_run"]
        assert len(parts) == 2
        assert parts[0]["text"] == "A"
        assert parts[1]["text"] == "B"
        assert parts[1]["agent_name"] == "writer"


class TestConsumeRouting:
    @pytest.mark.asyncio
    async def test_subagent_event_published_and_persisted(self):
        service = ChatService.__new__(ChatService)
        service.chat_runs = {}
        service.chat_runs_by_session = {}
        service.running_convs = {}
        saved = []

        async def _save(session_id, parts, agent_stats, refs, checkpoint_id, platform_id):
            saved.append(parts)
            return SimpleNamespace(id=7, created_at=datetime.now(UTC))

        service.save_bot_message = _save

        run = ChatRunState(
            run_id="run-1",
            username="u",
            session_id="conv-1",
            llm_checkpoint_id="cp-1",
            platform_history_id="webchat",
            back_queue=asyncio.Queue(),
        )
        subscriber: asyncio.Queue = asyncio.Queue()
        run.subscribers.add(subscriber)

        task = asyncio.create_task(service._consume_chat_run(run))
        await run.back_queue.put(_event("sa_1", "started", {"input_preview": "t"}))
        await run.back_queue.put(_event("sa_1", "text_delta", {"text": "hi"}))
        await run.back_queue.put(
            {
                "type": "complete",
                "data": "hi",
                "streaming": True,
                "message_id": "run-1",
            }
        )
        await run.back_queue.put(
            {"type": "end", "data": "", "streaming": False, "message_id": "run-1"}
        )
        await asyncio.wait_for(task, timeout=5)

        published = []
        while not subscriber.empty():
            item = subscriber.get_nowait()
            if item:
                published.append(item[1])
        kinds = [
            p["data"]["kind"] for p in published if p.get("type") == "subagent_event"
        ]
        assert kinds == ["started", "text_delta"]
        assert any(p.get("type") == "message_saved" for p in published)

        assert saved, "bot message should be persisted"
        final_parts = saved[-1]
        (sub_part,) = [p for p in final_parts if p["type"] == "subagent_run"]
        assert sub_part["text"] == "hi"
        assert sub_part["status"] == "running"  # no completed event arrived
```

Note: `_consume_chat_run` also touches `webchat_queue_mgr.remove_back_queue(run.run_id)` (no-op when absent) and `self.chat_runs.get(run.run_id)` (empty dict — fine). `run.message_parts` snapshot uses `deepcopy(display_accumulator)` — verify deepcopy works with the new dict structures (plain dicts — fine). If `ChatRunState` requires more fields at execution, add them.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_subagent_progress.py -q`
Expected: FAIL — `AttributeError: 'BotMessageAccumulator' object has no attribute 'add_subagent_event'`

- [ ] **Step 3: Implement**

In `BotMessageAccumulator.__init__`, add:

```python
        self.subagent_runs: dict[str, dict] = {}
        """subagent_run_id -> mutable persisted part (also referenced in self.parts)."""
```

Extend `has_content()`'s OR-chain with `or self.subagent_runs`.

Add the method:

```python
    def add_subagent_event(self, data: dict) -> None:
        """Fold one ``subagent_event`` payload into a ``subagent_run`` part.

        The part is appended to ``self.parts`` on first sight (preserving
        chronological position) and mutated in place afterwards, so
        ``build_message_parts`` always reflects the latest run state.

        Args:
            data: The ``data`` field of a ``subagent_event`` payload.
        """
        if not isinstance(data, dict):
            return
        run_id = str(data.get("subagent_run_id") or "")
        if not run_id:
            return
        kind = str(data.get("kind") or "")
        payload = data.get("payload")
        payload = payload if isinstance(payload, dict) else {}

        part = self.subagent_runs.get(run_id)
        if part is None:
            self._flush_pending_text()
            part = {
                "type": "subagent_run",
                "subagent_run_id": run_id,
                "agent_name": str(data.get("agent_name") or ""),
                "status": "running",
                "input_preview": "",
                "text": "",
                "reasoning": "",
                "tool_calls": [],
                "started_ts": data.get("ts"),
                "execution_time": None,
            }
            self.subagent_runs[run_id] = part
            self.parts.append(part)

        if kind == "started":
            part["input_preview"] = str(payload.get("input_preview") or "")
        elif kind == "text_delta":
            part["text"] += str(payload.get("text") or "")
        elif kind == "reasoning_delta":
            part["reasoning"] += str(payload.get("text") or "")
        elif kind == "tool_call":
            call_id = payload.get("id")
            if call_id is not None:
                existing = next(
                    (t for t in part["tool_calls"] if t.get("id") == call_id), None
                )
                if existing:
                    existing.update(payload)
                else:
                    part["tool_calls"].append(dict(payload))
        elif kind == "tool_call_result":
            call_id = payload.get("id")
            existing = next(
                (t for t in part["tool_calls"] if t.get("id") == call_id), None
            )
            if existing:
                existing["result"] = payload.get("result", "")
            elif call_id is not None:
                part["tool_calls"].append(dict(payload))
        elif kind == "completed":
            part["status"] = "completed"
            if not part["text"] and payload.get("result_text"):
                part["text"] = str(payload["result_text"])
            if isinstance(payload.get("execution_time"), int | float):
                part["execution_time"] = payload["execution_time"]
        elif kind in ("failed", "timeout"):
            part["status"] = kind
            if payload.get("error"):
                part["error"] = str(payload["error"])
```

In `_consume_chat_run`, immediately before `if msg_type == "plain":`, add:

```python
                if msg_type == "subagent_event":
                    event_data = result.get("data")
                    if isinstance(event_data, dict):
                        for accumulator in (pending_accumulator, display_accumulator):
                            accumulator.add_subagent_event(event_data)
```

(The existing fall-through then snapshots accumulators and `_publish_chat_run(run, result)` forwards the payload verbatim — no other change.)

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_subagent_progress.py tests/test_webchat_system_stream.py tests/test_chat_system_stream.py -q`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add astrbot/dashboard/services/chat_service.py tests/unit/test_subagent_progress.py
git commit -m "feat: persist subagent_run parts in webchat message history"
```

---

### Task 5: Frontend reducer + stream dispatch

**Files:**
- Create: `dashboard/src/composables/subagentRunReducer.ts`
- Create: `dashboard/src/composables/subagentRunReducer.test.ts`
- Modify: `dashboard/src/composables/useMessages.ts` (`processStreamPayload`, ~line 1358; add import ~line 37)

**Interfaces:**
- Consumes: `subagent_event` payloads from `readSseStream`.
- Produces: `applySubAgentEvent(parts: MessagePart[], data: unknown): void` (mutates the parts array in place — Vue reactivity via existing proxy); `SubAgentRunPart` interface used by Task 6.

- [ ] **Step 1: Write the failing test**

```ts
// dashboard/src/composables/subagentRunReducer.test.ts
// Author: elecvoid243, 2026-07-26
import { describe, expect, it } from "vitest";
import { applySubAgentEvent, type SubAgentRunPart } from "./subagentRunReducer.ts";
import { normalizeMessageParts } from "./normalizeMessageParts.ts";
import type { MessagePart } from "./normalizeMessageParts.ts";

function ev(runId: string, kind: string, payload: any, agent = "researcher") {
  return { subagent_run_id: runId, agent_name: agent, kind, payload, ts: 1 };
}

describe("applySubAgentEvent", () => {
  it("folds a full lifecycle into one part at first-seen position", () => {
    const parts: MessagePart[] = [{ type: "plain", text: "before" }];
    applySubAgentEvent(parts, ev("sa_1", "started", { input_preview: "task" }));
    applySubAgentEvent(parts, ev("sa_1", "text_delta", { text: "Hello " }));
    applySubAgentEvent(parts, ev("sa_1", "text_delta", { text: "world" }));
    applySubAgentEvent(parts, ev("sa_1", "reasoning_delta", { text: "hmm" }));
    applySubAgentEvent(parts, ev("sa_1", "tool_call", { id: "c1", name: "web_search", args: {} }));
    applySubAgentEvent(parts, ev("sa_1", "tool_call_result", { id: "c1", result: "found" }));
    applySubAgentEvent(parts, ev("sa_1", "completed", { result_text: "Hello world", execution_time: 3 }));

    expect(parts).toHaveLength(2);
    const part = parts[1] as SubAgentRunPart;
    expect(part.type).toBe("subagent_run");
    expect(part.text).toBe("Hello world");
    expect(part.reasoning).toBe("hmm");
    expect(part.tool_calls).toEqual([{ id: "c1", name: "web_search", args: {}, result: "found" }]);
    expect(part.status).toBe("completed");
    expect(part.execution_time).toBe(3);
  });

  it("keeps concurrent runs separate", () => {
    const parts: MessagePart[] = [];
    applySubAgentEvent(parts, ev("sa_1", "text_delta", { text: "A" }));
    applySubAgentEvent(parts, ev("sa_2", "text_delta", { text: "B" }, "writer"));
    expect(parts).toHaveLength(2);
    expect((parts[0] as SubAgentRunPart).text).toBe("A");
    expect((parts[1] as SubAgentRunPart).agent_name).toBe("writer");
  });

  it("marks failure kinds and keeps error", () => {
    const parts: MessagePart[] = [];
    applySubAgentEvent(parts, ev("sa_1", "started", { input_preview: "" }));
    applySubAgentEvent(parts, ev("sa_1", "timeout", { error: "boom" }));
    const part = parts[0] as SubAgentRunPart;
    expect(part.status).toBe("timeout");
    expect(part.error).toBe("boom");
  });

  it("ignores malformed data without throwing", () => {
    const parts: MessagePart[] = [];
    applySubAgentEvent(parts, null);
    applySubAgentEvent(parts, { kind: "text_delta" }); // missing run id
    applySubAgentEvent(parts, "junk");
    expect(parts).toHaveLength(0);
  });
});

describe("normalizeMessageParts subagent_run passthrough", () => {
  it("preserves subagent_run parts from history", () => {
    const stored = [
      { type: "plain", text: "hi" },
      { type: "subagent_run", subagent_run_id: "sa_1", agent_name: "r", status: "completed", text: "done", tool_calls: [] },
    ];
    const normalized = normalizeMessageParts(stored);
    expect(normalized).toHaveLength(2);
    expect(normalized[1].type).toBe("subagent_run");
    expect((normalized[1] as any).subagent_run_id).toBe("sa_1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d F:\github\Astrbot\.worktrees\feat-subagent-progress\dashboard && pnpm vitest run src/composables/subagentRunReducer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `subagentRunReducer.ts`**

```ts
// Author: elecvoid243
// Date: 2026-07-26
// Plan: docs/superpowers/plans/2026-07-26-subagent-chatui-progress.md
// Leaf reducer for `subagent_event` SSE payloads. Kept free of `@/`
// imports so it is unit-testable from a bare node runner, same
// precedent as normalizeMessageParts.ts.

import type { MessagePart } from "./normalizeMessageParts.ts";

export interface SubAgentRunPart extends MessagePart {
  type: "subagent_run";
  subagent_run_id: string;
  agent_name: string;
  status: "running" | "completed" | "failed" | "timeout";
  input_preview: string;
  text: string;
  reasoning: string;
  tool_calls: Array<Record<string, unknown>>;
  execution_time?: number | null;
  started_ts?: number;
  error?: string;
}

/**
 * Fold one `subagent_event` data payload into the bot record's part list.
 * The part is created at first sight (chronological position) and mutated
 * in place, so Vue reactivity renders updates without re-insertion.
 */
export function applySubAgentEvent(parts: MessagePart[], data: unknown): void {
  if (!data || typeof data !== "object") return;
  const d = data as Record<string, unknown>;
  const runId = typeof d.subagent_run_id === "string" ? d.subagent_run_id : "";
  if (!runId) return;
  const kind = typeof d.kind === "string" ? d.kind : "";
  const payload =
    d.payload && typeof d.payload === "object"
      ? (d.payload as Record<string, unknown>)
      : {};

  let part = parts.find(
    (p): p is SubAgentRunPart =>
      p?.type === "subagent_run" &&
      (p as SubAgentRunPart).subagent_run_id === runId,
  );
  if (!part) {
    part = {
      type: "subagent_run",
      subagent_run_id: runId,
      agent_name: typeof d.agent_name === "string" ? d.agent_name : "",
      status: "running",
      input_preview: "",
      text: "",
      reasoning: "",
      tool_calls: [],
      started_ts: typeof d.ts === "number" ? d.ts : undefined,
      execution_time: null,
    };
    parts.push(part);
  }

  switch (kind) {
    case "started":
      part.input_preview = String(payload.input_preview || "");
      break;
    case "text_delta":
      part.text += String(payload.text || "");
      break;
    case "reasoning_delta":
      part.reasoning += String(payload.text || "");
      break;
    case "tool_call": {
      const id = payload.id != null ? String(payload.id) : "";
      if (!id) break;
      const existing = part.tool_calls.find((t) => String(t.id) === id);
      if (existing) Object.assign(existing, payload);
      else part.tool_calls.push({ ...payload });
      break;
    }
    case "tool_call_result": {
      const id = payload.id != null ? String(payload.id) : "";
      const existing = part.tool_calls.find((t) => String(t.id) === id);
      if (existing) existing.result = payload.result ?? "";
      else if (id) part.tool_calls.push({ ...payload });
      break;
    }
    case "completed":
      part.status = "completed";
      if (!part.text && typeof payload.result_text === "string") {
        part.text = payload.result_text;
      }
      if (typeof payload.execution_time === "number") {
        part.execution_time = payload.execution_time;
      }
      break;
    case "failed":
    case "timeout":
      part.status = kind;
      if (payload.error) part.error = String(payload.error);
      break;
  }
}
```

In `useMessages.ts`:
- Add import: `import { applySubAgentEvent } from "./subagentRunReducer";`
- In `processStreamPayload`, immediately after the `agent_stats` branch, add:

```ts
    if (msgType === "subagent_event") {
      markMessageStarted(botRecord);
      applySubAgentEvent(
        messageContent(botRecord).message as MessagePart[],
        normalized?.data,
      );
      return;
    }
```

(`isThinkingPart` deliberately unchanged — `subagent_run` falls into `content` blocks per approved design option A. `normalizeMessageParts` needs no change: unknown parts pass through via `{ ...part }`; locked by the passthrough test above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/composables/subagentRunReducer.test.ts src/composables/useMessages.askUserChoiceFilter.test.ts`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/composables/subagentRunReducer.ts dashboard/src/composables/subagentRunReducer.test.ts dashboard/src/composables/useMessages.ts
git commit -m "feat: reduce subagent_event SSE payloads into subagent_run parts"
```

---

### Task 6: `SubAgentRunBlock.vue` + template branches

**Files:**
- Create: `dashboard/src/components/chat/message_list_comps/SubAgentRunBlock.vue`
- Modify: `dashboard/src/components/chat/ChatMessageList.vue` (content parts loop, after the `tool_call` branch ~line 293)
- Modify: `dashboard/src/components/chat/MessageList.vue` (same loop, ~line 151)
- Modify: `dashboard/src/components/chat/StandaloneChat.vue` (same loop structure — verify exact location at execution; it imports the same helpers)
- Modify: `dashboard/src/i18n/locales/{en-US,zh-CN,ru-RU}/features/chat.json`

**Interfaces:**
- Consumes: `SubAgentRunPart` (Task 5); existing `ToolCallCard`, `MarkdownRender` (markstream-vue), `useModuleI18n("features/chat")`.
- Produces: `<SubAgentRunBlock :part="part" :is-dark="isDark" :is-streaming="bool" />`.

- [ ] **Step 1: Create the component**

Style conventions follow `ReasoningBlock.vue` (header button + chevron, `is-dark` modifier classes, scoped styles). Reuse `ToolCallCard` for nested tool calls (same `normalizeToolCall` shape as `ChatMessageList` — verify its import source at execution and mirror it; if `normalizeToolCall` is local to ChatMessageList, reuse a plain inline rendering instead to avoid cross-imports — decide at execution, preferring reuse).

```vue
<!-- Author: elecvoid243, 2026-07-26
     Renders one subagent_run part: a collapsible card inside the bot
     bubble showing a subagent's live execution (streamed text,
     reasoning, nested tool calls) and its terminal status. -->
<template>
  <div class="subagent-run" :class="{ 'subagent-run--dark': isDark }">
    <button class="subagent-run__header" type="button" @click="expanded = !expanded">
      <v-icon size="18" class="subagent-run__agent-icon">mdi-robot-outline</v-icon>
      <span class="subagent-run__name">{{ part.agent_name || tm("subagentRun.unknownAgent") }}</span>
      <span class="subagent-run__status" :data-status="part.status">
        <v-progress-circular
          v-if="part.status === 'running'"
          indeterminate
          size="14"
          width="2"
        />
        <v-icon v-else-if="part.status === 'completed'" size="16" color="success">
          mdi-check-circle-outline
        </v-icon>
        <v-icon v-else size="16" color="error">mdi-alert-circle-outline</v-icon>
        {{ statusText }}
      </span>
      <v-icon size="20" class="subagent-run__chevron" :class="{ 'rotate-90': expanded }">
        mdi-chevron-right
      </v-icon>
    </button>

    <div v-if="expanded" class="subagent-run__body animate-fade-in">
      <div v-if="part.input_preview" class="subagent-run__input">
        {{ part.input_preview }}
      </div>
      <div v-if="part.reasoning" class="subagent-run__reasoning">
        {{ part.reasoning }}
      </div>
      <MarkdownRender
        v-if="part.text"
        :content="part.text"
        :is-dark="isDark"
        :final="part.status !== 'running'"
        :smooth-streaming="part.status === 'running' ? 'auto' : false"
      />
      <div v-if="part.tool_calls.length" class="subagent-run__tools">
        <ToolCallCard
          v-for="tool in part.tool_calls"
          :key="String(tool.id || tool.name)"
          :tool-call="tool"
          :is-dark="isDark"
        />
      </div>
      <div v-if="part.error" class="subagent-run__error">{{ part.error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { MarkdownRender } from "markstream-vue";
import ToolCallCard from "@/components/chat/message_list_comps/ToolCallCard.vue";
import { useModuleI18n } from "@/i18n/composables";
import type { SubAgentRunPart } from "@/composables/subagentRunReducer";

const props = defineProps<{
  part: SubAgentRunPart;
  isDark?: boolean;
  isStreaming?: boolean;
}>();

const { tm } = useModuleI18n("features/chat");
const expanded = ref(true);

const statusText = computed(() => {
  const base = tm(`subagentRun.status.${props.part.status}`);
  return typeof props.part.execution_time === "number"
    ? `${base} · ${props.part.execution_time.toFixed(1)}s`
    : base;
});
</script>

<style scoped>
.subagent-run {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
  margin: 6px 0;
  overflow: hidden;
}
.subagent-run__header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 13px;
  cursor: pointer;
}
.subagent-run__name { font-weight: 600; }
.subagent-run__status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  margin-right: 4px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.subagent-run__chevron { transition: transform 0.15s ease; }
.rotate-90 { transform: rotate(90deg); }
.subagent-run__body { padding: 8px 12px; }
.subagent-run__input {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 6px;
}
.subagent-run__reasoning {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  white-space: pre-wrap;
  margin-bottom: 6px;
}
.subagent-run__tools { margin-top: 6px; }
.subagent-run__error { color: rgb(var(--v-theme-error)); font-size: 12px; margin-top: 6px; }
</style>
```

Verify at execution: `ToolCallCard.vue` exact path/props (`tool-call`, `is-dark` — seen in ChatMessageList.vue line ~314), and whether its expected tool-call shape needs `normalizeToolCall`. If it does, export/import that helper or mirror minimal normalization.

- [ ] **Step 2: Add template branches**

In each of `ChatMessageList.vue`, `MessageList.vue`, `StandaloneChat.vue`, inside the content-block `v-for="(part, partIndex) in block.parts"` loop, insert before the `tool_call` branch:

```vue
                    <SubAgentRunBlock
                      v-else-if="part.type === 'subagent_run'"
                      :part="part"
                      :is-dark="isDark"
                      :is-streaming="isMessageStreaming(msg, msgIndex)"
                    />
```

(Adjust prop names per file — `MessageList.vue` uses the same `isMessageStreaming(msg, msgIndex)` helper; verify in StandaloneChat and substitute its equivalent.) Add the component import in each file's `<script>`.

- [ ] **Step 3: Add i18n keys**

To all three `features/chat.json` locale files add:

```json
"subagentRun": {
  "unknownAgent": "subagent",
  "status": {
    "running": "Running",
    "completed": "Done",
    "failed": "Failed",
    "timeout": "Timed out"
  }
}
```

(zh-CN: `运行中/已完成/失败/超时`, `未知子代理` for unknownAgent; ru-RU mirror the English structure with Russian strings. Match existing nesting style/position — append near the `reasoning` key.)

- [ ] **Step 4: Verify types and tests**

Run: `pnpm typecheck` and `pnpm vitest run`
Expected: no type errors; all tests pass

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/chat dashboard/src/i18n/locales
git commit -m "feat: render subagent_run parts as collapsible progress blocks in chat"
```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Python quality gates**

Run: `cd /d F:\github\Astrbot\.worktrees\feat-subagent-progress && uv run ruff format astrbot tests && uv run ruff check astrbot tests`
Expected: clean

- [ ] **Step 2: Backend test suite (affected area)**

Run: `uv run pytest tests/unit/test_subagent_event_sink.py tests/unit/test_tool_loop_agent_sink.py tests/unit/test_subagent_progress.py tests/unit/test_astr_agent_tool_exec.py tests/test_webchat_system_stream.py tests/test_chat_system_stream.py tests/test_tool_loop_agent_runner.py -q`
Expected: all pass

- [ ] **Step 3: Frontend gates**

Run: `cd dashboard && pnpm typecheck && pnpm vitest run`
Expected: clean

- [ ] **Step 4: Manual E2E (documented for the reviewer)**

1. `uv run main.py`, open dashboard Chat, enable a model with tool calling.
2. Ask the agent to create a subagent and delegate (e.g. "create a researcher subagent and have it summarize AstrBot's plugin system").
3. Expected: inside the bot bubble, under the `transfer_to_subagent` tool entry, a `SubAgentRunBlock` appears with the agent name, spinner, streaming text and nested tool calls; on completion the status flips to Done with elapsed seconds.
4. Hard-refresh the page: the block restores from history at the same position with final status.
5. Toggle `provider_settings.show_subagent_progress` off in config, repeat: no block appears (legacy behavior).

- [ ] **Step 5: Final commit (if any formatting fixes)**

```bash
git add -A
git commit -m "chore: format and finalize subagent progress display"
```

## Self-Review Notes

- **Spec coverage:** sink mapping (T1), runner passthrough (T2), handoff wiring + config (T3), SSE fan-out reuse + persistence (T4), frontend dispatch (T5), rendering + i18n (T6), verification (T7). Background-handoff visibility explicitly deferred (Phase 2, out of scope).
- **Type consistency:** payload `data.kind` values identical across sink (T1), accumulator (T4), reducer (T5). Part field names (`subagent_run_id`, `agent_name`, `status`, `input_preview`, `text`, `reasoning`, `tool_calls`, `execution_time`, `started_ts`, `error`) identical in T4 producer and T5/T6 consumers.
- **Known execution-time verifications:** `Json` import path in T1; `LLMResponse` constructor in T2; `ToolCallCard` prop shape + `normalizeToolCall` reuse decision in T6; `StandaloneChat.vue` exact loop location.
