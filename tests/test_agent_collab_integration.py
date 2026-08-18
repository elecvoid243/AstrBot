import asyncio
import json

import pytest

from astrbot.core.platform.sources.webchat.webchat_queue_mgr import WebChatQueueMgr
from astrbot.dashboard.services.agent_collab_service import (
    AgentCollabService,
    DiscussionRunner,
)


@pytest.mark.asyncio
async def test_end_to_end_with_real_queue_mgr():
    """Inject via the real input-queue contract; a fake listener simulates the
    adapter by mirroring a scripted agent reply to system subscribers."""
    mgr = WebChatQueueMgr()
    group = {
        "id": "g1",
        "name": "g",
        "owner_username": "alice",
        "members": [
            {"session_id": "conv-mod-0001", "alias": "主持人"},
            {"session_id": "conv-mem-0002", "alias": "成员"},
        ],
        "moderator_session_id": "conv-mod-0001",
        "created_at": "2026-08-12T00:00:00+00:00",
    }
    scripted = {
        "conv-mod-0001": [
            "回答如下",
            f"```collab-route\n{json.dumps({'action': 'end', 'summary': 'done'})}\n```",
        ],
        "conv-mem-0002": ["成员的见解"],
    }
    inbox: list[tuple[str, str, dict]] = []

    async def fake_listener(data):
        username, conv_id, payload = data
        inbox.append(data)
        mid = payload["message_id"]
        reply = scripted[conv_id].pop(0)
        for chunk, t in ((reply, "plain"), ("", "end")):
            await mgr.put_system_event(
                conv_id,
                {
                    "type": t,
                    "message_id": mid,
                    "data": chunk,
                    "streaming": False,
                    "chain_type": "normal",
                },
            )

    mgr.set_listener(fake_listener)

    events: list[dict] = []
    service = AgentCollabService()
    ports = service.build_ports_for_test(
        mgr,
        username="alice",
        emit=events.append,
        reply_timeout=2.0,
        busy_poll_interval=0.01,
    )
    runner = DiscussionRunner(group, "评审这个设计", "alice", ports)
    await asyncio.wait_for(runner.run(), timeout=5)

    assert runner.state["status"] == "stopped"
    assert runner.state["hop_count"] == 3
    # input-queue order: topic -> moderator, moderator plain reply -> member,
    # member reply -> moderator
    assert (
        inbox[0][1] == "conv-mod-0001"
        and "评审这个设计" in inbox[0][2]["message"][0]["text"]
    )
    assert (
        inbox[1][1] == "conv-mem-0002"
        and "回答如下" in inbox[1][2]["message"][0]["text"]
    )
    assert (
        inbox[2][1] == "conv-mod-0001"
        and "成员的见解" in inbox[2][2]["message"][0]["text"]
    )
    # moderator deliveries carry the routing instructions; member deliveries
    # carry the participant roster (temp extra consumed by build_main_agent)
    assert "collab-route" in inbox[0][2]["collab_context"]
    assert "参与者" in inbox[1][2]["collab_context"]
    # transcript events: per-turn sent/reply plus live stream deltas
    stream_deltas = [
        e
        for e in events
        if e.get("type") == "message" and e.get("direction") == "stream"
    ]
    assert len(stream_deltas) >= 3  # one delta per plain chunk per turn
    assert any(
        e.get("type") == "message" and e.get("direction") == "reply" for e in events
    )
    await mgr.clear_listener()


@pytest.mark.asyncio
async def test_busy_blocks_delivery():
    mgr = WebChatQueueMgr()

    async def noop_listener(data):
        await asyncio.sleep(0)

    mgr.set_listener(noop_listener)
    service = AgentCollabService()
    ports = service.build_ports_for_test(
        mgr,
        username="alice",
        emit=lambda e: None,
        reply_timeout=0.5,
        busy_poll_interval=0.01,
        is_busy_override=lambda sid: True,
    )
    group = {
        "id": "g",
        "name": "g",
        "owner_username": "alice",
        "members": [
            {"session_id": "c00000001x", "alias": "a"},
            {"session_id": "c00000002x", "alias": "b"},
        ],
        "moderator_session_id": "c00000001x",
        "created_at": "2026-08-12T00:00:00+00:00",
    }
    runner = DiscussionRunner(group, "t", "alice", ports)
    task = asyncio.create_task(runner.run())
    await asyncio.sleep(0.1)
    assert runner.state["hop_count"] == 0  # nothing delivered while busy
    runner.stop()
    await task
    await mgr.clear_listener()
