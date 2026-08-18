"""Route-level tests: exercise the collab endpoints with a stubbed service."""

import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from astrbot.dashboard.api.agent_collab import get_service, legacy_router
from astrbot.dashboard.api.auth import require_dashboard_user
from astrbot.dashboard.services.agent_collab_service import (
    AgentCollabService,
    AgentCollabServiceError,
)


def test_routes_registered():
    paths = {r.path for r in legacy_router.routes}
    assert "/api/agent_collab/groups" in paths
    assert "/api/agent_collab/groups/{group_id}" in paths
    assert "/api/agent_collab/groups/{group_id}/discussions" in paths
    assert "/api/agent_collab/discussions/{discussion_id}/stop" in paths
    assert "/api/agent_collab/discussions/{discussion_id}/resume" in paths
    assert "/api/agent_collab/discussions/{discussion_id}/route" in paths
    assert "/api/agent_collab/discussions/{discussion_id}/stream" in paths


class _FakeRunner:
    """Minimal runner double: run() completes immediately."""

    def __init__(self, state: dict):
        self.state = state

    async def run(self):
        self.state["status"] = "stopped"


class _StubService(AgentCollabService):
    """Stub capturing calls; group CRUD backed by an in-memory store."""

    def __init__(self):
        super().__init__()
        self.calls = []
        self._groups = {
            "g1": {
                "id": "g1",
                "name": "g",
                "owner_username": "astrbot",
                "members": [
                    {"session_id": "s1", "alias": "a"},
                    {"session_id": "s2", "alias": "b"},
                ],
                "moderator_session_id": "s1",
                "created_at": "t",
            }
        }
        self._runner_state = {
            "id": "d1",
            "group_id": "g1",
            "topic": "t",
            "status": "stopped",
            "hop_count": 0,
            "hop_limit": 50,
            "current_turn": None,
            "last_member_reply": "",
            "pending": [],
        }

    async def list_groups(self, username):
        self.calls.append(("list_groups", username))
        return {
            "groups": [
                g for g in self._groups.values() if g["owner_username"] == username
            ]
        }

    async def create_group(self, username, payload):
        self.calls.append(("create_group", username, payload))
        return {"id": "g2", **payload}

    async def update_group(self, username, group_id, payload):
        self.calls.append(("update_group", username, group_id, payload))
        return {"id": group_id, **payload}

    async def delete_group(self, username, group_id):
        self.calls.append(("delete_group", username, group_id))
        return {"message": "分组已解散"}

    async def load_group(self, username, group_id):
        group = self._groups.get(group_id)
        if not group or group["owner_username"] != username:
            raise AgentCollabServiceError(f"分组 '{group_id}' 不存在")
        return group

    async def start_discussion(self, username, group_id, topic, ports):
        if not topic.strip():
            raise AgentCollabServiceError("讨论主题不能为空")
        self.calls.append(("start_discussion", username, group_id, topic))
        self.discussions[self._runner_state["id"]] = {
            "group_id": group_id,
            "runner": _FakeRunner(self._runner_state),
        }
        return self._runner_state

    def stop_discussion(self, discussion_id):
        self.calls.append(("stop_discussion", discussion_id))
        return {"message": "讨论停止中"}

    def resume_discussion(self, discussion_id, reset_hops=False):
        self.calls.append(("resume_discussion", discussion_id, reset_hops))
        return {"message": "讨论已恢复"}

    def route_discussion(self, discussion_id, target_session_id, message):
        self.calls.append(
            ("route_discussion", discussion_id, target_session_id, message)
        )
        return {"message": "已指定下一站"}

    def build_ports(self, chat_service, username, emit):
        return None


def _build_isolated_app(stub: _StubService) -> FastAPI:
    """Minimal app with just the collab router; auth and service stubbed."""
    app = FastAPI()
    app.include_router(legacy_router)
    app.state.services = SimpleNamespace(chat=None)
    app.dependency_overrides[get_service] = lambda: stub
    app.dependency_overrides[require_dashboard_user] = lambda: "astrbot"
    return app


def test_group_endpoints_roundtrip():
    stub = _StubService()
    client = TestClient(_build_isolated_app(stub))
    assert (
        client.get("/api/agent_collab/groups").json()["data"]["groups"][0]["id"] == "g1"
    )
    assert (
        client.post("/api/agent_collab/groups", json={"name": "x"}).json()["status"]
        == "ok"
    )
    assert (
        client.put("/api/agent_collab/groups/g1", json={"name": "y"}).json()["status"]
        == "ok"
    )
    assert client.delete("/api/agent_collab/groups/g1").json()["status"] == "ok"
    assert ("delete_group", "astrbot", "g1") in stub.calls


