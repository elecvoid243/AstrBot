from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from astrbot.core.tools import fs_access
from astrbot.dashboard.api import chat as chat_api


class _StubConfigMgr:
    """Config-manager stub mirroring AstrBotConfigManager.get_conf fallback."""

    def __init__(self) -> None:
        self.base = {"provider_settings": {"file_access_default_mode": "full"}}
        self.profiles: dict[str, dict] = {}

    def get_conf(self, umo):
        return self.profiles.get(umo, self.base)


class _FakeSp:
    """In-memory SharedPreferences stand-in for fs_access persistence."""

    def __init__(self) -> None:
        self.store: dict[tuple[str, str], object] = {}

    async def session_get(self, umo, key, default=None):
        return self.store.get((umo, key), default)

    async def session_put(self, umo, key, value):
        self.store[(umo, key)] = value


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch):
    app = FastAPI()
    config_mgr = _StubConfigMgr()
    fake_sp = _FakeSp()
    app.state.core_lifecycle = SimpleNamespace(
        astrbot_config=config_mgr.base,
        astrbot_config_mgr=config_mgr,
    )
    app.state._fake_sp = fake_sp
    monkeypatch.setattr(fs_access, "sp", fake_sp)
    app.include_router(chat_api.router)
    app.dependency_overrides[chat_api.require_chat_scope] = lambda: SimpleNamespace(
        username="tester"
    )
    fs_access.reset()
    yield TestClient(app)
    fs_access.reset()


def test_get_returns_effective_mode(client):
    res = client.get("/chat/file-access-mode", params={"umo": "u1"})
    assert res.status_code == 200
    assert res.json()["data"]["mode"] == "full"
    assert res.json()["data"]["default_mode"] == "full"


def test_get_resolves_default_from_umo_config_profile(client):
    config_mgr = client.app.state.core_lifecycle.astrbot_config_mgr
    config_mgr.profiles["u1"] = {
        "provider_settings": {"file_access_default_mode": "workspace"}
    }
    res = client.get("/chat/file-access-mode", params={"umo": "u1"})
    assert res.status_code == 200
    assert res.json()["data"]["mode"] == "workspace"
    assert res.json()["data"]["default_mode"] == "workspace"


def test_post_sets_and_reads_back_with_config_profile(client):
    config_mgr = client.app.state.core_lifecycle.astrbot_config_mgr
    config_mgr.profiles["u1"] = {
        "provider_settings": {"file_access_default_mode": "workspace"}
    }
    res = client.post("/chat/file-access-mode", json={"umo": "u1", "mode": "full"})
    assert res.status_code == 200
    assert res.json()["data"]["mode"] == "full"
    assert res.json()["data"]["default_mode"] == "workspace"

    res = client.get("/chat/file-access-mode", params={"umo": "u1"})
    assert res.json()["data"]["mode"] == "full"
    assert res.json()["data"]["default_mode"] == "workspace"


def test_post_sets_and_reads_back(client):
    res = client.post("/chat/file-access-mode", json={"umo": "u1", "mode": "readonly"})
    assert res.status_code == 200
    assert res.json()["data"]["mode"] == "readonly"

    res = client.get("/chat/file-access-mode", params={"umo": "u1"})
    assert res.json()["data"]["mode"] == "readonly"


def test_post_rejects_invalid_mode(client):
    res = client.post("/chat/file-access-mode", json={"umo": "u1", "mode": "bogus"})
    assert res.status_code == 422


def test_get_returns_fixed_and_custom_roots(client):
    res = client.get("/chat/file-access-mode", params={"umo": "u1"})
    data = res.json()["data"]
    assert [r["kind"] for r in data["fixed_roots"]] == ["workspace", "temp", "temp"]
    assert all(r["path"] for r in data["fixed_roots"])
    assert data["custom_roots"] == []


def test_post_roots_sets_normalizes_and_reads_back(client, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    other = tmp_path / "other"
    other.mkdir()
    res = client.post(
        "/chat/file-access-mode/roots",
        json={"umo": "u1", "roots": [str(repo), "  ", str(repo), str(other)]},
    )
    assert res.status_code == 200
    assert res.json()["data"]["custom_roots"] == [
        str(repo.resolve()),
        str(other.resolve()),
    ]

    res = client.get("/chat/file-access-mode", params={"umo": "u1"})
    assert res.json()["data"]["custom_roots"] == [
        str(repo.resolve()),
        str(other.resolve()),
    ]


def test_custom_roots_survive_in_memory_reset(client, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    client.post(
        "/chat/file-access-mode/roots", json={"umo": "u1", "roots": [str(repo)]}
    )
    # Simulate an in-memory state loss (restart): the cache is cleared but
    # SharedPreferences still holds the persisted list.
    fs_access.reset()
    res = client.get("/chat/file-access-mode", params={"umo": "u1"})
    assert res.json()["data"]["custom_roots"] == [str(repo.resolve())]
