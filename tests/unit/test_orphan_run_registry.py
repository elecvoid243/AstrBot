"""Orphan-run registry: lets goal/collab synthetic turns join the active-run
recovery (snapshot + resume stream) and suppresses duplicate persistence."""


import pytest

from astrbot.core.platform.sources.webchat.webchat_queue_mgr import (
    OrphanRunRegistry,
)


def test_register_update_finish_lifecycle():
    reg = OrphanRunRegistry()
    reg.register("run1", "conv1")
    reg.update("run1", [{"type": "plain", "text": "hi"}])
    run = reg.get("run1")
    assert run is not None and run.message_parts[0]["text"] == "hi"
    assert [r.run_id for r in reg.active_for_conversation("conv1")] == ["run1"]
    assert reg.active_for_conversation("conv2") == []

    reg.finish("run1")
    assert reg.get("run1") is None
    assert reg.active_for_conversation("conv1") == []
    # finished orphans are remembered so the system-stream flush skips them
    assert reg.was_finished_orphan("run1")
    assert not reg.was_finished_orphan("run2")


@pytest.mark.asyncio
async def test_publish_fans_out_to_subscribers():
    reg = OrphanRunRegistry()
    reg.register("run1", "conv1")
    queue = reg.subscribe("run1")
    assert queue is not None

    reg.publish("run1", {"type": "plain", "data": "chunk", "message_id": "run1"})
    reg.publish("other", {"type": "plain", "data": "x", "message_id": "other"})
    assert queue.qsize() == 1
    assert (queue.get_nowait())["data"] == "chunk"

    # finish delivers the terminal end event and clears subscribers
    reg.finish("run1")
    assert queue.get_nowait()["type"] == "end"
    assert reg.subscribe("run1") is None


def test_get_active_chat_runs_merges_orphans():
    from astrbot.dashboard.services.chat_service import ChatService

    reg = OrphanRunRegistry()
    reg.register("orphan1", "conv1")
    reg.update(
        "orphan1",
        [{"type": "think", "think": "思考"}, {"type": "plain", "text": "输出"}],
    )

    from unittest.mock import patch

    service = ChatService.__new__(ChatService)
    service.chat_runs = {}
    with patch(
        "astrbot.core.platform.sources.webchat.webchat_queue_mgr.orphan_run_registry.active_for_conversation",
        reg.active_for_conversation,
    ):
        snapshots = service.get_active_chat_runs("alice", "conv1")
    assert len(snapshots) == 1
    snap = snapshots[0]
    assert snap["run_id"] == "orphan1"
    assert snap["status"] == "running"
    assert snap["content"]["type"] == "bot"
    types = [p["type"] for p in snap["content"]["message"]]
    assert types == ["think", "plain"]