def test_discussion_control_endpoints():
    stub = _StubService()
    client = TestClient(_build_isolated_app(stub))
    r = client.post("/api/agent_collab/groups/g1/discussions", json={"topic": "主题"})
    assert r.json()["data"]["discussion_id"] == "d1"
    assert ("start_discussion", "astrbot", "g1", "主题") in stub.calls
    assert client.post("/api/agent_collab/discussions/d1/stop").json()["status"] == "ok"
    assert (
        client.post("/api/agent_collab/discussions/d1/resume", json={}).json()["status"]
        == "ok"
    )
    assert (
        client.post(
            "/api/agent_collab/discussions/d1/resume", json={"reset_hops": True}
        ).json()["status"]
        == "ok"
    )
    assert ("resume_discussion", "d1", True) in stub.calls
    r = client.post(
        "/api/agent_collab/discussions/d1/route",
        json={"target_session_id": "s2", "message": "go"},
    )
    assert r.json()["status"] == "ok"
    assert ("route_discussion", "d1", "s2", "go") in stub.calls


def test_start_discussion_empty_topic_returns_error():
    stub = _StubService()
    client = TestClient(_build_isolated_app(stub))
    r = client.post("/api/agent_collab/groups/g1/discussions", json={"topic": "  "})
    assert r.json()["status"] == "error"


def test_stream_requires_existing_discussion():
    stub = _StubService()
    client = TestClient(_build_isolated_app(stub))
    r = client.get("/api/agent_collab/discussions/missing/stream")
    assert r.json()["status"] == "error"


class _FakeRecord:
    """Minimal platform-history record double."""

    def __init__(self, content: dict, ts: float):
        self.content = content
        self.created_at = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc)


def _build_transcript_app(stub, fake_mgr) -> FastAPI:
    """App with a stubbed chat service exposing a scripted history manager."""
    app = _build_isolated_app(stub)
    app.state.services.chat = SimpleNamespace(platform_history_mgr=fake_mgr)
    return app


def test_group_transcript_aggregates_pairs_and_strips():
    stub = _StubService()
    fake_mgr = MagicMock()
    # s1 (moderator): injected topic + reply-with-directive; ordinary user
    # message in between must be skipped; s2: injected input + plain reply.
    histories = {
        "s1": [
            _FakeRecord(
                {
                    "type": "user",
                    "message": [
                        {"type": "plain", "text": "[来自 用户alice]: 讨论主题"}
                    ],
                },
                100.0,
            ),
            _FakeRecord(
                {
                    "type": "bot",
                    "message": [
                        {
                            "type": "plain",
                            "text": '我的看法\n```collab-route\n{"action": "route", "target": "x", "mode": "forward"}\n```',
                        }
                    ],
                },
                101.0,
            ),
            _FakeRecord(
                {"type": "user", "message": [{"type": "plain", "text": "普通闲聊"}]},
                102.0,
            ),
        ],
        "s2": [
            _FakeRecord(
                {
                    "type": "user",
                    "message": [{"type": "plain", "text": "[来自 主持人]: 我的看法"}],
                },
                99.0,
            ),
            _FakeRecord(
                {"type": "bot", "message": [{"type": "plain", "text": "成员回应"}]},
                103.0,
            ),
        ],
    }

    async def fake_get(**kwargs):
        return histories[kwargs["user_id"]]

    fake_mgr.get.side_effect = fake_get
    client = TestClient(_build_transcript_app(stub, fake_mgr))
    r = client.get("/api/agent_collab/groups/g1/transcript")
    assert r.json()["status"] == "ok"
    msgs = r.json()["data"]["messages"]
    # global chronological order: s2's sent (99) < s1's sent (100) < s1 reply (101) < s2 reply (103)
    assert [m["direction"] for m in msgs] == ["sent", "sent", "reply", "reply"]
    assert msgs[0]["session_id"] == "s2"
    assert msgs[1]["session_id"] == "s1"
    # directive fence stripped from the moderator reply; ordinary chat skipped
    assert "collab-route" not in msgs[2]["text"]
    assert msgs[2]["text"].startswith("我的看法")
    assert all(m["session_id"] in ("s1", "s2") for m in msgs)
    # per-session history requests
    assert fake_mgr.get.call_count == 2


def test_group_transcript_unknown_group_returns_error():
    stub = _StubService()
    client = TestClient(_build_isolated_app(stub))
    r = client.get("/api/agent_collab/groups/nope/transcript")
    assert r.json()["status"] == "error"
