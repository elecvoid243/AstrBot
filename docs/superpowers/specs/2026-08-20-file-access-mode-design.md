# File Access Mode for LLM File Tools — Design

- Date: 2026-08-20
- Status: Approved (design approved in review; not yet implemented)
- Scope: AstrBot core + dashboard (`F:\github\Astrbot`), plugin (`F:\github\astrbot_plugin_spcode_toolkit`)

## Problem

The LLM file-write tools can currently write anywhere on disk for admin users
(which is what dashboard/webchat sessions are):

- Core builtin tools `astrbot_file_write_tool` / `astrbot_file_edit_tool`
  (`astrbot/core/tools/computer_tools/fs.py`) already contain a restricted-mode
  allow-list mechanism (`_write_allowed_roots` = session workspace + two temp
  dirs, enforced by `_normalize_rw_path`), but `_is_restricted_env` only
  enables it for non-admin users on the local runtime. Admins are fully
  unrestricted.
- spcode plugin tools (`astrbot_file_remove`, `code_format`,
  `astrbot_inta_shell_start`) have no workspace/path whitelist on the LLM-tool
  layer (`astrbot_file_remove` has a blacklist + recycle-bin flow; the webapi
  layer has repo-relative whitelists, but LLM tool calls do not).

We want a three-state **file access mode** per conversation:

| Mode | Meaning |
|---|---|
| `full` | Current behavior — no restriction for admins. |
| `readonly` | No writes anywhere. Write tools hidden from the LLM + hard call-time rejection. Merges spcode "plan mode". |
| `workspace` | Writes allowed only inside the session workspace + temp dirs + user-configured extra roots (+ active worktree root). |

And a mode switcher chip in the dashboard ChatInput.

## Confirmed Decisions

1. **Default mode (fallback when no per-session override): `full`** — backward
   compatible; overridable globally via config.
2. **Plan-mode merge: core owns the state.** The file access mode lives in
   AstrBot core as per-umo in-memory state. The spcode plugin derives
   "plan active" from `mode == readonly` in its existing `on_llm_request`
   filter hook; `/plan` and `/build` become aliases that set core state.
3. **Chip always visible** in ChatInput (core capability, does not require the
   spcode plugin). Plugin-provided extras (MCP blocklist, reminder text) stack
   on top when the plugin is enabled.
4. **Workspace mode keeps shell tools usable.** Shell cannot be reliably
   path-restricted; it stays under the existing `block_unsafe` logic.
   Readonly mode still hides/rejects shell.

## Non-Goals

- No persistence of the per-session mode across restarts (falls back to config
  default; same as plan mode today). Can be added later on `ChatUIProject`.
- No call-time path enforcement for MCP tools (impossible generically); they
  are only hidden by the readonly blocklist.
- No path-level restriction of shell in workspace mode (accepted trade-off).
- No changes to the plugin webapi layer (already whitelisted to repo-relative
  paths); the dashboard webapi is user-driven, not LLM-driven.

## Design Overview

```
Frontend chip (3 segments)
    │ GET/POST /api/chat/file-access-mode (umo)
    ▼
Core per-umo mode state (fs_access module, in-memory)
    │
    ├─① request-time tool-visibility filtering (readonly) — executed by the
    │    spcode plugin's on_llm_request hook, driven by core mode
    │
    └─② call-time hard enforcement — inside each mutating tool
         (core fs/shell tools + plugin file_remove / code_format)
```

Layer ① keeps write tools out of the LLM's tool list (clean, saves tokens,
preserves plan-mode UX). Layer ② is the safety net that cannot be bypassed by
prompting, misconfigured blocklists, or subagent calls (subagents go through
the same `FunctionToolExecutor` → `tool.call` path).

## 1. Core: `fs_access` module

