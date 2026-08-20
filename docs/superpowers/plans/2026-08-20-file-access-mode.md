# File Access Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-state per-conversation file access mode (`full` / `readonly` / `workspace`) enforced inside LLM file/shell tools, with a ChatInput mode-switcher chip; spcode's plan mode is merged into `readonly` with core-owned state.

**Architecture:** Core owns the mode as per-umo in-memory state (`astrbot/core/tools/fs_access.py`), resolved as explicit override → config default. Enforcement is two-layer: request-time tool-visibility filtering (readonly, executed by the spcode plugin's `on_llm_request` hook reading core state) and call-time hard rejection inside each mutating tool (cannot be bypassed by prompts or subagents). The dashboard chip talks to a new core endpoint `GET/POST /api/v1/chat/file-access-mode`.

**Tech Stack:** Python 3.10+ (FastAPI, pytest), Vue 3 + TS (vitest, vue-tsc), two repos: `F:\github\Astrbot` (core + dashboard) and `F:\github\astrbot_plugin_spcode_toolkit` (plugin).

**Spec:** `docs/superpowers/specs/2026-08-20-file-access-mode-design.md`

## Global Constraints

- Spec decisions: default mode `full`; core owns state (plugin derives plan from `mode == readonly`); chip always visible; workspace mode keeps shell usable.
- Python 3.10+ compatible syntax; use `pathlib.Path`; English-only comments/logs; Google-style docstrings for non-obvious functions.
- Before every commit in the AstrBot repo: `uv run ruff format <files>` and `uv run ruff check <files>` must pass.
- Conventional commit messages (`feat(core): ...`, `feat(dashboard): ...`, `test: ...`).
- When backend routes change (Task 5), regenerate the frontend client: `cd dashboard && pnpm generate:api`.
- Do not delete `SpcodePlanModeChip.vue` / `useSpcodePlanMode.ts` / `useSpcodePlanModeLoad.ts` — they still serve the `/plan` command fallback path and stream-parser consumers. Only the chip's slot in `ChatInput.vue` is replaced.
- Tests for the AstrBot repo run with `uv run pytest <paths> -v` from `F:\github\Astrbot`. Plugin tests run with `uv run --project F:/github/Astrbot python -m pytest tests/<file> -v` from `F:\github\astrbot_plugin_spcode_toolkit` (plugin tests import the `tools` package from the plugin root and `astrbot.*` from the AstrBot env).
- Part A+B (AstrBot repo) is independently shippable: before Part C lands, readonly still hard-blocks core write tools at call time; tool-list hiding activates once Part C lands.

---

## Part A — AstrBot core (`F:\github\Astrbot`)

### Task 1: `fs_access` module

**Files:**
- Create: `astrbot/core/tools/fs_access.py`
- Test: `tests/test_fs_access.py`

**Interfaces:**
- Consumes: `context.context.context.get_config(umo=...)` (same access pattern as `astrbot/core/tools/computer_tools/util.py:49`), `context.context.event.unified_msg_origin`.
- Produces (used by Tasks 2, 3, 5, and Part C):
  - `class FileAccessMode(str, Enum)` with `FULL = "full"`, `READONLY = "readonly"`, `WORKSPACE = "workspace"`
  - `resolve_default(cfg: dict) -> FileAccessMode`
  - `get_mode_for_umo(umo: str, *, default: FileAccessMode = FileAccessMode.FULL) -> FileAccessMode`
  - `set_mode_for_umo(umo: str, mode: FileAccessMode) -> None`
  - `restore_writable_for_umo(umo: str, *, default: FileAccessMode) -> FileAccessMode`
  - `clear_mode_for_umo(umo: str) -> None`
  - `count_readonly_overrides() -> int`
  - `reset() -> None`
  - `set_dynamic_roots(umo: str, roots: Sequence[Path | str] | None) -> None`
  - `get_dynamic_roots(umo: str) -> tuple[Path, ...]`
  - `configured_extra_roots(cfg: dict) -> tuple[Path, ...]`
  - `extra_write_roots(context) -> tuple[Path, ...]` (configured + dynamic)
  - `async write_roots(context, *, current_workspace_root: Path | None = None) -> tuple[Path, ...]`
  - `async assert_writable(path: str, context, *, current_workspace_root: Path | None = None) -> None` (raises `PermissionError`)
  - `get_mode(context) -> FileAccessMode`
  - `context` above means `ContextWrapper[AstrAgentContext]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_fs_access.py`:

```python
from __future__ import annotations

import os
from types import SimpleNamespace

import pytest

from astrbot.core.agent.run_context import ContextWrapper
from astrbot.core.tools import fs_access
from astrbot.core.tools.fs_access import FileAccessMode

UMO = "webchat:FriendMessage:webchat!tester!s1"


def _make_context(config: dict | None = None, umo: str = UMO) -> ContextWrapper:
    config_holder = SimpleNamespace(
        get_config=lambda umo=None: config
        or {"provider_settings": {"file_access_default_mode": "full"}}
    )
    event = SimpleNamespace(
        role="admin", unified_msg_origin=umo, get_sender_id=lambda: "tester"
    )
    astr_ctx = SimpleNamespace(context=config_holder, event=event)
    return ContextWrapper(context=astr_ctx)


@pytest.fixture(autouse=True)
def _clean_state():
    fs_access.reset()
    yield
    fs_access.reset()


def test_override_beats_config_default():
    fs_access.set_mode_for_umo(UMO, FileAccessMode.READONLY)
    mode = fs_access.get_mode_for_umo(
        UMO,
        default=fs_access.resolve_default(
            {"provider_settings": {"file_access_default_mode": "workspace"}}
        ),
    )
    assert mode is FileAccessMode.READONLY


def test_get_mode_reads_config_default_via_context():
    context = _make_context(
        {"provider_settings": {"file_access_default_mode": "workspace"}}
    )
    assert fs_access.get_mode(context) is FileAccessMode.WORKSPACE


def test_resolve_default_invalid_value_falls_back_to_full():
    assert (
        fs_access.resolve_default(
            {"provider_settings": {"file_access_default_mode": "bogus"}}
        )
        is FileAccessMode.FULL
    )


def test_restore_writable_returns_last_non_readonly():
    fs_access.set_mode_for_umo(UMO, FileAccessMode.WORKSPACE)
    fs_access.set_mode_for_umo(UMO, FileAccessMode.READONLY)
    restored = fs_access.restore_writable_for_umo(
        UMO, default=FileAccessMode.FULL
    )
    assert restored is FileAccessMode.WORKSPACE


def test_restore_writable_never_restores_readonly():
    fs_access.set_mode_for_umo(UMO, FileAccessMode.READONLY)
    restored = fs_access.restore_writable_for_umo(
        UMO, default=FileAccessMode.READONLY
    )
    assert restored is FileAccessMode.FULL


def test_count_readonly_overrides_and_clear():
    fs_access.set_mode_for_umo("u1", FileAccessMode.READONLY)
    fs_access.set_mode_for_umo("u2", FileAccessMode.WORKSPACE)
    assert fs_access.count_readonly_overrides() == 1
    fs_access.clear_mode_for_umo("u1")
    assert fs_access.count_readonly_overrides() == 0


def test_dynamic_roots_set_and_clear(tmp_path):
    fs_access.set_dynamic_roots(UMO, [tmp_path])
    assert fs_access.get_dynamic_roots(UMO) == (tmp_path,)
    fs_access.set_dynamic_roots(UMO, None)
    assert fs_access.get_dynamic_roots(UMO) == ()


def test_extra_write_roots_combines_config_and_dynamic(tmp_path):
    other = tmp_path / "other"
    other.mkdir()
    context = _make_context(
        {"provider_settings": {"file_access_extra_roots": [str(other)]}}
    )
    fs_access.set_dynamic_roots(UMO, [tmp_path])
    roots = fs_access.extra_write_roots(context)
    assert other in roots
    assert tmp_path in roots


@pytest.mark.asyncio
async def test_assert_writable_full_is_noop(tmp_path):
    await fs_access.assert_writable(str(tmp_path / "anywhere.txt"), _make_context())


@pytest.mark.asyncio
async def test_assert_writable_readonly_rejects(tmp_path):
    fs_access.set_mode_for_umo(UMO, FileAccessMode.READONLY)
    with pytest.raises(PermissionError):
        await fs_access.assert_writable(
            str(tmp_path / "a.txt"), _make_context(), current_workspace_root=tmp_path
        )


@pytest.mark.asyncio
async def test_assert_writable_workspace_blocks_outside(tmp_path):
    fs_access.set_mode_for_umo(UMO, FileAccessMode.WORKSPACE)
    ws = tmp_path / "ws"
    ws.mkdir()
    # Inside the workspace root passes.
    await fs_access.assert_writable(
        str(ws / "a.txt"), _make_context(), current_workspace_root=ws
    )
    # Outside fails.
    with pytest.raises(PermissionError):
        await fs_access.assert_writable(
            str(tmp_path / "outside.txt"),
            _make_context(),
            current_workspace_root=ws,
        )


@pytest.mark.asyncio
async def test_assert_writable_workspace_allows_dynamic_roots(tmp_path):
    fs_access.set_mode_for_umo(UMO, FileAccessMode.WORKSPACE)
    wt = tmp_path / "worktree"
    wt.mkdir()
    fs_access.set_dynamic_roots(UMO, [wt])
    await fs_access.assert_writable(str(wt / "main.py"), _make_context())


@pytest.mark.asyncio
@pytest.mark.skipif(os.name != "nt", reason="case-insensitive paths are Windows-only")
async def test_assert_writable_windows_case_insensitive(tmp_path):
    fs_access.set_mode_for_umo(UMO, FileAccessMode.WORKSPACE)
    ws = tmp_path / "MyWorkspace"
    ws.mkdir()
    context = _make_context()
    await fs_access.assert_writable(
        str(tmp_path / "myworkspace" / "a.txt"),
        context,
        current_workspace_root=ws,
    )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_fs_access.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'astrbot.core.tools.fs_access'` (collection error).

- [ ] **Step 3: Implement the module**

Create `astrbot/core/tools/fs_access.py`:

```python
"""Per-conversation file access mode for LLM file tools.

Three modes (docs/superpowers/specs/2026-08-20-file-access-mode-design.md):
- full: status quo — admins are unrestricted.
- readonly: all writes rejected (the spcode "plan" mode merges here).
- workspace: writes restricted to the session workspace, temp dirs,
  configured extra roots, and plugin-registered dynamic roots.

State is process-local and per-umo; it resets to the config default on
restart. The mode is enforced at tool-call time (see computer_tools/fs.py
and shell.py) so it also covers subagent tool calls.
"""

from __future__ import annotations

import os
from enum import Enum
from pathlib import Path
from typing import TYPE_CHECKING, Sequence

from astrbot.core.utils.astrbot_path import (
    get_astrbot_system_tmp_path,
    get_astrbot_temp_path,
)

if TYPE_CHECKING:
    from astrbot.core.agent.run_context import ContextWrapper
    from astrbot.core.astr_agent_context import AstrAgentContext

    ToolContext = ContextWrapper[AstrAgentContext]


class FileAccessMode(str, Enum):
    FULL = "full"
    READONLY = "readonly"
    WORKSPACE = "workspace"


_mode_overrides: dict[str, FileAccessMode] = {}
_last_writable: dict[str, FileAccessMode] = {}
_dynamic_roots: dict[str, tuple[Path, ...]] = {}


def resolve_default(cfg: dict) -> FileAccessMode:
    """Map a config dict to the default file access mode.

    Args:
        cfg: A full config dict (or AstrBotConfig); unknown values fall
            back to FULL for backward compatibility.

    Returns:
        The configured default mode.
    """
    provider_settings = (cfg or {}).get("provider_settings", {})
    try:
        return FileAccessMode(
            str(provider_settings.get("file_access_default_mode", "full"))
        )
    except ValueError:
        return FileAccessMode.FULL


def get_mode_for_umo(
    umo: str, *, default: FileAccessMode = FileAccessMode.FULL
) -> FileAccessMode:
    """Return the effective mode: explicit override, else the given default."""
    override = _mode_overrides.get(umo)
    return override if override is not None else default


def set_mode_for_umo(umo: str, mode: FileAccessMode) -> None:
    """Set the explicit per-umo mode, remembering the last writable one."""
    if mode is not FileAccessMode.READONLY:
        _last_writable[umo] = mode
    _mode_overrides[umo] = mode


def restore_writable_for_umo(umo: str, *, default: FileAccessMode) -> FileAccessMode:
    """Leave readonly mode, restoring the last writable mode (never readonly)."""
    mode = _last_writable.get(umo, default)
    if mode is FileAccessMode.READONLY:
        mode = (
            default if default is not FileAccessMode.READONLY else FileAccessMode.FULL
        )
    _mode_overrides[umo] = mode
    return mode


def clear_mode_for_umo(umo: str) -> None:
    """Drop the explicit override (falls back to the config default)."""
    _mode_overrides.pop(umo, None)
    _last_writable.pop(umo, None)


def count_readonly_overrides() -> int:
    """Count umos whose explicit override is readonly."""
    return sum(1 for m in _mode_overrides.values() if m is FileAccessMode.READONLY)


def reset() -> None:
    """Clear all state (test fixture / shutdown)."""
    _mode_overrides.clear()
    _last_writable.clear()
    _dynamic_roots.clear()


def set_dynamic_roots(umo: str, roots: Sequence[Path | str] | None) -> None:
    """Register per-umo extra writable roots (e.g. the active git worktree).

    Args:
        umo: Unified message origin.
        roots: Absolute roots to allow, or None/empty to clear.
    """
    if not roots:
        _dynamic_roots.pop(umo, None)
        return
    _dynamic_roots[umo] = tuple(
        Path(r).expanduser().resolve(strict=False) for r in roots
    )


def get_dynamic_roots(umo: str) -> tuple[Path, ...]:
    return _dynamic_roots.get(umo, ())


def configured_extra_roots(cfg: dict) -> tuple[Path, ...]:
    """Read provider_settings.file_access_extra_roots from a config dict."""
    raw = (cfg or {}).get("provider_settings", {}).get("file_access_extra_roots") or []
    roots: list[Path] = []
    for item in raw:
        text = str(item).strip()
        if text:
            roots.append(Path(text).expanduser().resolve(strict=False))
    return tuple(roots)


def _config_for(context: "ToolContext") -> dict:
    cfg = context.context.context.get_config(
        umo=context.context.event.unified_msg_origin
    )
    return cfg if isinstance(cfg, dict) else {}


def get_mode(context: "ToolContext") -> FileAccessMode:
    """Resolve the effective mode for a tool-call context."""
    override = _mode_overrides.get(context.context.event.unified_msg_origin)
    if override is not None:
        return override
    return resolve_default(_config_for(context))


def extra_write_roots(context: "ToolContext") -> tuple[Path, ...]:
    """Configured extra roots plus plugin dynamic roots for this context."""
    return (
        configured_extra_roots(_config_for(context))
        + get_dynamic_roots(context.context.event.unified_msg_origin)
    )


async def write_roots(
    context: "ToolContext",
    *,
    current_workspace_root: Path | None = None,
) -> tuple[Path, ...]:
    """All roots writable in workspace mode for this context."""
    # Lazy import: computer_tools.__init__ pulls in fs.py, which imports this
    # module — a top-level import would be circular.
    from .computer_tools.util import workspace_root_for_context

    root = current_workspace_root or await workspace_root_for_context(context)
    return (
        Path(root).resolve(strict=False),
        Path(get_astrbot_system_tmp_path()).resolve(strict=False),
        Path(get_astrbot_temp_path()).resolve(strict=False),
        *extra_write_roots(context),
    )


def _is_within(path: Path, roots: tuple[Path, ...]) -> bool:
    """Case-insensitive (Windows) containment check after normalization."""
    candidate = Path(os.path.normcase(str(path)))
    for root in roots:
        normalized = Path(os.path.normcase(str(root)))
        if candidate == normalized or candidate.is_relative_to(normalized):
            return True
    return False


async def assert_writable(
    path: str,
    context: "ToolContext",
    *,
    current_workspace_root: Path | None = None,
) -> None:
    """Raise PermissionError when `path` may not be written under the mode.

    Args:
        path: Target path (absolute, or relative to the workspace root).
        context: Tool-call context used to resolve mode and roots.
        current_workspace_root: Pre-resolved workspace root, if known.

    Raises:
        PermissionError: In readonly mode, or in workspace mode when the
            path is outside all writable roots.
    """
    mode = get_mode(context)
    if mode is FileAccessMode.FULL:
        return
    resolved = Path(path).expanduser().resolve(strict=False)
    if mode is FileAccessMode.READONLY:
        raise PermissionError(
            "Write access is disabled: this conversation is in readonly "
            f"(plan) file access mode. Blocked path: {resolved}."
        )
    if not resolved.is_absolute() or not Path(path).is_absolute():
        from .computer_tools.util import workspace_root_for_context

        root = current_workspace_root or await workspace_root_for_context(context)
        resolved = (root / resolved).resolve(strict=False)
    roots = await write_roots(context, current_workspace_root=current_workspace_root)
    if not _is_within(resolved, roots):
        allowed = ", ".join(sorted(str(r) for r in roots))
        raise PermissionError(
            "Write access is restricted to the workspace whitelist. "
            f"Allowed directories: {allowed}. Blocked path: {resolved}."
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_fs_access.py -v`
Expected: PASS (13 tests; the Windows-only test is skipped on non-Windows, runs here on win32).

- [ ] **Step 5: Lint and commit**

```bash
uv run ruff format astrbot/core/tools/fs_access.py tests/test_fs_access.py
uv run ruff check astrbot/core/tools/fs_access.py tests/test_fs_access.py
git add astrbot/core/tools/fs_access.py tests/test_fs_access.py
git commit -m "feat(core): add per-conversation file access mode state module"
```

---

### Task 2: Enforce the mode in the builtin file tools

**Files:**
- Modify: `astrbot/core/tools/computer_tools/fs.py` (module docstring; `_write_allowed_roots` at ~line 161; `_is_path_within_allowed_roots` at ~line 223; `_normalize_rw_path` at ~line 261; `FileWriteTool.call` at ~line 436; `FileEditTool.call` at ~line 695)
- Test: `tests/test_computer_fs_tools.py` (existing `_make_context` helper at line 22; append new tests)

**Interfaces:**
- Consumes: `fs_access.get_mode`, `fs_access.FileAccessMode`, `fs_access.extra_write_roots` (Task 1).
- Produces: readonly → `FileWriteTool`/`FileEditTool` return an error string before any filesystem access (both local and sandbox runtimes); workspace → write paths restricted to workspace+temp+extra+dynamic roots even for admins; read tools (`FileReadTool`, `GrepTool`) unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/test_computer_fs_tools.py`, extend `_make_context` with a `file_access_default_mode` parameter (keep the default `"full"` so existing tests are untouched):

```python
def _make_context(
    *,
    require_admin: bool = True,
    role: str = "admin",
    runtime: str = "local",
    umo: str = "qq:friend:user-1",
    file_access_default_mode: str = "full",
) -> ContextWrapper:
    config_holder = SimpleNamespace(
        get_config=lambda umo=None: {
            "provider_settings": {
                "computer_use_require_admin": require_admin,
                "computer_use_runtime": runtime,
                "file_access_default_mode": file_access_default_mode,
            }
        }
    )
```

(the rest of the helper body stays identical). Append these tests at the end of the file:

```python
@pytest.mark.asyncio
async def test_file_write_tool_blocked_in_readonly_mode(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
):
    from astrbot.core.tools import fs_access

    umo = "webchat:FriendMessage:webchat!tester!s1"
    fs_access.set_mode_for_umo(umo, fs_access.FileAccessMode.READONLY)
    try:
        context = _make_context(umo=umo)
        booter = SimpleNamespace(
            fs=SimpleNamespace(write_file=AsyncMock(return_value={"success": True}))
        )
        monkeypatch.setattr(fs_tools, "get_booter", AsyncMock(return_value=booter))
        result = await fs_tools.FileWriteTool().call(
            context, path=str(tmp_path / "a.txt"), content="x"
        )
        assert result.startswith("Error:")
        assert "readonly" in result
        booter.fs.write_file.assert_not_awaited()
    finally:
        fs_access.reset()


@pytest.mark.asyncio
async def test_file_edit_tool_blocked_in_readonly_mode(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
):
    from astrbot.core.tools import fs_access

    umo = "webchat:FriendMessage:webchat!tester!s1"
    fs_access.set_mode_for_umo(umo, fs_access.FileAccessMode.READONLY)
    try:
        context = _make_context(umo=umo)
        monkeypatch.setattr(fs_tools, "get_booter", AsyncMock())
        result = await fs_tools.FileEditTool().call(
            context, path=str(tmp_path / "a.txt"), old="a", new="b"
        )
        assert result.startswith("Error:")
        assert "readonly" in result
    finally:
        fs_access.reset()


@pytest.mark.asyncio
async def test_file_write_tool_workspace_mode_restricts_admin(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
):
    from astrbot.core.tools import fs_access

    umo = "webchat:FriendMessage:webchat!tester!s1"
    fs_access.set_mode_for_umo(umo, fs_access.FileAccessMode.WORKSPACE)
    try:
        ws = tmp_path / "ws"
        ws.mkdir()

        async def _fake_root(_ctx):
            return ws

        monkeypatch.setattr(fs_tools, "workspace_root_for_context", _fake_root)
        booter = SimpleNamespace(
            fs=SimpleNamespace(write_file=AsyncMock(return_value={"success": True}))
        )
        monkeypatch.setattr(fs_tools, "get_booter", AsyncMock(return_value=booter))
        context = _make_context(umo=umo, role="admin")

        ok_result = await fs_tools.FileWriteTool().call(
            context, path=str(ws / "inside.txt"), content="x"
        )
        assert ok_result.startswith("File written successfully")

        blocked = await fs_tools.FileWriteTool().call(
            context, path=str(tmp_path / "outside.txt"), content="x"
        )
        assert blocked.startswith("Error:")
        assert "Allowed directories" in blocked
    finally:
        fs_access.reset()


@pytest.mark.asyncio
async def test_file_write_tool_workspace_mode_honors_dynamic_roots(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
):
    from astrbot.core.tools import fs_access

    umo = "webchat:FriendMessage:webchat!tester!s1"
    fs_access.set_mode_for_umo(umo, fs_access.FileAccessMode.WORKSPACE)
    wt = tmp_path / "worktree"
    wt.mkdir()
    fs_access.set_dynamic_roots(umo, [wt])
    try:
        async def _fake_root(_ctx):
            return tmp_path / "ws"

        monkeypatch.setattr(fs_tools, "workspace_root_for_context", _fake_root)
        booter = SimpleNamespace(
            fs=SimpleNamespace(write_file=AsyncMock(return_value={"success": True}))
        )
        monkeypatch.setattr(fs_tools, "get_booter", AsyncMock(return_value=booter))
        context = _make_context(umo=umo, role="admin")
        result = await fs_tools.FileWriteTool().call(
            context, path=str(wt / "main.py"), content="x"
        )
        assert result.startswith("File written successfully")
    finally:
        fs_access.reset()


@pytest.mark.asyncio
async def test_file_read_tool_unaffected_by_readonly_mode(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
):
    from astrbot.core.tools import fs_access

    umo = "webchat:FriendMessage:webchat!tester!s1"
    fs_access.set_mode_for_umo(umo, fs_access.FileAccessMode.READONLY)
    try:
        target = tmp_path / "readable.txt"
        target.write_text("hello", encoding="utf-8")

        async def _fake_root(_ctx):
            return tmp_path

        monkeypatch.setattr(fs_tools, "workspace_root_for_context", _fake_root)
        monkeypatch.setattr(
            fs_tools,
            "read_file_tool_result",
            AsyncMock(return_value="hello"),
        )
        monkeypatch.setattr(fs_tools, "get_booter", AsyncMock())
        context = _make_context(umo=umo)
        result = await fs_tools.FileReadTool().call(context, path=str(target))
        assert result == "hello"
    finally:
        fs_access.reset()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_computer_fs_tools.py -v -k "file_write_tool or file_edit_tool or file_read_tool_unaffected"`
Expected: the four new enforcement tests FAIL (writes currently succeed / error text missing); the read test PASSES (documents unchanged behavior).

- [ ] **Step 3: Implement the fs.py changes**

3a. Add the import after the existing `from ..registry import builtin_tool` (line 62):

```python
from astrbot.core.tools import fs_access
```

3b. Extend the module docstring (after line 30, the `computer_use_require_admin` paragraph) with:

```
File access mode (provider_settings.file_access_default_mode + per-session
override via the dashboard): readonly rejects all writes (merged "plan"
mode); workspace restricts writes to the workspace whitelist (workspace,
temp dirs, configured extra roots, plugin dynamic roots) even for admins.
Reads are never restricted by the mode.
```

3c. Replace `_write_allowed_roots` (lines 161-170) with:

```python
def _write_allowed_roots(
    umo: str,
    current_workspace_root: Path | None = None,
    extra_roots: tuple[Path, ...] = (),
) -> tuple[Path, ...]:
    """Non-admin users can modify only workspace and temporary files."""
    return (
        current_workspace_root or _workspace_root(umo),
        Path(get_astrbot_system_tmp_path()).resolve(strict=False),
        Path(get_astrbot_temp_path()).resolve(strict=False),
        *extra_roots,
    )
```

3d. Replace `_is_path_within_allowed_roots` (lines 223-239) with a case-insensitive version:

```python
def _is_path_within_allowed_roots(
    path: str,
    *,
    umo: str,
    allowed_roots: tuple[Path, ...],
    current_workspace_root: Path | None = None,
) -> bool:
    resolved = _resolve_user_path(
        path,
        local_env=True,
        umo=umo,
        current_workspace_root=current_workspace_root,
    )
    candidate = Path(os.path.normcase(str(resolved)))
    for allowed_root in allowed_roots:
        normalized_root = Path(os.path.normcase(str(allowed_root)))
        if candidate == normalized_root or candidate.is_relative_to(normalized_root):
            return True
    return False
```

3e. In `_normalize_rw_path` (line 261), add a keyword parameter `extra_write_roots: tuple[Path, ...] = ()` after `current_workspace_root`, and change the allowed-roots block (lines 278-283) to:

```python
    if restricted:
        allowed_roots = (
            _write_allowed_roots(
                umo, current_workspace_root, tuple(extra_write_roots)
            )
            if write
            else (
                _read_allowed_roots(umo, current_workspace_root)
                + tuple(extra_write_roots)
            )
        )
```

3f. Add a write-guard helper right after `_is_restricted_env` (line 181):

```python
_READONLY_WRITE_ERROR = (
    "Error: Write access is disabled — this conversation is in readonly "
    "(plan) file access mode. Ask the user to switch the file access mode "
    "before modifying files."
)


def _write_guard(
    context: ContextWrapper[AstrAgentContext],
) -> tuple[bool, tuple[Path, ...]]:
    """Return (restricted, extra_write_roots) for a write under the mode.

    Args:
        context: Tool-call context.

    Returns:
        restricted: True when the write must pass the allowed-roots check.
        extra_write_roots: Mode-configured roots to append to the allow list.
    """
    if fs_access.get_mode(context) is fs_access.FileAccessMode.WORKSPACE:
        return True, fs_access.extra_write_roots(context)
    return _is_restricted_env(context), ()
```

3g. In `FileWriteTool.call` (line 436), insert the readonly gate as the first statement of the method body, and switch `restricted` to the guard:

```python
    async def call(
        self,
        context: ContextWrapper[AstrAgentContext],
        path: str,
        content: str,
    ) -> ToolExecResult:
        if fs_access.get_mode(context) is fs_access.FileAccessMode.READONLY:
            return _READONLY_WRITE_ERROR
        local_env = is_local_runtime(context)
        restricted, extra_write_roots = _write_guard(context)
```

and add `extra_write_roots=extra_write_roots` to the `_normalize_rw_path(...)` call (lines 448-456):

```python
            normalized_path = (
                _normalize_rw_path(
                    path,
                    restricted=restricted,
                    local_env=local_env,
                    umo=context.context.event.unified_msg_origin,
                    write=True,
                    current_workspace_root=current_workspace_root,
                    extra_write_roots=extra_write_roots,
                )
                if local_env
                else path.strip()
            )
```

3h. Apply the same two changes to `FileEditTool.call` (line 695): insert the readonly gate after the signature (before `umo = ...`), change `restricted = _is_restricted_env(context)` (line 708) to `restricted, extra_write_roots = _write_guard(context)`, and add `extra_write_roots=extra_write_roots` to its `_normalize_rw_path(...)` call (lines 716-723). Readonly blocks the whole edit tool (including history listing/rollback) — the tool is also hidden by the plugin filter, this is the hard fallback.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_computer_fs_tools.py -v`
Expected: PASS (all new tests plus all pre-existing fs tool tests — non-admin restricted behavior is unchanged).

- [ ] **Step 5: Lint and commit**

```bash
uv run ruff format astrbot/core/tools/computer_tools/fs.py tests/test_computer_fs_tools.py
uv run ruff check astrbot/core/tools/computer_tools/fs.py tests/test_computer_fs_tools.py
git add astrbot/core/tools/computer_tools/fs.py tests/test_computer_fs_tools.py
git commit -m "feat(core): enforce file access mode in builtin write/edit tools"
```

---

### Task 3: Readonly gate for shell tools

**Files:**
- Modify: `astrbot/core/tools/computer_tools/shell.py` (`ExecuteShellTool.call` at line 93, `ShellSessionTool.call` at line 315)
- Test: `tests/test_computer_fs_tools.py` (append; shell tool tests live fine next to the fs ones) — or a new `tests/test_computer_shell_tools.py` if you prefer isolation; the code below appends to the existing file.

**Interfaces:**
- Consumes: `fs_access.get_mode`, `fs_access.FileAccessMode` (Task 1).
- Produces: readonly → both shell tools return an error string before executing anything. Workspace/full → unchanged (shell stays usable per spec decision #4).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_computer_fs_tools.py`:

```python
@pytest.mark.asyncio
async def test_execute_shell_blocked_in_readonly_mode(
    monkeypatch: pytest.MonkeyPatch,
):
    from astrbot.core.tools import fs_access
    from astrbot.core.tools.computer_tools import shell as shell_tools

    umo = "webchat:FriendMessage:webchat!tester!s1"
    fs_access.set_mode_for_umo(umo, fs_access.FileAccessMode.READONLY)
    try:
        context = _make_context(umo=umo)
        monkeypatch.setattr(shell_tools, "get_booter", AsyncMock())
        result = await shell_tools.ExecuteShellTool().call(
            context, command="echo hi"
        )
        assert isinstance(result, str)
        assert result.startswith("Error:")
        assert "readonly" in result
    finally:
        fs_access.reset()


@pytest.mark.asyncio
async def test_shell_session_blocked_in_readonly_mode(
    monkeypatch: pytest.MonkeyPatch,
):
    from astrbot.core.tools import fs_access
    from astrbot.core.tools.computer_tools import shell as shell_tools

    umo = "webchat:FriendMessage:webchat!tester!s1"
    fs_access.set_mode_for_umo(umo, fs_access.FileAccessMode.READONLY)
    try:
        context = _make_context(umo=umo)
        monkeypatch.setattr(shell_tools, "get_booter", AsyncMock())
        result = await shell_tools.ShellSessionTool().call(
            context, action="list"
        )
        assert isinstance(result, str)
        assert result.startswith("Error:")
        assert "readonly" in result
    finally:
        fs_access.reset()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_computer_fs_tools.py -v -k "shell"`
Expected: both FAIL (commands currently proceed past the admin check).

- [ ] **Step 3: Implement the gates**

In `shell.py`, add the import next to the other `astrbot.core.*` imports at the top of the file:

```python
from astrbot.core.tools import fs_access
```

In `ExecuteShellTool.call` (line 93), insert directly after the `check_admin_permission` block (after line 103):

```python
        if fs_access.get_mode(context) is fs_access.FileAccessMode.READONLY:
            return (
                "Error: Shell execution is disabled — this conversation is "
                "in readonly (plan) file access mode."
            )
```

In `ShellSessionTool.call` (line 315), insert directly after its `check_admin_permission` block (after line 343):

```python
        if fs_access.get_mode(context) is fs_access.FileAccessMode.READONLY:
            return (
                "Error: Shell sessions are disabled — this conversation is "
                "in readonly (plan) file access mode."
            )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_computer_fs_tools.py -v`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
uv run ruff format astrbot/core/tools/computer_tools/shell.py tests/test_computer_fs_tools.py
uv run ruff check astrbot/core/tools/computer_tools/shell.py tests/test_computer_fs_tools.py
git add astrbot/core/tools/computer_tools/shell.py tests/test_computer_fs_tools.py
git commit -m "feat(core): disable shell tools in readonly file access mode"
```

---

### Task 4: Config keys + WebUI metadata

**Files:**
- Modify: `astrbot/core/config/default.py` (provider_settings defaults at line 184; `agent_computer_use` metadata block starting line 3554)
- Test: `tests/test_fs_access.py` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `provider_settings.file_access_default_mode` (default `"full"`), `provider_settings.file_access_extra_roots` (default `[]`), surfaced on the WebUI config page.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_fs_access.py`:

```python
def test_default_config_contains_file_access_keys():
    from astrbot.core.config.default import DEFAULT_CONFIG

    provider_settings = DEFAULT_CONFIG["provider_settings"]
    assert provider_settings["file_access_default_mode"] == "full"
    assert provider_settings["file_access_extra_roots"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_fs_access.py::test_default_config_contains_file_access_keys -v`
Expected: FAIL with `KeyError: 'file_access_default_mode'`.

- [ ] **Step 3: Add the config keys and metadata**

In `default.py`, after line 184 (`"computer_use_require_admin": True,`) insert:

```python
        "file_access_default_mode": "full",
        "file_access_extra_roots": [],
```

In the `agent_computer_use` metadata `items` (line 3558+), after the `provider_settings.computer_use_require_admin` entry (ends line 3570), insert:

```python
                    "provider_settings.file_access_default_mode": {
                        "description": "默认文件访问模式",
                        "type": "string",
                        "options": ["full", "readonly", "workspace"],
                        "labels": ["完全访问", "只读(Plan)", "工作区白名单"],
                        "hint": "会话未显式选择模式时的默认值。readonly 即 plan 模式（禁止一切写入）；workspace 仅允许在会话工作区与白名单目录内写入。聊天输入框的模式切换按会话覆盖此默认值。",
                    },
                    "provider_settings.file_access_extra_roots": {
                        "description": "工作区模式额外白名单目录",
                        "type": "list",
                        "item": {
                            "type": "string",
                        },
                        "hint": "文件访问模式为 workspace 时，除会话工作区与临时目录外额外允许写入的绝对路径列表。",
                    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_fs_access.py -v`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
uv run ruff format astrbot/core/config/default.py tests/test_fs_access.py
uv run ruff check astrbot/core/config/default.py tests/test_fs_access.py
git add astrbot/core/config/default.py tests/test_fs_access.py
git commit -m "feat(core): add file access mode config keys and webui metadata"
```

---

### Task 5: Dashboard API endpoint

**Files:**
- Modify: `astrbot/dashboard/schemas.py` (add request model near `ChatSessionPatchRequest`)
- Modify: `astrbot/dashboard/api/chat.py` (add routes near `create_chat_session`, line 114)
- Modify: `openspec/openapi-v1.yaml` (add path block near `/api/v1/chat/sessions/new` at line 1239)
- Test: `tests/test_file_access_mode_route.py` (new)

**Interfaces:**
- Consumes: `fs_access.resolve_default/get_mode_for_umo/set_mode_for_umo` (Task 1); `request.app.state.core_lifecycle.astrbot_config` (set at `astrbot/dashboard/api/app.py:105`).
- Produces:
  - `GET /api/v1/chat/file-access-mode?umo=<umo>` → `ok({"umo", "mode", "default_mode"})`
  - `POST /api/v1/chat/file-access-mode` body `{"umo": str, "mode": "full"|"readonly"|"workspace"}` → same shape
  - Generated client functions `openApiV1.getFileAccessMode({ query: { umo } })` / `openApiV1.setFileAccessMode({ body: {...} })` (consumed by Task 6).

- [ ] **Step 1: Write the failing route test**

Create `tests/test_file_access_mode_route.py`:

```python
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from astrbot.core.tools import fs_access
from astrbot.dashboard.api import chat as chat_api


@pytest.fixture()
def client():
    app = FastAPI()
    app.state.core_lifecycle = SimpleNamespace(
        astrbot_config={"provider_settings": {"file_access_default_mode": "full"}}
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


def test_post_sets_and_reads_back(client):
    res = client.post(
        "/chat/file-access-mode", json={"umo": "u1", "mode": "readonly"}
    )
    assert res.status_code == 200
    assert res.json()["data"]["mode"] == "readonly"

    res = client.get("/chat/file-access-mode", params={"umo": "u1"})
    assert res.json()["data"]["mode"] == "readonly"


def test_post_rejects_invalid_mode(client):
    res = client.post(
        "/chat/file-access-mode", json={"umo": "u1", "mode": "bogus"}
    )
    assert res.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_file_access_mode_route.py -v`
Expected: FAIL with 404 Not Found on all three (routes don't exist).

- [ ] **Step 3: Implement schema, routes, and yaml**

In `astrbot/dashboard/schemas.py` (`Literal` is already imported at line 3), add near the other `Chat*Request` models:

```python
class FileAccessModeSetRequest(OpenModel):
    umo: str
    mode: Literal["full", "readonly", "workspace"]
```

In `astrbot/dashboard/api/chat.py`:
- Add `FileAccessModeSetRequest` to the `from astrbot.dashboard.schemas import (...)` block (line 14).
- Add `from astrbot.core.tools import fs_access` to the imports.
- Add the routes directly above `create_chat_session` (line 114):

```python
@router.get("/chat/file-access-mode")
async def get_file_access_mode(
    request: Request,
    umo: str = Query(...),
    auth: AuthContext = Depends(require_chat_scope),
):
    default = fs_access.resolve_default(request.app.state.core_lifecycle.astrbot_config)
    mode = fs_access.get_mode_for_umo(umo, default=default)
    return ok({"umo": umo, "mode": mode.value, "default_mode": default.value})


@router.post("/chat/file-access-mode")
async def set_file_access_mode(
    payload: FileAccessModeSetRequest,
    request: Request,
    auth: AuthContext = Depends(require_chat_scope),
):
    default = fs_access.resolve_default(request.app.state.core_lifecycle.astrbot_config)
    fs_access.set_mode_for_umo(payload.umo, fs_access.FileAccessMode(payload.mode))
    mode = fs_access.get_mode_for_umo(payload.umo, default=default)
    return ok(
        {"umo": payload.umo, "mode": mode.value, "default_mode": default.value}
    )
```

In `openspec/openapi-v1.yaml`, insert before `  /api/v1/chat/sessions/new:` (line 1239):

```yaml
  /api/v1/chat/file-access-mode:
    get:
      tags: [Chat]
      summary: Get the effective file access mode for a session
      operationId: getFileAccessMode
      x-astrbot-scope: chat
      parameters:
        - name: umo
          in: query
          required: true
          schema:
            type: string
      responses:
        "200":
          $ref: "#/components/responses/Ok"
    post:
      tags: [Chat]
      summary: Set the file access mode for a session
      operationId: setFileAccessMode
      x-astrbot-scope: chat
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [umo, mode]
              properties:
                umo:
                  type: string
                mode:
                  type: string
                  enum: [full, readonly, workspace]
      responses:
        "200":
          $ref: "#/components/responses/Ok"

```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_file_access_mode_route.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Regenerate the frontend API client**

Run: `cd dashboard && pnpm generate:api`
Expected: command exits 0; `dashboard/src/api/generated/openapi-v1/sdk.gen.ts` contains `getFileAccessMode` and `setFileAccessMode`. Also run `cd dashboard && pnpm typecheck` — expected: exit 0.

- [ ] **Step 6: Lint and commit**

```bash
uv run ruff format astrbot/dashboard/schemas.py astrbot/dashboard/api/chat.py tests/test_file_access_mode_route.py
uv run ruff check astrbot/dashboard/schemas.py astrbot/dashboard/api/chat.py tests/test_file_access_mode_route.py
git add astrbot/dashboard/schemas.py astrbot/dashboard/api/chat.py tests/test_file_access_mode_route.py openspec/openapi-v1.yaml dashboard/src/api/generated
git commit -m "feat(dashboard): add file access mode get/set endpoint"
```

---

## Part B — Dashboard frontend (`F:\github\Astrbot\dashboard`)

### Task 6: `useFileAccessMode` composable + API wrapper

**Files:**
- Modify: `dashboard/src/api/v1.ts` (add `fileAccessApi` near the chat API section)
- Create: `dashboard/src/composables/useFileAccessMode.ts`

**Interfaces:**
- Consumes: generated client `openApiV1.getFileAccessMode/setFileAccessMode` (Task 5); response envelope `{ status, data: { umo, mode, default_mode } }`.
- Produces (consumed by Task 7 and `Chat.vue`):
  - `type FileAccessMode = 'full' | 'readonly' | 'workspace'`
  - `useFileAccessMode()` → `{ status, refresh, setMode, setOptimistic, reset }` where `status` is `Ref<{ mode: FileAccessMode | null; defaultMode: FileAccessMode | null }>`.

- [ ] **Step 1: Add the API wrapper**

In `dashboard/src/api/v1.ts`, add next to the other API objects (e.g. right before `pluginExtensionApi` at line 1447):

```ts
export type FileAccessModeValue = 'full' | 'readonly' | 'workspace'

export interface FileAccessModeStatusData {
  umo: string
  mode: FileAccessModeValue
  default_mode: FileAccessModeValue
}

export const fileAccessApi = {
  get: (umo: string) =>
    typed<FileAccessModeStatusData>(openApiV1.getFileAccessMode({ query: { umo } })),
  set: (umo: string, mode: FileAccessModeValue) =>
    typed<FileAccessModeStatusData>(
      openApiV1.setFileAccessMode({ body: { umo, mode } }),
    ),
}
```

Note: if the generated function signature differs (check `dashboard/src/api/generated/openapi-v1/sdk.gen.ts` after Task 5), adapt the call shape — the operationIds `getFileAccessMode`/`setFileAccessMode` fix the names.

- [ ] **Step 2: Create the composable**

Create `dashboard/src/composables/useFileAccessMode.ts`:

```ts
// src/composables/useFileAccessMode.ts
//
// Singleton state for the per-session file access mode chip
// (full / readonly / workspace). Mirrors `useSpcodePlanMode.ts`:
// module-level ref + explicit mutation methods; soft-fail refresh.

import { ref } from 'vue'
import { fileAccessApi, type FileAccessModeValue } from '@/api/v1'

export type FileAccessMode = FileAccessModeValue

export interface FileAccessState {
  mode: FileAccessMode | null
  defaultMode: FileAccessMode | null
}

const state = ref<FileAccessState>({ mode: null, defaultMode: null })

export function useFileAccessMode() {
  /**
   * Pull the authoritative mode for a session from the core endpoint.
   * Soft-fails: keeps the last known state on network/auth errors.
   */
  async function refresh(umo: string): Promise<void> {
    try {
      const res = await fileAccessApi.get(umo)
      const data = res.data?.data
      if (!data) return
      state.value = { mode: data.mode, defaultMode: data.default_mode }
    } catch (err) {
      console.warn('[useFileAccessMode] refresh failed:', err)
    }
  }

  /**
   * Authoritatively set the mode via POST. Returns false on failure so
   * the caller can resync or fall back.
   */
  async function setMode(umo: string, mode: FileAccessMode): Promise<boolean> {
    try {
      const res = await fileAccessApi.set(umo, mode)
      const data = res.data?.data
      if (!data) return false
      state.value = { mode: data.mode, defaultMode: data.default_mode }
      return true
    } catch (err) {
      console.warn('[useFileAccessMode] setMode failed:', err)
      return false
    }
  }

  /** Optimistic local flip used right after a chip click. */
  function setOptimistic(mode: FileAccessMode): void {
    state.value = { ...state.value, mode }
  }

  /** Wipe to the unknown state (logout / no active session). */
  function reset(): void {
    state.value = { mode: null, defaultMode: null }
  }

  return { status: state, refresh, setMode, setOptimistic, reset }
}
```

- [ ] **Step 3: Typecheck**

Run: `cd dashboard && pnpm typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/api/v1.ts dashboard/src/composables/useFileAccessMode.ts
git commit -m "feat(dashboard): add file access mode composable and api wrapper"
```

---

### Task 7: Mode chip + ChatInput/Chat wiring + i18n

**Files:**
- Create: `dashboard/src/components/chat/FileAccessModeChip.vue`
- Modify: `dashboard/src/components/chat/ChatInput.vue` (template lines 31-40; imports ~610; gates ~901-910; handler ~1538-1569; watch ~1906-1921)
- Modify: `dashboard/src/components/chat/Chat.vue` (refresh sites ~1771 and ~2180; import/instantiation near the other composals ~1713-1769)
- Modify: `dashboard/src/i18n/locales/zh-CN/features/chat.json`, `en-US/features/chat.json`, `ru-RU/features/chat.json` (new top-level `fileAccessChip` key)

**Interfaces:**
- Consumes: `useFileAccessMode` (Task 6), `SpSegmentedControl.vue` (`segments`/`modelValue`/`@change`), `buildWebchatUmoDetails` from `@/utils/chatConfigBinding`.
- Produces: a chip emitting `change(mode)`; ChatInput handles it via POST with `/plan` command fallback for readonly when no session exists.

- [ ] **Step 1: Add i18n strings (all three locales)**

Add a new **top-level** key in each `features/chat.json` (sibling of the existing top-level keys, not nested under `spcodeProjectLoad`):

`zh-CN`:
```json
  "fileAccessChip": {
    "fullLabel": "完全",
    "readonlyLabel": "只读",
    "workspaceLabel": "工作区",
    "tooltip": "文件访问模式：完全=任意路径可写；只读=Plan 模式，禁止一切写入；工作区=仅会话工作区与白名单内可写（shell 不受此限制）"
  },
```

`en-US`:
```json
  "fileAccessChip": {
    "fullLabel": "Full",
    "readonlyLabel": "Read-only",
    "workspaceLabel": "Workspace",
    "tooltip": "File access mode: Full = unrestricted writes; Read-only = plan mode, all writes disabled; Workspace = writes allowed only inside the session workspace and whitelist (shell is not path-restricted)"
  },
```

`ru-RU`:
```json
  "fileAccessChip": {
    "fullLabel": "Полный",
    "readonlyLabel": "Только чтение",
    "workspaceLabel": "Рабочая область",
    "tooltip": "Режим доступа к файлам: Полный = запись без ограничений; Только чтение = режим plan, все записи запрещены; Рабочая область = запись только в рабочей области сессии и белом списке (shell не ограничивается путями)"
  },
```

- [ ] **Step 2: Create the chip component**

Create `dashboard/src/components/chat/FileAccessModeChip.vue`:

```vue
<!--
  FileAccessModeChip — three-segment file access mode switcher
  (full / readonly / workspace). Replaces SpcodePlanModeChip: readonly
  IS plan mode, with the state owned by AstrBot core (per-umo).
-->
<script setup lang="ts">
import { computed } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import {
  useFileAccessMode,
  type FileAccessMode,
} from "@/composables/useFileAccessMode";
import SpSegmentedControl, { type Segment } from "./SpSegmentedControl.vue";

const { tm } = useModuleI18n("features/chat");
const { status } = useFileAccessMode();

const emit = defineEmits<{
  (e: "change", mode: FileAccessMode): void;
}>();

const modeValue = computed<string>(
  () => status.value.mode ?? status.value.defaultMode ?? "full",
);

const segments = computed<Segment[]>(() => [
  {
    value: "full",
    label: tm("fileAccessChip.fullLabel"),
    icon: "mdi-lock-open-outline",
  },
  {
    value: "readonly",
    label: tm("fileAccessChip.readonlyLabel"),
    icon: "mdi-file-eye-outline",
  },
  {
    value: "workspace",
    label: tm("fileAccessChip.workspaceLabel"),
    icon: "mdi-folder-edit-outline",
  },
]);

function onChange(next: string): void {
  if (next === modeValue.value) return;
  emit("change", next as FileAccessMode);
}
</script>

<template>
  <div class="file-access-chip">
    <v-tooltip activator="parent" location="top">
      {{ tm("fileAccessChip.tooltip") }}
    </v-tooltip>
    <SpSegmentedControl
      :segments="segments"
      :model-value="modeValue"
      @change="onChange"
    />
  </div>
</template>

<style scoped>
.file-access-chip {
  display: inline-flex;
  align-items: center;
}
</style>
```

- [ ] **Step 3: Wire ChatInput.vue**

3a. Template — the whole status row is currently gated by `v-if="showSpcodeIndicator"` (line 14; `showSpcodeIndicator = isProjectLoadAvailable`, i.e. spcode plugin enabled). Per the spec the mode chip must be visible without the plugin, so move the gate from the row to the left wrapper and always render the row. Replace lines 14-20:

```vue
    <div class="input-area__status-row">
      <div
        v-if="showSpcodeIndicator"
        class="input-area__status-row__left"
      >
        <SpcodeProjectIndicator
          @open-load-dialog="openLoadDialog"
          @open-codegraph-dialog="openCodegraphLoadDialog"
        />
      </div>
```

Then replace the `SpcodePlanModeChip` block in the chips stack (lines 31-35) with (no `v-if` — always visible):

```vue
          <FileAccessModeChip @change="handleFileAccessModeChange" />
```

Keep the `GitDiffChip` below it and the surrounding `input-area__status-row__right` / `chips-stack` wrappers intact. With only the right group present (plugin disabled), `justify-content: space-between` right-aligns the chips — intended. The script-side `showSpcodeIndicator` gate (line 894) stays; it now only hides the project indicator.

3b. Imports — add:

```ts
import FileAccessModeChip from "./FileAccessModeChip.vue";
import { useFileAccessMode } from "@/composables/useFileAccessMode";
import type { FileAccessMode } from "@/composables/useFileAccessMode";
```

Replace the `spcodePlanMode` instantiation (line ~910) with:

```ts
const fileAccessMode = useFileAccessMode();
```

Remove now-unused references tied only to the old chip: the `useSpcodePlanModeLoad` import + `isPlanModeChipAvailable`/`showPlanModeChip` definitions (lines ~901-902) and the `useSpcodePlanMode` import (line ~610) — but first grep the file for other uses:

Run: `grep -n "spcodePlanMode\|SpcodePlanModeChip\|showPlanModeChip\|isPlanModeChipAvailable" dashboard/src/components/chat/ChatInput.vue`
Expected before cleanup: template line, imports, gates, handler, watch. Remove exactly those; if a reference is used by something else (e.g. the "+" menu), keep it.

3c. Replace `handlePlanModeToggle` (lines 1538-1569) with:

```ts
function handleFileAccessModeChange(mode: FileAccessMode): void {
  // Optimistic flip so the chip highlights immediately.
  fileAccessMode.setOptimistic(mode);

  const session = props.currentSession;
  if (!session) {
    // No session yet → no umo. Only readonly has a command fallback.
    if (mode === "readonly") {
      emit("send-command", "/plan");
    }
    return;
  }
  const umo = buildWebchatUmoDetails(
    session.session_id,
    Boolean(session.is_group),
  ).umo;
  void fileAccessMode.setMode(umo, mode).then((ok) => {
    if (!ok) {
      // Resync on failure; readonly additionally falls back to /plan.
      void fileAccessMode.refresh(umo);
      if (mode === "readonly") {
        emit("send-command", "/plan");
      }
    }
  });
}
```

3d. Replace the `showPlanModeChip` watcher (lines 1906-1921) with a session watcher:

```ts
watch(
  () => props.currentSession?.session_id ?? null,
  async (sid) => {
    if (!sid || !props.currentSession) {
      fileAccessMode.reset();
      return;
    }
    const umo = buildWebchatUmoDetails(
      props.currentSession.session_id,
      Boolean(props.currentSession.is_group),
    ).umo;
    await fileAccessMode.refresh(umo);
  },
  { immediate: true },
);
```

- [ ] **Step 4: Wire Chat.vue refresh sites**

In `dashboard/src/components/chat/Chat.vue`:
- Add `import { useFileAccessMode } from "@/composables/useFileAccessMode";` next to the `useSpcodePlanMode` import.
- Instantiate next to the existing `spcodePlanMode`: `const fileAccessMode = useFileAccessMode();`
- At the `onStreamEnd` refresh site (~line 1771, `void spcodePlanMode.refresh(resolveCurrentUmo(currSessionId.value));`) add directly after it:

```ts
        void fileAccessMode.refresh(resolveCurrentUmo(currSessionId.value));
```

- At the session-change watcher refresh site (~line 2180, `await spcodePlanMode.refresh(resolveCurrentUmo(next));`) add directly after it:

```ts
      await fileAccessMode.refresh(resolveCurrentUmo(next));
```

Keep all existing `spcodePlanMode` uses (stream parser, `/plan` feedback) — they keep the plugin-side chip-less state fresh and remain harmless.

- [ ] **Step 5: Verify**

Run: `cd dashboard && pnpm typecheck && pnpm test`
Expected: both exit 0 (the i18n completeness spec enforces that all three locales carry `fileAccessChip`).

Run: `cd dashboard && pnpm build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/chat/FileAccessModeChip.vue dashboard/src/components/chat/ChatInput.vue dashboard/src/components/chat/Chat.vue dashboard/src/i18n/locales
git commit -m "feat(dashboard): add file access mode switcher chip to chat input"
```

---

## Part C — spcode plugin (`F:\github\astrbot_plugin_spcode_toolkit`)

All commands in this part run from `F:\github\astrbot_plugin_spcode_toolkit`; Python runs inside the AstrBot env (`uv run --project F:/github/Astrbot python -m pytest ...`). Commits go to the plugin's own git repo.

### Task 8: Plan mode derives from core state + commands + blocklist default

**Files:**
- Modify: `tools/security/plan_mode.py` (rewrite `PlanModeController`; drop `_original_tool_sets`)
- Modify: `main.py` (controller construction line 164; `/plan` `/build` unchanged apart from relying on new controller; `_conf_schema.json` default list)
- Modify: `_conf_schema.json` (`plan_mode_blocked_tools` default, lines 173-195)
- Test: `tests/test_plan_mode.py` (constructor arity + core-state-driven filtering)

**Interfaces:**
- Consumes: `astrbot.core.tools.fs_access` (Task 1) — `FileAccessMode`, `get_mode_for_umo`, `set_mode_for_umo`, `restore_writable_for_umo`, `resolve_default`, `count_readonly_overrides`.
- Produces (unchanged external contract): `PlanModeController(get_config, get_core_config)` with `is_active/count_active/has_reminded/activate/deactivate/filter_request`; `/plan` `/build` commands and `GET/POST /spcode/plan-mode` keep working through it.

- [ ] **Step 1: Rewrite the controller**

Replace the body of `tools/security/plan_mode.py` (keep the module docstring, update it to describe the core merge). New implementation:

```python
"""plan_mode 控制器 — 只读(readonly)文件访问模式的插件侧过滤层。

v3.x (2026-08-20): 状态由 AstrBot 核心 ``astrbot.core.tools.fs_access``
持有(per-umo)。本控制器只做两件事:
1. 派生:plan active := 核心模式 == READONLY
2. 过滤:active 时按 plan_mode_blocked_tools 从 req.func_tool 移除写工具
   + 首轮注入 reminder(prefix-cache 友好)

/plan /build 命令与 /spcode/plan-mode webapi 都委托本控制器,再写核心状态。
"""

from __future__ import annotations

import logging
from typing import Callable, TYPE_CHECKING

if TYPE_CHECKING:
    from astrbot.core.provider import ProviderRequest

logger = logging.getLogger(__name__)

_FS_ACCESS_WARNING_EMITTED = False


def _load_fs_access():
    """Late-import core fs_access; None outside AstrBot (bare unit tests)."""
    global _FS_ACCESS_WARNING_EMITTED
    try:
        from astrbot.core.tools import fs_access

        return fs_access
    except Exception as exc:  # pragma: no cover - test-env only
        if not _FS_ACCESS_WARNING_EMITTED:
            _FS_ACCESS_WARNING_EMITTED = True
            logger.warning(f"plan_mode: astrbot.core.tools.fs_access 不可用: {exc}")
        return None


class PlanModeController:
    """plan(readonly) 模式的过滤钩子 + reminder 注入,状态在核心。"""

    def __init__(
        self,
        get_config: Callable[[], dict],
        get_core_config: Callable[[], dict],
    ) -> None:
        self._get_config = get_config
        self._get_core_config = get_core_config
        self._plan_reminded: dict[str, bool] = {}

    # ── 状态查询 ─────────────────────────────────────

    def _default_mode(self):
        fs_access = _load_fs_access()
        if fs_access is None:
            return None
        return fs_access.resolve_default(self._get_core_config() or {})

    def is_active(self, umo: str | None) -> bool:
        fs_access = _load_fs_access()
        if fs_access is None or not umo:
            return False
        default = self._default_mode()
        return (
            fs_access.get_mode_for_umo(umo, default=default)
            is fs_access.FileAccessMode.READONLY
        )

    def count_active(self) -> int:
        fs_access = _load_fs_access()
        if fs_access is None:
            return 0
        return fs_access.count_readonly_overrides()

    def has_reminded(self, umo: str) -> bool:
        return bool(self._plan_reminded.get(umo, False))

    # ── 状态变更(由 /plan /build 命令调用) ──────────────────

    def activate(self, umo: str) -> None:
        fs_access = _load_fs_access()
        if fs_access is None:
            return
        fs_access.set_mode_for_umo(umo, fs_access.FileAccessMode.READONLY)
        self._plan_reminded.pop(umo, None)

    def deactivate(self, umo: str) -> bool:
        fs_access = _load_fs_access()
        if fs_access is None:
            return False
        was_active = self.is_active(umo)
        fs_access.restore_writable_for_umo(umo, default=self._default_mode())
        self._plan_reminded.pop(umo, None)
        return was_active

    # ── 钩子主入口(由 _plan_filter_tools 装饰方法调用) ──────────

    def filter_request(self, event, req: "ProviderRequest") -> None:
        """readonly 时过滤写工具 + 注入 reminder;否则 no-op。"""
        umo = event.unified_msg_origin
        if not self.is_active(umo):
            # 离开 readonly 时重置 reminder,下次进入重新注入。
            self._plan_reminded.pop(umo, None)
            return
        if not req.func_tool:
            return

        blocked_tools = self._get_config().get("plan_mode_blocked_tools") or []
        if blocked_tools:
            removed_count = self._filter_func_tool(req, set(blocked_tools))
            if removed_count > 0:
                logger.debug(
                    f"[plan] 会话 {umo}: 从工具列表过滤 {removed_count} 个写工具"
                )
        else:
            logger.warning(
                f"[plan] 会话 {umo}: 处于 plan 模式但 plan_mode_blocked_tools 为空,"
                f"将不会过滤任何工具。请在 _conf_schema.json 配置。"
            )

        if self._plan_reminded.get(umo, False):
            return

        reminder_template = (self._get_config().get("plan_mode_reminder") or "").strip()
        if not reminder_template:
            self._plan_reminded[umo] = True
            return

        blocked_str = (
            ", ".join(sorted(set(blocked_tools))) if blocked_tools else "(none)"
        )
        reminder_text = reminder_template.replace("{blocked}", blocked_str)
        if not reminder_text.lstrip().startswith("<system-reminder>"):
            reminder_text = f"<system-reminder>\n{reminder_text}\n</system-reminder>"

        if isinstance(req.contexts, list) and req.contexts:
            for msg in reversed(req.contexts):
                if isinstance(msg, dict) and msg.get("role") == "user":
                    content = msg.get("content", "")
                    if isinstance(content, str):
                        msg["content"] = content + "\n\n" + reminder_text
                    break

        self._plan_reminded[umo] = True
        logger.debug(f"[plan] 会话 {umo}: 已注入 plan 模式 reminder 到 user message")

    @staticmethod
    def _filter_func_tool(req: "ProviderRequest", blocked: set[str]) -> int:
        """从 req.func_tool 中过滤掉 blocked 集合里的工具名,返回被过滤的数量。

        新建 ToolSet 替换原引用,避免 in-place 修改污染共享 list;
        被过滤工具的 schema 不序列化 — LLM 看不到也调不到。
        """
        if not req.func_tool or not blocked:
            return 0
        kept = [t for t in req.func_tool.tools if t.name not in blocked]
        actual_removed = len(req.func_tool.tools) - len(kept)
        if actual_removed == 0:
            return 0
        try:
            from astrbot.core.agent.tool import ToolSet

            new_set: "ToolSet" = ToolSet()
            for t in kept:
                new_set.add_tool(t)
            req.func_tool = new_set
            return actual_removed
        except Exception as exc:
            logger.warning(f"spcode_toolkit 工具过滤失败: {exc}")
            return 0
```

Rationale for dropping `_original_tool_sets`: with core-owned state the plugin re-filters (or doesn't) on every request from the fresh per-request ToolSet assembled by the main agent, so there is nothing to restore.

- [ ] **Step 2: Update main.py construction**

In `main.py` line 164, replace:

```python
        self._plan = PlanModeController(get_config=lambda: self._config)
```

with:

```python
        self._plan = PlanModeController(
            get_config=lambda: self._config,
            get_core_config=lambda: (
                self.context.get_config() if self.context else {}
            ),
        )
```

(`/plan` and `/build` at lines 871-936 need no changes — they delegate to `activate`/`deactivate`, which now write core state. `Context.get_config(umo: str | None = None)` is valid with no args — it returns the default config.)

- [ ] **Step 3: Extend the blocklist default**

In `_conf_schema.json`, extend the `plan_mode_blocked_tools` default list (after `"astrbot_file_edit_tool",` at line 185) with:

```json
          "astrbot_execute_shell",
          "astrbot_shell_session",
```

(Note for reviewers: saved user configs keep their stored list; the new defaults apply to fresh installs.)

- [ ] **Step 4: Update the tests**

In `tests/test_plan_mode.py`, fix constructor arity — every `PlanModeController(lambda: {})` becomes `PlanModeController(lambda: {}, lambda: {})`. Then append a core-state-driven test:

```python
async def test_filter_request_filters_when_core_mode_is_readonly(monkeypatch):
    """核心模式为 readonly 时,plan 过滤从 req.func_tool 移除写工具。"""
    from astrbot.core.tools import fs_access
    from tools.security.plan_mode import PlanModeController

    fs_access.reset()
    umo = "webchat:FriendMessage:webchat!tester!s1"
    fs_access.set_mode_for_umo(umo, fs_access.FileAccessMode.READONLY)
    try:
        controller = PlanModeController(
            lambda: {"plan_mode_blocked_tools": ["astrbot_file_write_tool"]},
            lambda: {},
        )
        tool_a = type("T", (), {"name": "astrbot_file_write_tool"})()
        tool_b = type("T", (), {"name": "es_search"})()

        class _FuncTool:
            def __init__(self, items):
                self.tools = list(items)

        req = SimpleNamespace(
            func_tool=_FuncTool([tool_a, tool_b]), contexts=[]
        )
        event = SimpleNamespace(unified_msg_origin=umo)
        controller.filter_request(event, req)
        assert [t.name for t in req.func_tool.tools] == ["es_search"]
    finally:
        fs_access.reset()
```

Add `from types import SimpleNamespace` to the test file imports if missing. The `ToolSet` late import inside `_filter_func_tool` requires the AstrBot env — that is satisfied by the test command below.

- [ ] **Step 5: Run the plugin plan tests**

Run: `uv run --project F:/github/Astrbot python -m pytest tests/test_plan_mode.py tests/test_security_plan_mode.py tests/test_plan_build_feedback.py -v`
Expected: PASS. If `test_security_plan_mode.py` / `test_plan_build_feedback.py` fail on constructor arity, apply the same `PlanModeController(lambda: {}, lambda: {})` fix shown above; if any test constructs the controller differently, adapt it to the new two-callback signature.

- [ ] **Step 6: Commit (plugin repo)**

```bash
git add tools/security/plan_mode.py main.py _conf_schema.json tests/test_plan_mode.py tests/test_security_plan_mode.py tests/test_plan_build_feedback.py
git commit -m "feat: derive plan mode from core file access mode state"
```

---

### Task 9: Guards in `astrbot_file_remove` and `code_format`

**Files:**
- Modify: `tools/function_tools/file_remove.py` (`call` at line 67)
- Modify: `tools/function_tools/code_format.py` (`call` at line 77)
- Test: `tests/test_fs_guard_tools.py` (new)

**Interfaces:**
- Consumes: `fs_access.assert_writable` (Task 1).
- Produces: readonly → both tools return an error string before touching the filesystem; workspace → roots check. `code_format` skips the guard when `check=True` (dry-run does not write).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_fs_guard_tools.py`:

```python
"""fs_access guards in plugin write tools (readonly / workspace)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from astrbot.core.agent.run_context import ContextWrapper
from astrbot.core.tools import fs_access
from tools.function_tools.code_format import CodeFormatTool
from tools.function_tools.file_remove import FileRemoveTool

UMO = "webchat:FriendMessage:webchat!tester!s1"


def _make_context() -> ContextWrapper:
    config_holder = SimpleNamespace(
        get_config=lambda umo=None: {"provider_settings": {}}
    )
    event = SimpleNamespace(
        role="admin", unified_msg_origin=UMO, get_sender_id=lambda: "tester"
    )
    astr_ctx = SimpleNamespace(context=config_holder, event=event)
    return ContextWrapper(context=astr_ctx)


@pytest.fixture(autouse=True)
def _clean_state():
    fs_access.reset()
    yield
    fs_access.reset()


@pytest.mark.asyncio
async def test_file_remove_blocked_in_readonly(tmp_path, monkeypatch):
    fs_access.set_mode_for_umo(UMO, fs_access.FileAccessMode.READONLY)
    target = tmp_path / "victim.txt"
    target.write_text("x", encoding="utf-8")

    from tools import file_remove as file_remove_mod

    called = False

    def _fail(*_a, **_k):
        nonlocal called
        called = True
        raise AssertionError("remove must not run in readonly mode")

    monkeypatch.setattr(file_remove_mod, "remove", _fail)
    result = await FileRemoveTool().call(_make_context(), path=str(target))
    assert not called
    assert "readonly" in str(result)
    assert target.exists()


@pytest.mark.asyncio
async def test_code_format_blocked_in_readonly(tmp_path, monkeypatch):
    fs_access.set_mode_for_umo(UMO, fs_access.FileAccessMode.READONLY)
    target = tmp_path / "victim.py"
    target.write_text("x=1\n", encoding="utf-8")

    from tools import code_format as code_format_mod

    monkeypatch.setattr(
        code_format_mod, "format", AsyncMock(side_effect=AssertionError)
    )
    result = await CodeFormatTool().call(_make_context(), filepath=str(target))
    assert "readonly" in str(result)


@pytest.mark.asyncio
async def test_code_format_check_dry_run_allowed_in_readonly(tmp_path, monkeypatch):
    fs_access.set_mode_for_umo(UMO, fs_access.FileAccessMode.READONLY)
    target = tmp_path / "ok.py"
    target.write_text("x=1\n", encoding="utf-8")

    from tools import code_format as code_format_mod

    monkeypatch.setattr(
        code_format_mod,
        "format",
        AsyncMock(return_value=(True, '{"changed": false}')),
    )
    result = await CodeFormatTool().call(
        _make_context(), filepath=str(target), check=True
    )
    assert "readonly" not in str(result)
```

Note: the two blocking tests mock the business functions (`tools.file_remove.remove`, `tools.code_format.format`) so they fail loudly if the guard is missing; adapt the mock return shape to the real functions' return convention if the imports differ (check `tools/file_remove.py` for `remove` and `tools/code_format.py` for `format` — the wrappers import them lazily as `from .. import file_remove` / `from .. import code_format`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --project F:/github/Astrbot python -m pytest tests/test_fs_guard_tools.py -v`
Expected: the two blocking tests FAIL (guards absent); the dry-run test may pass trivially.

- [ ] **Step 3: Implement the guards**

In `tools/function_tools/file_remove.py`, insert at the top of `call` (after `from .. import file_remove`):

```python
        from astrbot.core.tools import fs_access

        _record(self.name)
        try:
            await fs_access.assert_writable(path, context)
        except PermissionError as exc:
            return f"Error: {exc}"
        try:
            result = await run_sync(
```

(keep the remainder of the method unchanged; the `_record` call moves above the guard so usage stats still count attempts — delete the original `_record` line position accordingly).

In `tools/function_tools/code_format.py`, insert at the top of `call` (after `from .. import code_format`):

```python
        from astrbot.core.tools import fs_access

        if not check:
            # Dry-run (check=true) does not write; only real formats are guarded.
            try:
                await fs_access.assert_writable(filepath, context)
            except PermissionError as exc:
                return f"Error: {exc}"
        # LLM 不再传 formatter/style/indent,全部从实例属性读
        return await record_and_run(
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run --project F:/github/Astrbot python -m pytest tests/test_fs_guard_tools.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit (plugin repo)**

```bash
git add tools/function_tools/file_remove.py tools/function_tools/code_format.py tests/test_fs_guard_tools.py
git commit -m "feat: enforce core file access mode in file_remove and code_format"
```

---

### Task 10: Worktree dynamic-root sync

**Files:**
- Modify: `main.py` (`_worktree_activation_inject` at line 710)
- Test: `tests/test_worktree_roots_sync.py` (new)

**Interfaces:**
- Consumes: `fs_access.set_dynamic_roots` (Task 1); `tools.worktree_activation` (existing).
- Produces: every LLM request clears then (re)sets the umo's dynamic write roots to the active worktree path, so workspace mode never blocks the active worktree.

- [ ] **Step 1: Write the failing test**

Create `tests/test_worktree_roots_sync.py`:

```python
"""_worktree_activation_inject keeps core dynamic roots in sync."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from astrbot.core.tools import fs_access

UMO = "webchat:FriendMessage:webchat!tester!s1"


def _make_plugin(tmp_path, loaded_directory):
    plugin = SimpleNamespace()
    plugin._config = {"agentsmd_enabled": True, "codegraph_enabled": True}

    def get_loaded_project(_umo):
        return {"directory": loaded_directory}

    plugin.get_loaded_project = get_loaded_project
    plugin.wt_root = tmp_path / "wt"
    plugin.wt_root.mkdir(exist_ok=True)
    return plugin


@pytest.fixture(autouse=True)
def _clean_state():
    fs_access.reset()
    yield
    fs_access.reset()


@pytest.mark.asyncio
async def test_active_worktree_becomes_dynamic_root(tmp_path, monkeypatch):
    from main import SPCodeToolkit

    plugin = _make_plugin(tmp_path, str(tmp_path / "repo"))
    monkeypatch.setattr(
        "tools.worktree_activation._active_worktrees",
        {
            UMO: {
                "path": str(plugin.wt_root),
                "branch": "feat",
                "directory": str(tmp_path / "repo"),
            }
        },
    )

    req = SimpleNamespace(extra_user_content_parts=[])
    event = SimpleNamespace(unified_msg_origin=UMO)
    await SPCodeToolkit._worktree_activation_inject(plugin, event, req)
    assert fs_access.get_dynamic_roots(UMO) == (plugin.wt_root.resolve(),)


@pytest.mark.asyncio
async def test_no_activation_clears_dynamic_roots(tmp_path, monkeypatch):
    from main import SPCodeToolkit

    plugin = _make_plugin(tmp_path, str(tmp_path / "repo"))
    monkeypatch.setattr("tools.worktree_activation._active_worktrees", {})
    fs_access.set_dynamic_roots(UMO, [tmp_path])

    req = SimpleNamespace(extra_user_content_parts=[])
    event = SimpleNamespace(unified_msg_origin=UMO)
    await SPCodeToolkit._worktree_activation_inject(plugin, event, req)
    assert fs_access.get_dynamic_roots(UMO) == ()
```

Note: the test calls the unbound method with a `SimpleNamespace` plugin because the hook only touches `self._config`, `self.get_loaded_project`. If the hook signature/access pattern changes during implementation, adapt the fixture to construct it the same way.

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --project F:/github/Astrbot python -m pytest tests/test_worktree_roots_sync.py -v`
Expected: FAIL (`get_dynamic_roots` returns `()` / stale roots — no sync exists).

- [ ] **Step 3: Implement the sync**

In `main.py` `_worktree_activation_inject` (line 710), restructure the early returns so the clear always happens first. Replace the body from the flag check through the injection with:

```python
        from astrbot.core.tools import fs_access

        umo = event.unified_msg_origin
        # Always reset first: workspace-mode write roots must track the
        # *current* activation (or none) on every request.
        fs_access.set_dynamic_roots(umo, None)
        if not (
            self._config.get("agentsmd_enabled", True)
            and self._config.get("codegraph_enabled", True)
        ):
            return
        loaded = self.get_loaded_project(umo)
        if loaded is None:
            return
        activation = _get_active_worktree(umo, loaded.get("directory"))
        if activation is None:
            return
        path = (activation.get("path") or "").strip()
        if not path or not os.path.isdir(path):
            return
        # The active worktree is a writable root in workspace mode even when
        # it lives outside data/workspaces.
        fs_access.set_dynamic_roots(umo, [path])
        branch = activation.get("branch") or "detached"
        req.extra_user_content_parts.append(
            TextPart(
                text=ACTIVE_WORKTREE_GUIDANCE_TEMPLATE.format(
                    worktree=path, branch=branch
                )
            ).mark_as_temp()
        )
        logger.debug(f"[worktree-activation] 已向会话 {umo} 注入激活 worktree: {path}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run --project F:/github/Astrbot python -m pytest tests/test_worktree_roots_sync.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit (plugin repo)**

```bash
git add main.py tests/test_worktree_roots_sync.py
git commit -m "feat: sync active worktree into core workspace write roots"
```

---

### Task 11: Full regression + manual QA

**Files:** none (verification only)

- [ ] **Step 1: Run the full AstrBot test suite**

Run (from `F:\github\Astrbot`): `uv run pytest tests/ -q`
Expected: no new failures vs. the pre-branch baseline (focus on `test_computer_*`, `test_chat_*`, `test_fs_access.py`, `test_file_access_mode_route.py`).

- [ ] **Step 2: Run the full plugin test suite**

Run (from `F:\github\astrbot_plugin_spcode_toolkit`): `uv run --project F:/github/Astrbot python -m pytest tests/ -q`
Expected: no new failures.

- [ ] **Step 3: Lint the AstrBot repo**

Run: `uv run ruff format . && uv run ruff check .`
Expected: clean.

- [ ] **Step 4: Manual QA (both repos running together)**

1. `uv run main.py` + `cd dashboard && pnpm dev`; open a webchat session.
2. Chip shows three segments, defaults to the config default (Full).
3. Switch to **只读**: send "把 F:\github\Astrbot\README.md 第一行改成 X" — the model must not have write tools in its tool list; if it somehow calls one, it gets an error string. `/plan` command shows the same activation feedback; chip stays in 只读.
4. Switch to **工作区**: ask the model to write a file inside the session workspace (succeeds) and one at `C:\Windows\Temp\astrbot_test.txt` (blocked with "workspace whitelist" error). Activate a worktree from the project chip, then ask the model to edit a file in the worktree (must succeed).
5. `/build` exits readonly back to the previous writable mode; the chip follows after the next response (onStreamEnd refresh).
6. Config page → AI/Agent settings: the two new keys render (dropdown + list).
7. Non-admin regression (optional): with `computer_use_require_admin=True` and a non-admin webchat user, read/write restrictions behave exactly as before the change.

- [ ] **Step 5: Final commits if QA surfaced fixes**

Commit any fixes with `fix: ...` messages in the respective repos.

---

## Self-Review Notes (completed during planning)

- Spec coverage: three modes ✓ (Tasks 1-2), plan merge ✓ (Task 8), chip always visible ✓ (Task 7 moves the status-row `v-if="showSpcodeIndicator"` gate onto the left project-indicator wrapper), shell in workspace ✓ (Task 3 only gates readonly), config keys ✓ (Task 4), endpoint ✓ (Task 5), worktree roots ✓ (Task 10), plugin guards ✓ (Task 9), non-admin regression ✓ (Task 2 keeps `_is_restricted_env` as fallback in `_write_guard`).
- Deviation from spec (documented): `FileUploadTool`/`FileDownloadTool` need no changes — upload reads host→sandbox (no host write), download writes only into `get_astrbot_temp_path()` which is always an allowed root.
- Deviation from spec (documented): the plugin's `spcode/plan-mode` webapi needs no code change — it already delegates to `PlanModeController`, which now proxies core state (Task 8).
- Type consistency: `FileAccessMode` enum values `"full"/"readonly"/"workspace"` match the endpoint literal, the yaml enum, and the TS `FileAccessModeValue` union.
