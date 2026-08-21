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


@pytest.fixture()
def client():
    app = FastAPI()
    config_mgr = _StubConfigMgr()
    app.state.core_lifecycle = SimpleNamespace(
        astrbot_config=config_mgr.base,
        astrbot_config_mgr=config_mgr,
    )
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
