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
        self.events: list[dict] = []
        self.busy: set[str] = set()

    def ports(self) -> RunnerPorts:
        async def deliver(session_id: str, text: str) -> str:
            self.delivered.append((session_id, text))
            return f"mid{len(self.delivered)}"

        async def collect(session_id: str, message_id: str) -> str:
            if not self.replies[session_id]:
                raise asyncio.TimeoutError
            return self.replies[session_id].pop(0)

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
    r = DiscussionRunner(g, "topic", "alice", world.ports())
    task = asyncio.create_task(r.run())
    await asyncio.sleep(0.4)
    assert r.state["status"] == "paused"
    assert any(e.get("type") == "error" for e in world.events)
    r.stop()
    await task