New module `astrbot/core/tools/fs_access.py` (process-global singleton state,
mirroring the plan controller's role but in core):

```python
class FileAccessMode(str, Enum):
    FULL = "full"
    READONLY = "readonly"
    WORKSPACE = "workspace"
```

State and API (behavioral contract; exact signatures finalized in code):

- `_overrides: dict[str, FileAccessMode]` — per-umo explicit choice.
- `_last_writable: dict[str, FileAccessMode]` — last non-readonly mode per
  umo, used by `/build` / chip switching to restore the previous mode.
- `get_mode_for_umo(umo, *, default: FileAccessMode) -> FileAccessMode` —
  override if set, else the provided default.
- `set_mode_for_umo(umo, mode)` — records `_last_writable` when moving away
  from `READONLY`.
- `restore_writable(umo, *, default) ` — set `_last_writable` if recorded,
  else `default`. Used by `/build`.
- Dynamic roots for plugin integration:
  `set_dynamic_roots(umo, roots: Sequence[Path] | None)` — per-umo additional
  write roots registered by plugins (see "Worktree interplay" below).
- Tool-facing helpers (take the tool's `ContextWrapper[AstrAgentContext]`):
  - `get_mode(context) -> FileAccessMode` — resolves the config default via
    `context.context.get_config(umo)` (profile-aware, same pattern as
    `_is_restricted_env` in `fs.py:173`).
  - `write_roots(context) -> tuple[Path, ...]` — session workspace root
    (reuse `workspace_root_for_context`, `computer_tools/util.py:27`) +
    `get_astrbot_temp_path()` + `get_astrbot_system_tmp_path()` +
    config `file_access_extra_roots` + per-umo dynamic roots.
    Amendment (2026-08-21): dynamic roots also include the loaded spcode
    project directory (`/project load`), synced per request by the plugin,
    and **per-umo custom roots** editable from the chip's whitelist dialog
    (`POST /chat/file-access-mode/roots`), persisted in SharedPreferences
    so they survive restarts. The dialog lists the implicit roots
    (workspace / project / temp / active worktree) read-only with badges
    and the custom roots as an editable list; the worktree entry follows
    the picker's current selection.
  - `assert_writable(path: str, context) -> None` — raises `PermissionError`:
    - `FULL`: no-op.
    - `READONLY`: always reject (writes forbidden everywhere).
    - `WORKSPACE`: containment check against `write_roots(context)`.

### Path checking rules (workspace mode)

- Resolve the candidate with `Path.expanduser().resolve(strict=False)` —
  collapses `..`, symlinks, and Windows junctions.
- Compare with `os.path.normcase` on both sides (Windows case-insensitivity).
  The existing `_is_path_within_allowed_roots` (`fs.py:223`) compares
  case-sensitively; the shared checker must not be bypassable via casing.
- Roots themselves are resolved/normcased once when computed.
- UNC and `\\?\` prefixes: reuse the rejection precedent from the plugin's
  `file_remove` if it surfaces in practice; `resolve()` handles most cases.

## 2. Core: builtin tool enforcement

### File tools (`fs.py`)

At the existing `_normalize_rw_path` call sites:

- Compute `mode = fs_access.get_mode(context)` alongside
  `restricted = _is_restricted_env(context)`.
- **Read operations** (`write=False`): unchanged for admins — `restricted`
  still comes from `_is_restricted_env` only. For restricted (non-admin)
  users, the read roots additionally include the extra + dynamic roots, so a
  writable root is always also readable.
- **Write operations** (`write=True`):
  - `mode == READONLY` → raise `PermissionError` (admin included), with a
    message that explains readonly mode and names the blocked path.
  - `mode == WORKSPACE` → `restricted = True` and allowed roots =
    `_write_allowed_roots(...)` ∪ config extra roots ∪ dynamic roots.
  - `mode == FULL` → current behavior (admin unrestricted; non-admin keeps
    existing workspace+temp restriction).
- Covered tools: `FileWriteTool`, `FileEditTool` (edit + rollback/history
  paths — the target path check covers rollback since backups apply to the
  same file), `FileUploadTool` (sandbox runtime), `FileDownloadTool` if it
  resolves a local write path.

### Shell tools (`computer_tools/shell.py`)

- `astrbot_execute_shell`, `astrbot_shell_session`: at the top of `call()`,
  if `mode == READONLY` return an error string ("shell is disabled in
  readonly/plan mode"). Workspace mode: unchanged (decision #4).

## 3. Core: config keys

`provider_settings` additions (`astrbot/core/config/default.py`), exposed in
the WebUI metadata near the `agent_computer_use` block (`ai_group`):

- `file_access_default_mode`: `"full" | "readonly" | "workspace"`,
  default `"full"`.
- `file_access_extra_roots`: `list[str]`, default `[]` — the user-defined
  path whitelist appended to workspace-mode roots.

## 4. Core: dashboard API

In `astrbot/dashboard/api/chat.py` (same router as the existing chat routes):

- `GET /api/chat/file-access-mode?umo=<umo>` →
  `{"mode": "full", "default_mode": "full"}` (mode = effective mode).
- `POST /api/chat/file-access-mode` body `{"umo": "...", "mode": "full"}` →
  `{"mode": "..."}`.
- Trust model: same as the existing plugin `spcode/plan-mode` endpoint — the
  dashboard is admin-authenticated; umo is supplied by the client.
- Update `openspec/openapi-v1.yaml` and regenerate the frontend client
  (`cd dashboard && pnpm generate:api`) per repo rules.

No changes to the webchat request chain (`chat_service` /
`webchat_adapter.create_event` extras): the mode is server-side state, not a
per-request field.

## 5. Plugin: plan mode merge

`F:\github\astrbot_plugin_spcode_toolkit`:

- `PlanModeController.filter_request` (`tools/security/plan_mode.py`) becomes
  a **stateless filter driven by core mode**: plan active :=
  `fs_access.get_mode_for_umo(umo) == READONLY`. When active, keep the
  existing behavior: remove `plan_mode_blocked_tools` from `req.func_tool`
  (rebuild a new `ToolSet`, never mutate in place) and inject the one-shot
  `plan_mode_reminder` into the last user message (prefix-cache friendly).
- Reminder tracking stays in the plugin (`_plan_reminded` dict): set when a
  reminder is injected while readonly; cleared whenever mode != readonly is
  observed. No transition events needed.
- The `_original_tool_sets` snapshot/restore machinery is removed — with
  core-owned state, the full toolset is rebuilt per request by the main
  agent, so unfiltering is automatic. (Verify no other consumer during
  implementation.)
- `_conf_schema.json`: add `astrbot_execute_shell` and `astrbot_shell_session`
  to the default `plan_mode_blocked_tools` (they are currently missing), so
  readonly hides shell alongside the write tools.
- Commands: `/plan` → `fs_access.set_mode_for_umo(umo, READONLY)`;
  `/build` → `fs_access.restore_writable(umo)`. Existing feedback/UX of the
  commands is kept.
- WebAPI `spcode/plan-mode` (`tools/webapi/plan_mode.py`) becomes a
  compatibility shim over core state: GET reports `mode == READONLY`;
  POST `active=true/false` maps to set-readonly / restore-writable. Older
  frontend builds keep working.

### Worktree interplay (important)

Activated spcode worktrees may live outside `data/workspaces` (arbitrary git
worktree paths). Workspace mode must not break the worktree workflow:

- The plugin calls `fs_access.set_dynamic_roots(umo, [worktree_path])`
  whenever worktree activation changes (`tools/worktree_activation.py`) and
  defensively re-syncs in its `on_llm_request` hook. Deactivation clears the
  dynamic roots. Workspace-mode roots = static roots ∪ dynamic roots.

## 6. Plugin: write tool guards

- `astrbot_file_remove` (`tools/function_tools/file_remove.py`) and
  `code_format` (`tools/function_tools/code_format.py`): call
  `fs_access.assert_writable(path, context)` early in `call()`.
  Readonly → error string (second line of defense; the tool is also hidden).
  Workspace → roots check. `astrbot_file_remove` keeps its blacklist,
  recycle-bin, and `confirm` proposal flow unchanged (stacked, not replaced).
- `astrbot_inta_shell_*`: readonly already hides them via the blocklist; no
  path checks (workspace keeps them usable per decision #4).

## 7. Frontend (dashboard)

- New composable `src/composables/useFileAccessMode.ts`, modeled on
  `useSpcodePlanMode.ts`: `refresh()` (GET), `setMode(mode)` (POST + optimistic
  update), umo built via `buildWebchatUmoDetails`. localStorage caches the
  last choice purely as an optimistic initial value.
- New `src/components/chat/FileAccessModeChip.vue` using the existing
  `SpSegmentedControl` (3 segments: full / readonly / workspace, icons e.g.
  `mdi-lock-open` / `mdi-file-eye-outline` / `mdi-folder-edit`), placed in the
  ChatInput status-row chips stack (`ChatInput.vue` ~lines 31–40) in the slot
  currently held by `SpcodePlanModeChip`, which it **replaces** (readonly is
  plan mode; one control, one source of truth). Always visible (decision #3).
  Tooltip documents the trade-offs: workspace = session workspace + whitelist;
  shell is restricted only in readonly.
- `Chat.vue` `onStreamEnd` refreshes the chip state authoritatively (same
  pattern as the plan chip today).
- Remove `SpcodePlanModeChip.vue`, `useSpcodePlanMode.ts`,
  `useSpcodePlanModeLoad.ts` and their gates/wiring in `ChatInput.vue`
  (`handlePlanModeToggle` etc.).
- i18n: new `fileAccessChip.*` keys in `zh-CN`, `en-US`, `ru-RU`
  `features/chat.json` (the completeness spec enforces parity).
- `StandaloneChat.vue` is out of scope.

## Behavior Matrix

| Tool / surface | full | readonly | workspace |
|---|---|---|---|
| builtin `astrbot_file_read_tool` / grep | ✓ | ✓ | ✓ |
| builtin `astrbot_file_write_tool` / `astrbot_file_edit_tool` (incl. rollback) | ✓ (status quo) | hidden + call-time reject | roots only (workspace + temp + extra + dynamic) |
| builtin `astrbot_upload_file` / `astrbot_download_file` (sandbox runtime) | ✓ | ✓ (unaffected by mode: upload leaves the host FS untouched; download writes only into always-allowed temp dirs) | ✓ |
| builtin `astrbot_execute_shell` / `astrbot_shell_session` | ✓ | hidden + call-time reject | ✓ (unrestricted by design) |
| plugin `astrbot_file_remove` | ✓ (own blacklist + recycle bin) | hidden + call-time reject | roots only + own blacklist stacked |
| plugin `code_format` | ✓ | hidden + call-time reject | roots only |
| plugin `astrbot_inta_shell_*` | ✓ | hidden | ✓ |
| MCP write tools (vivado …) | ✓ | hidden iff listed in `plan_mode_blocked_tools` | unrestricted (cannot path-check) |
| dashboard webapi file ops | unaffected (user-driven, already repo-whitelisted) | idem | idem |
| non-admin restricted users | unchanged read/write roots (union with mode rules) | idem | idem |

## Edge Cases & Security Notes

- **Subagents**: inherit enforcement because tool calls funnel through the
  same `FunctionToolExecutor.execute` → `tool.call` path; the check lives in
  the tool, not in the request assembly.
- **Hard-filter bypass**: if the plugin is disabled or the blocklist misses a
  tool, layer ② still rejects direct file writes in readonly/workspace.
  Shell and MCP remain blocklist-only — documented boundary.
- **Upgraded plugin installs**: the saved plugin config keeps the old
  `plan_mode_blocked_tools` (defaults only apply to fresh installs), so the
  new shell tool entries may be absent; core's call-time shell gate remains
  the readonly backstop in that case.
- **Windows**: `resolve()` + `normcase` both sides; junction/symlink escape
  collapses via resolve. Multi-hard-link rejection
  (`_reject_multi_link_file`) keeps applying in restricted paths.
- **Concurrency**: single value per umo, last write wins (same as plan mode).
- **Restart**: in-memory state resets to the config default.
- **Config profiles**: default mode resolves per-conversation through
  `context.get_config(umo)`.

## Testing

- Core unit tests: mode resolution (override/default/restore), per-mode
  `assert_writable`, roots containment incl. `..` / symlink / case tricks,
  fs.py write tools per mode (admin rejected in readonly; workspace
  in/out of roots), shell readonly rejection, non-admin regression (read
  roots unchanged).
- Plugin: rework existing plan-mode tests to core-mode-driven; new tests for
  worktree dynamic roots and for `astrbot_file_remove` / `code_format`
  guards; webapi shim tests.
- Frontend: chip wiring spec tests alongside existing chat specs; i18n
  completeness spec must stay green.

## Implementation Order

1. Core: `fs_access` module + `fs.py`/`shell.py` enforcement + config keys +
   unit tests.
2. Core: dashboard GET/POST endpoint + openspec yaml + `pnpm generate:api`.
3. Dashboard: `useFileAccessMode` + `FileAccessModeChip` replaces plan chip +
   i18n ×3.
4. Plugin: plan merge (core-mode-driven filter, commands, webapi shim,
   blocklist default +shell tools) + write-tool guards + worktree dynamic
   roots + tests.
