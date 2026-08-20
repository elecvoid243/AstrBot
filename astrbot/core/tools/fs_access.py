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
from collections.abc import Sequence
from enum import Enum
from pathlib import Path
from typing import TYPE_CHECKING

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


def _config_for(context: ToolContext) -> dict:
    cfg = context.context.context.get_config(
        umo=context.context.event.unified_msg_origin
    )
    return cfg if isinstance(cfg, dict) else {}


def get_mode(context: ToolContext) -> FileAccessMode:
    """Resolve the effective mode for a tool-call context."""
    override = _mode_overrides.get(context.context.event.unified_msg_origin)
    if override is not None:
        return override
    return resolve_default(_config_for(context))


def extra_write_roots(context: ToolContext) -> tuple[Path, ...]:
    """Configured extra roots plus plugin dynamic roots for this context."""
    return configured_extra_roots(_config_for(context)) + get_dynamic_roots(
        context.context.event.unified_msg_origin
    )


async def write_roots(
    context: ToolContext,
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
    context: ToolContext,
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
