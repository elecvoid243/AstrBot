import asyncio
import json

import pytest

from astrbot.dashboard.services.agent_collab_service import (
    DiscussionRunner,
    RunnerPorts,
)


def _group(n=3):
    members = [{"session_id": f"s{i:08d}x", "alias": f"agent{i}"} for i in range(n)]
    return {
        "id": "g1",
        "name": "g",
        "owner_username": "alice",
        "members": members,
        "moderator_session_id": members[0]["session_id"],
        "created_at": "2026-08-12T00:00:00+00:00",
    }


class FakeWorld:
    """Scripted fake: deliver() records; collect() returns scripted replies."""

    def __init__(self, replies: dict[str, list[str]]):
        self.replies = {k: list(v) for k, v in replies.items()}
        self.delivered: list[tuple[str, str]] = []
        self.contexts: list[tuple[str, str | None]] = []
        self.events: list[dict] = []
        self.busy: set[str] = set()

    def ports(self) -> RunnerPorts:
        async def deliver(
            session_id: str, text: str, context: str | None = None
        ) -> str:
            self.delivered.append((session_id, text))
            self.contexts.append((session_id, context))
            return f"mid{len(self.delivered)}"

        async def collect(session_id: str, message_id: str) -> tuple[str, list]:
            if not self.replies[session_id]:
                raise asyncio.TimeoutError
            reply = self.replies[session_id].pop(0)
            return reply, [{"type": "plain", "text": reply}]

        return RunnerPorts(
            deliver=deliver,
            collect=collect,
            is_busy=lambda sid: sid in self.busy,
            emit=self.events.append,
            reply_timeout=0.2,
            busy_poll_interval=0.01,
        )


def _route(target, mode="forward", content=None):
    payload = {"action": "route", "target": target, "mode": mode}
    if content is not None:
        payload["content"] = content
    return (
        f"安排如下。\n```collab-route\n{json.dumps(payload, ensure_ascii=False)}\n```"
    )


@pytest.mark.asyncio
async def test_forward_chain_and_end():
    world = FakeWorld(
        {
            "s00000000x": [
                _route("agent1"),
                _route("agent1"),
                '```collab-route\n{"action": "end", "summary": "搞定"}\n```',
            ],
            "s00000001x": ["A 的方案", "A 的补充"],
        }
    )
    r = DiscussionRunner(_group(3), "设计一个功能", "alice", world.ports())
    await r.run()
    assert r.state["status"] == "stopped"
    # topic -> moderator; topic forwarded -> member; member reply -> moderator;
    # "A 的方案" forwarded verbatim -> member; back to moderator; end
    assert (
        world.delivered[0][0] == "s00000000x"
        and "设计一个功能" in world.delivered[0][1]
    )
    assert (
        world.delivered[1][0] == "s00000001x"
        and "设计一个功能" in world.delivered[1][1]
    )
    assert world.delivered[3][0] == "s00000001x" and "A 的方案" in world.delivered[3][1]
    assert r.state["hop_count"] == 5
    # moderator turns carry the routing instructions; member turns carry the
    # participant roster so every discussant is aware of the others
    assert "collab-route" in world.contexts[0][1]
    assert "参与者" in world.contexts[1][1]
    assert "agent1（你）" in world.contexts[1][1]
    # transcript events: one sent + one reply per turn; replies keep the
    # moderator's routing directive (scheduling content) and carry parts
    msgs = [e for e in world.events if e.get("type") == "message"]
    assert len([m for m in msgs if m["direction"] == "sent"]) == 5
    assert len([m for m in msgs if m["direction"] == "reply"]) == 5
    assert msgs[0]["session_id"] == "s00000000x" and "设计一个功能" in msgs[0]["text"]
    assert all(
        "collab-route" in m["text"]
        for m in msgs
        if m["direction"] == "reply" and m["session_id"] == "s00000000x"
    )
    assert all(m.get("parts") for m in msgs if m["direction"] == "reply")


