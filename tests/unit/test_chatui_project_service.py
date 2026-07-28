import pytest

from astrbot.dashboard.services.chatui_project_service import (
    ChatUIProjectService,
    ChatUIProjectServiceError,
)


def test_custom_workspace_accepts_existing_directory(tmp_path, monkeypatch):
    """Custom workspace paths should accept existing usable directories."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setattr(
        "astrbot.core.workspace.get_astrbot_workspaces_path",
        lambda: str(tmp_path),
    )

    workspace_type, workspace_path = ChatUIProjectService._normalize_workspace_config(
        {
            "workspace_type": "custom",
            "workspace_path": str(workspace),
        }
    )

    assert workspace_type == "custom"
    assert workspace_path == str(workspace)


def test_custom_workspace_rejects_missing_path(tmp_path, monkeypatch):
    """Custom workspace paths should reject missing directories."""
    monkeypatch.setattr(
        "astrbot.core.workspace.get_astrbot_workspaces_path",
        lambda: str(tmp_path),
    )

    with pytest.raises(ChatUIProjectServiceError, match="does not exist"):
        ChatUIProjectService._normalize_workspace_config(
            {
                "workspace_type": "custom",
                "workspace_path": "missing",
            }
        )


def test_custom_workspace_rejects_file_path(tmp_path, monkeypatch):
    """Custom workspace paths should reject regular files."""
    monkeypatch.setattr(
        "astrbot.core.workspace.get_astrbot_workspaces_path",
        lambda: str(tmp_path),
    )
    file_path = tmp_path / "workspace.txt"
    file_path.write_text("not a directory", encoding="utf-8")

    with pytest.raises(ChatUIProjectServiceError, match="must be a directory"):
        ChatUIProjectService._normalize_workspace_config(
            {
                "workspace_type": "custom",
                "workspace_path": "workspace.txt",
            }
        )


def test_custom_workspace_relative_path_uses_astrbot_workspaces(tmp_path, monkeypatch):
    """Relative custom workspace paths should resolve under AstrBot workspaces."""
    relative_workspace = tmp_path / "relative-workspace"
    relative_workspace.mkdir()
    monkeypatch.setattr(
        "astrbot.core.workspace.get_astrbot_workspaces_path",
        lambda: str(tmp_path),
    )

    workspace_type, workspace_path = ChatUIProjectService._normalize_workspace_config(
        {
            "workspace_type": "custom",
            "workspace_path": "relative-workspace",
        }
    )

    assert workspace_type == "custom"
    assert workspace_path == "relative-workspace"


def test_custom_workspace_rejects_relative_path_traversal(tmp_path, monkeypatch):
    """Relative custom workspace paths must not escape AstrBot workspaces."""
    outside_workspace = tmp_path / "outside"
    workspaces_root = tmp_path / "workspaces"
    outside_workspace.mkdir()
    workspaces_root.mkdir()
    monkeypatch.setattr(
        "astrbot.core.workspace.get_astrbot_workspaces_path",
        lambda: str(workspaces_root),
    )

    with pytest.raises(ChatUIProjectServiceError, match="must stay within"):
        ChatUIProjectService._normalize_workspace_config(
            {
                "workspace_type": "custom",
                "workspace_path": "../outside",
            }
        )


def test_custom_workspace_rejects_workspaces_root(tmp_path, monkeypatch):
    """Custom workspace paths must not expose the entire workspaces root."""
    monkeypatch.setattr(
        "astrbot.core.workspace.get_astrbot_workspaces_path",
        lambda: str(tmp_path),
    )

    with pytest.raises(ChatUIProjectServiceError, match="must stay within"):
        ChatUIProjectService._normalize_workspace_config(
            {
                "workspace_type": "custom",
                "workspace_path": ".",
            }
        )


def test_custom_workspace_accepts_absolute_path_outside_workspaces(
    tmp_path, monkeypatch
):
    """Absolute custom workspace paths may point outside AstrBot workspaces."""
    outside_workspace = tmp_path / "outside"
    workspaces_root = tmp_path / "workspaces"
    outside_workspace.mkdir()
    workspaces_root.mkdir()
    monkeypatch.setattr(
        "astrbot.core.workspace.get_astrbot_workspaces_path",
        lambda: str(workspaces_root),
    )

    workspace_type, workspace_path = ChatUIProjectService._normalize_workspace_config(
        {
            "workspace_type": "custom",
            "workspace_path": str(outside_workspace),
        }
    )

    assert workspace_type == "custom"
    assert workspace_path == str(outside_workspace)


# === spcode integration: workspace_type='project' validation ===


def test_project_workspace_accepts_existing_directory(tmp_path, monkeypatch):
    """Project workspace paths must accept existing usable directories (no os.access check)."""
    repo = tmp_path / "code-repo"
    repo.mkdir()
    monkeypatch.setattr(
        "astrbot.core.workspace.get_astrbot_workspaces_path",
        lambda: str(tmp_path),
    )

    workspace_type, workspace_path = ChatUIProjectService._normalize_workspace_config(
        {
            "workspace_type": "project",
            "workspace_path": str(repo),
        }
    )

    assert workspace_type == "project"
    assert workspace_path == str(repo)


def test_project_workspace_rejects_missing_path(tmp_path, monkeypatch):
    """Project workspace paths must reject non-existent directories."""
    monkeypatch.setattr(
        "astrbot.core.workspace.get_astrbot_workspaces_path",
        lambda: str(tmp_path),
    )

    with pytest.raises(ChatUIProjectServiceError, match="does not exist"):
        ChatUIProjectService._normalize_workspace_config(
            {
                "workspace_type": "project",
                "workspace_path": str(tmp_path / "does-not-exist"),
            }
        )


def test_project_workspace_rejects_file_path(tmp_path, monkeypatch):
    """Project workspace paths must reject regular files (not just missing dirs)."""
    monkeypatch.setattr(
        "astrbot.core.workspace.get_astrbot_workspaces_path",
        lambda: str(tmp_path),
    )
    file_path = tmp_path / "workspace.txt"
    file_path.write_text("not a directory", encoding="utf-8")

    with pytest.raises(ChatUIProjectServiceError, match="must be a directory"):
        ChatUIProjectService._normalize_workspace_config(
            {
                "workspace_type": "project",
                "workspace_path": str(file_path),
            }
        )


def test_project_workspace_rejects_empty_path(tmp_path, monkeypatch):
    """Project workspace requires a non-empty path."""
    monkeypatch.setattr(
        "astrbot.core.workspace.get_astrbot_workspaces_path",
        lambda: str(tmp_path),
    )

    with pytest.raises(ChatUIProjectServiceError, match="requires a path"):
        ChatUIProjectService._normalize_workspace_config(
            {
                "workspace_type": "project",
                "workspace_path": "",
            }
        )


def test_session_workspace_unchanged_by_project_branch(tmp_path, monkeypatch):
    """Session type still clears workspace_path (regression for split branch)."""
    monkeypatch.setattr(
        "astrbot.core.workspace.get_astrbot_workspaces_path",
        lambda: str(tmp_path),
    )

    workspace_type, workspace_path = ChatUIProjectService._normalize_workspace_config(
        {
            "workspace_type": "session",
            "workspace_path": "/should/be/cleared",
        }
    )

    assert workspace_type == "session"
    assert workspace_path is None


# === spcode integration: _serialize_project emits new fields ===


def test_serialize_project_emits_spcode_fields():
    """_serialize_project must include spcode_auto_load / spcode_force / spcode_no_codegraph."""
    from types import SimpleNamespace

    project = SimpleNamespace(
        project_id="p-1",
        creator="alice",
        title="P",
        emoji="📁",
        description=None,
        workspace_type="session",
        workspace_path=None,
        spcode_auto_load=True,
        spcode_force=False,
        spcode_no_codegraph=True,
        created_at=None,
        updated_at=None,
    )

    result = ChatUIProjectService._serialize_project(project)

    assert result["spcode_auto_load"] is True
    assert result["spcode_force"] is False
    assert result["spcode_no_codegraph"] is True


def test_serialize_project_uses_defaults_when_fields_missing():
    """_serialize_project must use safe defaults if spcode_* attributes are absent (old rows)."""
    from types import SimpleNamespace

    project = SimpleNamespace(
        project_id="p-2",
        creator="alice",
        title="Legacy",
        emoji="📁",
        description=None,
        workspace_type="session",
        workspace_path=None,
        # No spcode_* attrs — simulates old DB row before migration
        created_at=None,
        updated_at=None,
    )

    result = ChatUIProjectService._serialize_project(project)

    assert result["spcode_auto_load"] is True  # default
    assert result["spcode_force"] is False  # default
    assert result["spcode_no_codegraph"] is False  # default
