import pytest

from astrbot.core import sp
from astrbot.dashboard.services.agent_collab_service import (
    AgentCollabService,
    AgentCollabServiceError,
    default_alias,
)


@pytest.fixture
def service(monkeypatch):
    """AgentCollabService backed by an in-memory sp store."""
    store = {}

    async def get_async(scope, scope_id, key, default=None):
        return store.get(key, default)

    async def put_async(scope, scope_id, key, value):
        store[key] = value

    monkeypatch.setattr(sp, "get_async", get_async)
    monkeypatch.setattr(sp, "put_async", put_async)
    return AgentCollabService()


def _payload(**kw):
    base = {
        "name": "g1",
        "members": [
            {"session_id": "webchat!u!aaaaaaaa11", "alias": "编程agent"},
            {"session_id": "webchat!u!bbbbbbbb22", "alias": "文档agent"},
        ],
        "moderator_session_id": "webchat!u!aaaaaaaa11",
    }
    base.update(kw)
    return base


def test_default_alias():
    assert default_alias("webchat!u!aaaaaaaa11") == "aaaaaa11"


@pytest.mark.asyncio
async def test_create_and_list(service):
    g = await service.create_group("alice", _payload())
    assert g["members"][0]["alias"] == "编程agent"
    groups = (await service.list_groups("alice"))["groups"]
    assert len(groups) == 1 and groups[0]["id"] == g["id"]


@pytest.mark.asyncio
async def test_alias_defaults_to_suffix(service):
    g = await service.create_group(
        "alice",
        _payload(
            members=[
                {"session_id": "webchat!u!aaaaaaaa11"},
                {"session_id": "webchat!u!bbbbbbbb22", "alias": "文档agent"},
            ]
        ),
    )
    assert g["members"][0]["alias"] == "aaaaaa11"


@pytest.mark.asyncio
async def test_create_requires_two_members(service):
    with pytest.raises(AgentCollabServiceError):
        await service.create_group(
            "alice", _payload(members=[{"session_id": "x123456789"}])
        )


@pytest.mark.asyncio
async def test_moderator_must_be_member(service):
    with pytest.raises(AgentCollabServiceError):
        await service.create_group(
            "alice", _payload(moderator_session_id="webchat!u!zzzzzzzz99")
        )


@pytest.mark.asyncio
async def test_alias_must_be_unique(service):
    with pytest.raises(AgentCollabServiceError):
        await service.create_group(
            "alice",
            _payload(
                members=[
                    {"session_id": "webchat!u!aaaaaaaa11", "alias": "same"},
                    {"session_id": "webchat!u!bbbbbbbb22", "alias": " same "},
                ]
            ),
        )


@pytest.mark.asyncio
async def test_suffix_collision_rejected(service):
    with pytest.raises(AgentCollabServiceError):
        await service.create_group(
            "alice",
            _payload(
                members=[
                    {"session_id": "webchat!u!xxaaaaaa11"},
                    {"session_id": "webchat!u!yyaaaaaa11"},
                ]
            ),
        )


@pytest.mark.asyncio
async def test_update_alias_and_moderator(service):
    g = await service.create_group("alice", _payload())
    updated = await service.update_group(
        "alice",
        g["id"],
        {
            "members": [
                {"session_id": "webchat!u!aaaaaaaa11", "alias": "coder"},
                {"session_id": "webchat!u!bbbbbbbb22", "alias": "docs"},
            ],
            "moderator_session_id": "webchat!u!bbbbbbbb22",
        },
    )
    assert updated["moderator_session_id"] == "webchat!u!bbbbbbbb22"


@pytest.mark.asyncio
async def test_delete_group(service):
    g = await service.create_group("alice", _payload())
    await service.delete_group("alice", g["id"])
    assert (await service.list_groups("alice"))["groups"] == []


@pytest.mark.asyncio
async def test_other_user_isolated(service):
    await service.create_group("alice", _payload())
    assert (await service.list_groups("bob"))["groups"] == []
    with pytest.raises(AgentCollabServiceError):
        await service.delete_group("bob", "whatever")


class _FakeRunner:
    def __init__(self, state: dict, group: dict):
        self.state = state
        self.group = group


def test_list_active_discussions_filters_by_status_and_owner():
    service = AgentCollabService()
    group = {
        "id": "g1",
        "owner_username": "alice",
        "members": [{"session_id": "s1", "alias": "a"}],
    }
    running = _FakeRunner(
        {
            "id": "d1",
            "group_id": "g1",
            "topic": "t",
            "status": "running",
            "hop_count": 3,
            "hop_limit": 50,
        },
        group,
    )
    paused = _FakeRunner(
        {
            "id": "d2",
            "group_id": "g1",
            "topic": "t2",
            "status": "paused",
            "hop_count": 1,
            "hop_limit": 50,
        },
        group,
    )
    stopped = _FakeRunner(
        {
            "id": "d3",
            "group_id": "g1",
            "topic": "t3",
            "status": "stopped",
            "hop_count": 9,
            "hop_limit": 50,
        },
        group,
    )
    other_owner = _FakeRunner(
        {
            "id": "d4",
            "group_id": "g1",
            "topic": "t4",
            "status": "running",
            "hop_count": 0,
            "hop_limit": 50,
        },
        {"id": "g1", "owner_username": "bob", "members": []},
    )
    service.discussions = {
        "d1": {"runner": running},
        "d2": {"runner": paused},
        "d3": {"runner": stopped},
        "d4": {"runner": other_owner},
    }
    active = service.list_active_discussions("alice")
    ids = {d["id"] for d in active}
    assert ids == {"d1", "d2"}
    d1 = next(d for d in active if d["id"] == "d1")
    assert d1["status"] == "running" and d1["hop_count"] == 3