@pytest.mark.asyncio
async def test_literal_mode_uses_content():
    world = FakeWorld(
        {
            "s00000000x": [
                _route("agent1", mode="literal", content="加工后的任务"),
                '```collab-route\n{"action": "end", "summary": "s"}\n```',
            ],
            "s00000001x": ["回复"],
        }
    )
    r = DiscussionRunner(_group(3), "topic", "alice", world.ports())
    await r.run()
    assert "加工后的任务" in world.delivered[1][1]
    assert "回复" not in world.delivered[1][1]


@pytest.mark.asyncio
async def test_pair_group_plain_forward_and_end():
    g = _group(2)
    world = FakeWorld(
        {
            g["members"][0]["session_id"]: [
                "主持人的回答",
                '```collab-route\n{"action": "end", "summary": "bye"}\n```',
            ],
            g["members"][1]["session_id"]: ["成员的回应"],
        }
    )
    r = DiscussionRunner(g, "topic", "alice", world.ports())
    await r.run()
    # moderator plain reply forwarded verbatim to the sole member
    assert "主持人的回答" in world.delivered[1][1]
    assert r.state["status"] == "stopped"


@pytest.mark.asyncio
async def test_pair_forward_strips_directive_block():
    g = _group(2)
    world = FakeWorld(
        {
            g["members"][0]["session_id"]: [
                _route("whatever"),
                '```collab-route\n{"action": "end", "summary": "bye"}\n```',
            ],
            g["members"][1]["session_id"]: ["回应"],
        }
    )
    r = DiscussionRunner(g, "topic", "alice", world.ports())
    await r.run()
    # the moderator's route directive must never reach the member
    body = world.delivered[1][1]
    assert "collab-route" not in body
    assert '"action": "route"' not in body
    # member still receives the conversational part of the reply
    assert "安排如下" in body
    assert r.state["status"] == "stopped"


@pytest.mark.asyncio
async def test_parse_failure_pauses_then_manual_route():
    g = _group(3)
    world = FakeWorld(
        {
            "s00000000x": [
                "我忘了输出指令",
                '```collab-route\n{"action": "end", "summary": "s"}\n```',
            ],
            "s00000001x": ["成员回复"],
        }
    )
    r = DiscussionRunner(g, "topic", "alice", world.ports())
    task = asyncio.create_task(r.run())
    await asyncio.sleep(0.1)
    assert r.state["status"] == "paused"
    assert any(e.get("type") == "route_parse_failed" for e in world.events)
    r.manual_route("s00000001x", "人工指定：请回应")
    r.resume()
    await task
    assert r.state["status"] == "stopped"
    assert any("人工指定" in t for _, t in world.delivered)


@pytest.mark.asyncio
async def test_busy_pending_then_deliver():
    g = _group(2)
    world = FakeWorld(
        {
            g["members"][0]["session_id"]: [
                '```collab-route\n{"action": "end", "summary": "s"}\n```'
            ],
            g["members"][1]["session_id"]: ["ok"],
        }
    )
    world.busy.add(g["members"][0]["session_id"])
    r = DiscussionRunner(g, "topic", "alice", world.ports())

    async def release():
        await asyncio.sleep(0.05)
        world.busy.clear()

    await asyncio.gather(r.run(), release())
    assert world.delivered[0][0] == g["members"][0]["session_id"]


@pytest.mark.asyncio
async def test_hop_limit_pauses():
    g = _group(2)
    endless = ["继续讨论"] * 60
    world = FakeWorld(
        {
            g["members"][0]["session_id"]: endless,
            g["members"][1]["session_id"]: list(endless),
        }
    )
    r = DiscussionRunner(g, "topic", "alice", world.ports())
    r.state["hop_limit"] = 4
    task = asyncio.create_task(r.run())
    await asyncio.sleep(0.2)
    assert r.state["status"] == "paused"
    assert any(e.get("type") == "hop_limit_reached" for e in world.events)
    r.stop()
    await task
    assert r.state["status"] == "stopped"


