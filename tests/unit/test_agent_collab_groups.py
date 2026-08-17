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