@pytest.mark.asyncio
async def test_collect_timeout_pauses():
    g = _group(2)
    world = FakeWorld(
        {g["members"][0]["session_id"]: [], g["members"][1]["session_id"]: []}
    )
    # collect hangs longer than reply_timeout so the timeout fires while stop()
    # has already been requested
    ports = world.ports()

    async def slow_collect(session_id: str, message_id: str) -> tuple[str, list]:
        await asyncio.sleep(0.3)
        raise asyncio.TimeoutError

    ports.collect = slow_collect
    r = DiscussionRunner(g, "topic", "alice", ports)
    task = asyncio.create_task(r.run())
    await asyncio.sleep(0.4)
    assert r.state["status"] == "paused"
    assert any(e.get("type") == "error" for e in world.events)
    r.stop()
    await task


@pytest.mark.asyncio
async def test_stop_during_collect_timeout_does_not_hang():
    """Regression: stop() while the runner is collecting must not deadlock
    inside _pause_until_resumed (its _wake.clear() used to swallow the stop
    wake-up and wait forever)."""
    g = _group(2)
    world = FakeWorld(
        {g["members"][0]["session_id"]: [], g["members"][1]["session_id"]: []}
    )
    # collect hangs longer than reply_timeout so the timeout fires while
    # stop() has already been requested
    ports = world.ports()

    async def slow_collect(session_id: str, message_id: str) -> tuple[str, list]:
        await asyncio.sleep(0.3)
        raise asyncio.TimeoutError

    ports.collect = slow_collect
    r = DiscussionRunner(g, "topic", "alice", ports)
    task = asyncio.create_task(r.run())
    await asyncio.sleep(0.05)
    r.stop()  # collect will time out afterwards (reply_timeout=0.2)
    await asyncio.wait_for(task, timeout=2)
    assert r.state["status"] == "stopped"


@pytest.mark.asyncio
async def test_stop_interrupts_in_flight_collect_immediately():
    """Regression: clicking 停止 while a reply is being collected used to
    wait out the full reply_timeout (180s in production) before the runner
    noticed. The stop event must race the collection and end the hop at
    once."""
    g = _group(2)
    world = FakeWorld(
        {g["members"][0]["session_id"]: [], g["members"][1]["session_id"]: []}
    )
    ports = world.ports()

    async def never_collect(session_id: str, message_id: str) -> tuple[str, list]:
        await asyncio.sleep(30)  # far longer than the test timeout
        return "late", []

    ports.collect = never_collect
    ports.reply_timeout = 20.0
    r = DiscussionRunner(g, "topic", "alice", ports)
    task = asyncio.create_task(r.run())
    await asyncio.sleep(0.05)
    r.stop()  # must interrupt the hanging collect immediately
    await asyncio.wait_for(task, timeout=2)
    assert r.state["status"] == "stopped"
    assert any(e.get("type") == "stopped" for e in world.events)
    # No further turns were injected after the stop.
    assert len(world.delivered) == 1


@pytest.mark.asyncio
async def test_resume_clears_stop_request():
    """A paused-then-resumed discussion must collect replies again — the
    stop event from the earlier stop() call must not abort every future
    hop."""
    g = _group(2)
    world = FakeWorld(
        {g["members"][0]["session_id"]: [], g["members"][1]["session_id"]: ["B1"]}
    )
    ports = world.ports()

    async def hanging_collect(session_id: str, message_id: str) -> tuple[str, list]:
        await asyncio.sleep(30)
        return "late", []

    ports.collect = hanging_collect
    ports.reply_timeout = 0.2
    r = DiscussionRunner(g, "topic", "alice", ports)
    task = asyncio.create_task(r.run())
    await asyncio.sleep(0.05)
    r.stop()  # interrupt the first (hanging) collect
    await asyncio.wait_for(task, timeout=2)
    assert r.state["status"] == "stopped"

    # Resume: the discussion runs again and now collects normally.
    r.resume()
    assert r._stop_requested.is_set() is False
