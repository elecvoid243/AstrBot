# Git Squash Commits (压缩提交) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "压缩提交 (Squash)" feature to the GitDiffSidebar History view: select N ≥ 2 HEAD-anchored contiguous commits and squash them into one commit with an edited message.

**Architecture:** New backend endpoint `POST /spcode/git-squash` in `astrbot_plugin_spcode_toolkit` (`git reset --soft <oldest>^` + `git commit -F -`, no rebase). Frontend adds a `useSpcodeGitSquash` composable (clone of `useSpcodeGitRevert`), per-row selection checkboxes + toolbar button in `GitLogView.vue`, a new `GitSquashDialog.vue`, and orchestration in `GitDiffSidebar.vue`.

**Tech Stack:** Python 3.10+ (async subprocess git CLI, pytest), Vue 3 `<script setup>` + Vuetify + TypeScript (vitest).

**Spec:** `docs/superpowers/specs/2026-08-03-git-squash-design.md` (Astrbot repo, commit d2cf63e4d).

## Global Constraints

- Backend repo: `F:\github\astrbot_plugin_spcode_toolkit`. Frontend repo: `F:\github\Astrbot` (branch `all`, local commits only — NEVER push).
- Backend style: Chinese docstrings/comments (matches existing plugin files); author header `elecvoid243 @ 2026-08-03` in new files. Frontend style: English comments (per AGENTS.md); author header `elecvoid243 @ 2026-08-03`.
- All git invocations via `_run_git_async`, list-form args, `shell=True` is forbidden, `-c color.ui=never` on mutating calls, `timeout=30.0` on reset/commit.
- Envelope convention: HTTP always 200; errors via `data.reason`; `stderr` truncated to 4096 bytes; `elapsed_ms` on every response.
- Do NOT modify `_wrap()`, do NOT add webapi-layer auth, do NOT add a frontend parser file (inline parse, `useSpcodeGitRevert` precedent).
- After every frontend task: `cd dashboard && npx vue-tsc --noEmit` must pass. After backend task: `ruff format` + `ruff check` on touched files.
- Conventional commit messages; commit at the end of every task.

---

### Task 1: Backend `POST /spcode/git-squash` endpoint

**Files:**
- Create: `F:\github\astrbot_plugin_spcode_toolkit\tools\webapi\git_squash.py`
- Modify: `F:\github\astrbot_plugin_spcode_toolkit\tools\webapi\_helpers.py` (ReasonCode, near line 426 `OPERATION_IN_PROGRESS`)
- Modify: `F:\github\astrbot_plugin_spcode_toolkit\tools\webapi\__init__.py` (4 spots: import block ~L86, ROUTES ~L184, HANDLERS dict ~L398, `__all__` ~L563)
- Test: `F:\github\astrbot_plugin_spcode_toolkit\tests\test_git_squash.py`

**Interfaces:**
- Consumes: `_git_endpoint_preflight(plugin, umo=..., worktree_param=...)` → `(err|None, ctx|None)` with `ctx["directory"]`/`ctx["umo"]`; `_run_git_async(args, encoding=..., input_text=..., env=..., timeout=...)` → `{"ok", "stdout", "stderr", "code"}`; `_detect_conflict_operation(git_bin, directory)` → `"merge"|"cherry_pick"|"revert"|None`; `_make_envelope(success=..., reason=..., elapsed_ms=..., **fields)`; `_JSONResponseCompat(dict, status_code=200)`; `_build_git_env()` and `_classify_commit_error(stderr, returncode)` from `git_commit.py`; `plugin._git_binary()`.
- Produces: route `POST /spcode/git-squash`; handler `git_squash.handle(plugin, *, umo, worktree, body)`; ReasonCodes `HEAD_NOT_SELECTED` / `NOT_CONTIGUOUS` / `ROOT_COMMIT`. Success data keys: `squashed, new_sha, message, squashed_count, old_head_sha, files_touched, directory, umo, worktree` (frontend Task 2 consumes exactly these).

- [ ] **Step 1: Write the failing test file**

Create `tests/test_git_squash.py`:

```python
"""Tests for POST /spcode/git-squash (2026-08-03).

Spec: docs/superpowers/specs/2026-08-03-git-squash-design.md (Astrbot repo)
Author: elecvoid243 @ 2026-08-03
"""

import asyncio
import os
import subprocess
from pathlib import Path

import pytest

from tests.conftest import _make_plugin  # noqa: F401
from tools.project import state as _state
from tools.webapi._helpers import ReasonCode
from tools.webapi import git_squash


def _run(coro):
    """Sync wrapper for async handler calls(同 test_git_revert.py)。"""
    return asyncio.run(coro)


@pytest.fixture
def squash_repo(tmp_path: Path):
    """4 个 commit 的仓库,注册为已加载项目。Yields (repo_path, umo)。"""
    repo = tmp_path / "squash_repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "T"], check=True)
    for i in range(1, 5):
        (repo / f"file{i}.txt").write_text(f"v{i}", encoding="utf-8")
        subprocess.run(["git", "-C", str(repo), "add", f"file{i}.txt"], check=True)
        subprocess.run(
            ["git", "-C", str(repo), "commit", "-q", "-m", f"commit {i}"],
            check=True,
        )
    umo = "test:git-squash:1"
    _state.put(umo, {"directory": str(repo), "loaded_at": 1.0})
    yield repo, umo
    _state.pop(umo)


def _shas(repo: Path) -> list[str]:
    """全部 commit SHA,新→旧。"""
    out = subprocess.run(
        ["git", "-C", str(repo), "rev-list", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout
    return [line.strip() for line in out.splitlines() if line.strip()]


def _log_subjects(repo: Path) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(repo), "log", "--pretty=%s"],
        capture_output=True, text=True, check=True,
    ).stdout
    return [line.strip() for line in out.splitlines() if line.strip()]


# ── body 校验 (4 cases) ──


def test_squash_body_none(squash_repo):
    _, umo = squash_repo
    plugin = _make_plugin()
    result = _run(git_squash.handle(plugin, umo=umo, body=None))
    assert result["data"]["reason"] == ReasonCode.INVALID_BODY


def test_squash_single_commit_rejected(squash_repo):
    repo, umo = squash_repo
    plugin = _make_plugin()
    result = _run(
        git_squash.handle(
            plugin,
            umo=umo,
            body={"commits": [_shas(repo)[0]], "message": "m"},
        )
    )
    assert result["data"]["reason"] == ReasonCode.INVALID_PARAM


def test_squash_duplicate_commits_rejected(squash_repo):
    repo, umo = squash_repo
    plugin = _make_plugin()
    result = _run(
        git_squash.handle(
            plugin,
            umo=umo,
            body={"commits": [_shas(repo)[0], _shas(repo)[0]], "message": "m"},
        )
    )
    assert result["data"]["reason"] == ReasonCode.INVALID_PARAM


def test_squash_empty_message_rejected(squash_repo):
    repo, umo = squash_repo
    plugin = _make_plugin()
    result = _run(
        git_squash.handle(
            plugin,
            umo=umo,
            body={"commits": _shas(repo)[:2], "message": "   "},
        )
    )
    assert result["data"]["reason"] == ReasonCode.INVALID_MESSAGE


# ── 前置条件 (3 cases) ──


def test_squash_worktree_dirty(squash_repo):
    repo, umo = squash_repo
    (repo / "uncommitted.txt").write_text("x", encoding="utf-8")
    plugin = _make_plugin()
    result = _run(
        git_squash.handle(
            plugin, umo=umo, body={"commits": _shas(repo)[:2], "message": "m"}
        )
    )
    assert result["data"]["reason"] == ReasonCode.WORKTREE_DIRTY


def test_squash_commit_not_found(squash_repo):
    repo, umo = squash_repo
    plugin = _make_plugin()
    result = _run(
        git_squash.handle(
            plugin,
            umo=umo,
            body={"commits": [_shas(repo)[0], "no-such-ref"], "message": "m"},
        )
    )
    assert result["data"]["reason"] == ReasonCode.COMMIT_NOT_FOUND


def test_squash_no_project_loaded():
    plugin = _make_plugin()
    result = _run(
        git_squash.handle(plugin, body={"commits": ["a", "b"], "message": "m"})
    )
    assert result["data"]["reason"] == ReasonCode.NO_PROJECT_LOADED


# ── 连续性校验 (3 cases) ──


def test_squash_head_not_selected(squash_repo):
    repo, umo = squash_repo
    shas = _shas(repo)
    plugin = _make_plugin()
    result = _run(
        git_squash.handle(
            plugin,
            umo=umo,
            body={"commits": [shas[1], shas[2]], "message": "m"},
        )
    )
    assert result["data"]["reason"] == ReasonCode.HEAD_NOT_SELECTED


def test_squash_not_contiguous(squash_repo):
    repo, umo = squash_repo
    shas = _shas(repo)
    plugin = _make_plugin()
    result = _run(
        git_squash.handle(
            plugin,
            umo=umo,
            body={"commits": [shas[0], shas[2]], "message": "m"},
        )
    )
    assert result["data"]["reason"] == ReasonCode.NOT_CONTIGUOUS


def test_squash_root_commit_rejected(squash_repo):
    repo, umo = squash_repo
    plugin = _make_plugin()
    result = _run(
        git_squash.handle(
            plugin,
            umo=umo,
            body={"commits": _shas(repo), "message": "m"},  # 全部 4 条
        )
    )
    assert result["data"]["reason"] == ReasonCode.ROOT_COMMIT


# ── happy path (3 cases) ──


def test_squash_top_two(squash_repo):
    """压缩顶部 2 条(乱序传入)→ 4 commits 变 3,树内容不变。"""
    repo, umo = squash_repo
    shas = _shas(repo)
    plugin = _make_plugin()
    result = _run(
        git_squash.handle(
            plugin,
            umo=umo,
            # 故意乱序 + 打乱大小写习惯(short sha 见下一 case)
            body={"commits": [shas[1], shas[0]], "message": "combined"},
        )
    )
    data = result["data"]
    assert data["squashed"] is True
    assert data["squashed_count"] == 2
    assert data["old_head_sha"] == shas[0]
    assert len(data["new_sha"]) == 40
    assert data["message"] == "combined"
    assert "file4.txt" in data["files_touched"]
    # 历史:combined, commit 2, commit 1
    assert _log_subjects(repo) == ["combined", "commit 2", "commit 1"]
    # 树内容不变
    assert (repo / "file4.txt").read_text(encoding="utf-8") == "v4"


def test_squash_short_shas_accepted(squash_repo):
    """short sha 输入在集合比较前被解析为完整 SHA。"""
    repo, umo = squash_repo
    shas = _shas(repo)
    plugin = _make_plugin()
    result = _run(
        git_squash.handle(
            plugin,
            umo=umo,
            body={"commits": [shas[0][:7], shas[1][:7]], "message": "m"},
        )
    )
    assert result["data"]["squashed"] is True


def test_squash_multiline_message_preserved(squash_repo):
    repo, umo = squash_repo
    plugin = _make_plugin()
    result = _run(
        git_squash.handle(
            plugin,
            umo=umo,
            body={
                "commits": _shas(repo)[:3],
                "message": "combined\n\nbody text",
            },
        )
    )
    assert result["data"]["squashed"] is True
    body = subprocess.run(
        ["git", "-C", str(repo), "log", "-1", "--pretty=%B"],
        capture_output=True, text=True, check=True,
    ).stdout
    assert "combined" in body
    assert "body text" in body
    assert _log_subjects(repo) == ["combined", "commit 1"]


# ── hook 失败中间态 (1 case) ──


def test_squash_hook_failure_keeps_staged_changes(squash_repo):
    """pre-commit hook 拒绝:reset --soft 已生效,HEAD 在 oldest^,
    改动保留在暂存区(用户可手动补提交)。"""
    repo, umo = squash_repo
    hook = repo / ".git" / "hooks" / "pre-commit"
    hook.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
    if os.name != "nt":
        os.chmod(hook, 0o755)
    plugin = _make_plugin()
    result = _run(
        git_squash.handle(
            plugin,
            umo=umo,
            body={"commits": _shas(repo)[:2], "message": "m"},
        )
    )
    # 分类器未必能识别 hook 输出(git 不回显 "pre-commit hook" 字样),
    # 接受 hook_rejected 或 git_error;状态断言才是本 case 的重点。
    assert result["data"]["reason"] in (
        ReasonCode.HOOK_REJECTED,
        ReasonCode.GIT_ERROR,
    )
    assert result["data"]["squashed"] is False
    # HEAD 已移动到 commit 3(oldest^)
    assert _log_subjects(repo) == ["commit 3", "commit 2", "commit 1"]
    # file4.txt 的改动仍在暂存区
    status = subprocess.run(
        ["git", "-C", str(repo), "status", "--porcelain"],
        capture_output=True, text=True, check=True,
    ).stdout
    assert "A  file4.txt" in status
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d F:\github\astrbot_plugin_spcode_toolkit && python -m pytest tests/test_git_squash.py -x -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'tools.webapi.git_squash'` during collection.

- [ ] **Step 3: Add the ReasonCode constants**

In `tools/webapi/_helpers.py`, inside `class ReasonCode`, immediately after the line `OPERATION_IN_PROGRESS = "operation_in_progress"` (≈ line 426, in the v2.22.0 conflict-lifecycle group), insert:

```python
    # git-squash (2026-08-03): HEAD 锚定连续压缩的校验失败
    HEAD_NOT_SELECTED = "head_not_selected"  # 选区不含 HEAD
    NOT_CONTIGUOUS = "not_contiguous"  # 选区不是 HEAD 起连续 N 条
    ROOT_COMMIT = "root_commit"  # 最老一条是 root commit(无 parent)
```

- [ ] **Step 4: Create the handler `tools/webapi/git_squash.py`**

```python
"""POST /spcode/git-squash — 压缩 HEAD 起连续 N 条 commit 为一条。

Spec: docs/superpowers/specs/2026-08-03-git-squash-design.md (Astrbot 仓库)
Author: elecvoid243 @ 2026-08-03

策略(spec decision #5): ``git reset --soft <oldest>^`` + ``git commit -F -``。
不调 rebase —— 零冲突、无 in-progress 状态机、跨平台 100% 兼容。

连续性权威校验(spec decision #6): ``git rev-list HEAD -n <count>`` 的结果
集合必须与选区集合完全相等(隐含"含 HEAD 且连续")。

复用 ``tools/webapi/git_commit.py``:
- ``_build_git_env()``:透传 ``GIT_AUTHOR_*`` 环境变量
- ``_classify_commit_error()``:hook / identity / nothing / git_error 分类
"""

from __future__ import annotations

import logging
import time as _time
from typing import TYPE_CHECKING

from ._helpers import (
    _detect_conflict_operation,
    _git_endpoint_preflight,
    _JSONResponseCompat,
    _make_envelope,
    _run_git_async,
    ReasonCode,
)
from .git_commit import _build_git_env, _classify_commit_error

if TYPE_CHECKING:
    from main import SPCodeToolkit

logger = logging.getLogger(__name__)

COMMIT_TRUNCATE_BYTES = 4096
MAX_MESSAGE_LENGTH = 8192  # 与 git_commit.py 一致
MAX_SQUASH_COMMITS = 100  # 防御性上限


async def handle(
    plugin: "SPCodeToolkit",
    *,
    umo: str | None = None,
    worktree: str | None = None,
    body: dict | None = None,
) -> dict:
    """POST /spcode/git-squash handler.

    Body (JSON): ``{"commits": ["<sha>", ...], "message": "..."}``。
    commits ≥ 2 条(可乱序、可 short sha);message 非空。
    """
    t0 = _time.time()

    def _elapsed() -> int:
        return int((_time.time() - t0) * 1000)

    # ── 1. body 校验 ──
    if not isinstance(body, dict):
        return _make_envelope(
            success=False,
            reason=ReasonCode.INVALID_BODY,
            elapsed_ms=_elapsed(),
            squashed=False,
        )

    commits_raw = body.get("commits")
    message = body.get("message")

    if (
        not isinstance(commits_raw, list)
        or len(commits_raw) < 2
        or len(commits_raw) > MAX_SQUASH_COMMITS
        or any(not isinstance(c, str) or not c.strip() for c in commits_raw)
    ):
        return _make_envelope(
            success=False,
            reason=ReasonCode.INVALID_PARAM,
            elapsed_ms=_elapsed(),
            squashed=False,
            stderr="commits must be a list of 2..100 non-empty sha strings",
        )
    if (
        not isinstance(message, str)
        or not message.strip()
        or len(message) > MAX_MESSAGE_LENGTH
    ):
        return _make_envelope(
            success=False,
            reason=ReasonCode.INVALID_MESSAGE,
            elapsed_ms=_elapsed(),
            squashed=False,
            stderr="message must be a non-empty string (<= 8192 chars)",
        )

    commits = [c.strip() for c in commits_raw]

    # ── 2. preflight ──
    err, ctx = await _git_endpoint_preflight(plugin, umo=umo, worktree_param=worktree)
    if err is not None:
        err["data"]["elapsed_ms"] = _elapsed()
        err["data"].setdefault("squashed", False)
        return err
    directory = ctx["directory"]
    effective_umo = ctx["umo"]
    git_bin = plugin._git_binary()

    def _fail(reason: str, stderr: str = "") -> dict:
        return _make_envelope(
            success=False,
            reason=reason,
            elapsed_ms=_elapsed(),
            squashed=False,
            directory=directory,
            umo=effective_umo,
            worktree=directory,
            stderr=stderr[:COMMIT_TRUNCATE_BYTES],
        )

    # ── 3. 已有 merge/cherry-pick/revert 冲突进行中 → 拒绝 ──
    in_progress = await _detect_conflict_operation(git_bin, directory)
    if in_progress is not None:
        return _fail(
            ReasonCode.OPERATION_IN_PROGRESS,
            f"{in_progress} already in progress",
        )

    # ── 4. 工作区必须干净(spec decision #3) ──
    status_result = await _run_git_async(
        [git_bin, "-C", directory, "status", "--porcelain"],
        encoding="utf-8",
    )
    if not status_result.get("ok"):
        stderr_msg = status_result.get("stderr", "") or status_result.get("error", "")
        if "does not have any commits" in stderr_msg or "no commits" in stderr_msg:
            return _fail(ReasonCode.EMPTY_REPOSITORY, stderr_msg)
        return _fail(ReasonCode.GIT_ERROR, stderr_msg)
    if status_result["stdout"].strip():
        return _fail(ReasonCode.WORKTREE_DIRTY, "working tree has uncommitted changes")

    # ── 5. 逐个解析选区 sha → 完整 commit SHA(short sha / tag 兼容) ──
    resolved: list[str] = []
    for c in commits:
        r = await _run_git_async(
            [git_bin, "-C", directory, "rev-parse", "--verify", f"{c}^{{commit}}"],
            encoding="utf-8",
        )
        if not r.get("ok"):
            return _fail(
                ReasonCode.COMMIT_NOT_FOUND,
                f"cannot resolve commit: {c}\n{r.get('stderr', '')}",
            )
        resolved.append(r["stdout"].strip())
    # 去重(保序);去重后不足 2 条 → invalid_param
    resolved = list(dict.fromkeys(resolved))
    if len(resolved) < 2:
        return _fail(ReasonCode.INVALID_PARAM, "commits contain duplicate entries")

    # ── 6. 记录旧 HEAD(响应字段 + 排障) ──
    head_result = await _run_git_async(
        [git_bin, "-C", directory, "rev-parse", "HEAD"],
        encoding="utf-8",
    )
    if not head_result.get("ok"):
        return _fail(ReasonCode.GIT_ERROR, head_result.get("stderr", ""))
    old_head_sha = head_result["stdout"].strip()

    # ── 7. 连续性权威校验:选区集合 == rev-list HEAD -n N ──
    revlist = await _run_git_async(
        [git_bin, "-C", directory, "rev-list", "HEAD", "-n", str(len(resolved))],
        encoding="utf-8",
    )
    if not revlist.get("ok"):
        return _fail(ReasonCode.NOT_CONTIGUOUS, revlist.get("stderr", ""))
    top_shas = [
        line.strip() for line in revlist["stdout"].splitlines() if line.strip()
    ]
    if len(top_shas) < len(resolved):
        return _fail(
            ReasonCode.NOT_CONTIGUOUS,
            "repository has fewer commits than the selection",
        )
    selected_set = set(resolved)
    if old_head_sha not in selected_set:
        return _fail(
            ReasonCode.HEAD_NOT_SELECTED,
            "HEAD must be included in the selection",
        )
    if set(top_shas) != selected_set:
        return _fail(
            ReasonCode.NOT_CONTIGUOUS,
            "selected commits are not a contiguous range from HEAD",
        )
    oldest = top_shas[-1]  # rev-list 输出新→旧,最后一行即最老

    # ── 8. 最老一条必须有 parent(root commit 无法 reset --soft <oldest>^) ──
    parent = await _run_git_async(
        [git_bin, "-C", directory, "rev-parse", "--verify", f"{oldest}^"],
        encoding="utf-8",
    )
    if not parent.get("ok"):
        return _fail(ReasonCode.ROOT_COMMIT, "squashing the root commit is not supported")
    base = parent["stdout"].strip()

    # ── 9. reset --soft:HEAD 移回 oldest^,N 条 commit 的改动回 staged ──
    reset = await _run_git_async(
        [git_bin, "-C", directory, "-c", "color.ui=never", "reset", "--soft", base],
        encoding="utf-8",
        timeout=30.0,
    )
    if not reset.get("ok"):
        return _fail(ReasonCode.GIT_ERROR, reset.get("stderr", ""))

    # ── 10. commit(stdin 传 message,透传身份,不带 --no-verify) ──
    commit = await _run_git_async(
        [git_bin, "-C", directory, "-c", "color.ui=never", "commit", "-F", "-"],
        encoding="utf-8",
        input_text=message,
        env=_build_git_env(),
        timeout=30.0,
    )
    if not commit.get("ok"):
        stderr = commit.get("stderr", "") or commit.get("error", "")
        reason = _classify_commit_error(stderr, commit.get("code", 1))
        logger.info("git-squash: commit step failed (%s): %s", reason, stderr[:200])
        # 注意:此时 HEAD 已在 oldest^、改动在暂存区(spec §5 hook 失败中间态)
        return _fail(reason, stderr)

    # ── 11. 回读新 commit ──
    sha_result = await _run_git_async(
        [git_bin, "-C", directory, "rev-parse", "HEAD"],
        encoding="utf-8",
    )
    new_sha = sha_result["stdout"].strip() if sha_result.get("ok") else ""

    msg_result = await _run_git_async(
        [git_bin, "-C", directory, "log", "-1", "--pretty=%s", "HEAD"],
        encoding="utf-8",
    )
    new_message = msg_result["stdout"].strip() if msg_result.get("ok") else ""

    files_result = await _run_git_async(
        [git_bin, "-C", directory, "show", "--name-only", "--pretty=", "HEAD"],
        encoding="utf-8",
    )
    files_touched = (
        [
            line.strip()
            for line in (files_result.get("stdout", "")).splitlines()
            if line.strip()
        ]
        if files_result.get("ok")
        else []
    )

    logger.info(
        "git-squash: %d commits → %s (umo=%s)",
        len(resolved),
        new_sha[:12],
        effective_umo,
    )
    return _JSONResponseCompat(
        _make_envelope(
            success=True,
            elapsed_ms=_elapsed(),
            squashed=True,
            new_sha=new_sha,
            message=new_message,
            squashed_count=len(resolved),
            old_head_sha=old_head_sha,
            files_touched=files_touched,
            directory=directory,
            umo=effective_umo,
            worktree=directory,
        ),
        status_code=200,
    )
```

- [ ] **Step 5: Register the route (4 edits in `tools/webapi/__init__.py`)**

Edit 1 — import block: after the line `    git_show,` (≈ L87) insert:

```python
    git_squash,  # 2026-08-03 - POST git-squash (HEAD 锚定连续压缩)
```

Edit 2 — ROUTES: immediately after the git-revert ROUTES tuple (the block ending `"git revert <ref> --no-edit (自动生成回滚 commit)",\n    ),` ≈ L184) insert:

```python
    (
        "/spcode/git-squash",  # 2026-08-03
        ["POST"],
        git_squash.handle,
        "git reset --soft <oldest>^ + commit (压缩 HEAD 起连续 N 条提交)",
    ),
```

Edit 3 — HANDLERS dict: after the line `    "handle_post_git_revert": git_revert.handle,  # v2.17.0 (2026-07-16)` (≈ L398) insert:

```python
    "handle_post_git_squash": git_squash.handle,  # 2026-08-03
```

Edit 4 — `__all__`: after the line `    "git_show",` (≈ L564) insert:

```python
    "git_squash",  # 2026-08-03
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /d F:\github\astrbot_plugin_spcode_toolkit && python -m pytest tests/test_git_squash.py -q`
Expected: PASS — 16 passed. (If the hook test fails on the staged-status assertion, inspect `git status --porcelain` output manually in a scratch repo; do NOT relax the assertion without understanding why.)

- [ ] **Step 7: Regression-run the neighboring git endpoint tests**

Run: `cd /d F:\github\astrbot_plugin_spcode_toolkit && python -m pytest tests/test_git_revert.py tests/test_git_commit.py -q`
Expected: all PASS (shared `_helpers.py` change is additive only).

- [ ] **Step 8: Lint and format**

Run: `cd /d F:\github\astrbot_plugin_spcode_toolkit && ruff format tools/webapi/git_squash.py tests/test_git_squash.py && ruff check tools/webapi/git_squash.py tests/test_git_squash.py tools/webapi/_helpers.py tools/webapi/__init__.py`
Expected: no findings (re-run pytest after any format change).

- [ ] **Step 9: Commit**

```bash
cd /d F:\github\astrbot_plugin_spcode_toolkit
git add tools/webapi/git_squash.py tools/webapi/_helpers.py tools/webapi/__init__.py tests/test_git_squash.py
git commit -m "feat(webapi): add POST /spcode/git-squash endpoint (HEAD-anchored contiguous squash)"
```

---

### Task 2: Frontend `useSpcodeGitSquash` composable

**Files:**
- Create: `F:\github\Astrbot\dashboard\src\composables\useSpcodeGitSquash.ts`
- Test: `F:\github\Astrbot\dashboard\src\composables\__tests__\useSpcodeGitSquash.spec.ts`

**Interfaces:**
- Consumes: `pluginExtensionApi.post` from `@/api/v1`; backend Task 1's response (`new_sha`, `message`, `squashed_count`, `old_head_sha`, `files_touched`, `reason`, `stderr`).
- Produces (Task 5 relies on these exact names):

```ts
export interface UseSpcodeGitSquash {
  isSquashing: import("vue").Ref<boolean>;
  squash: (params: SquashParams) => Promise<SquashResult>;
  dispose: () => void;
}
export interface SquashParams {
  shas: string[];
  message: string;
  worktree?: string | null;
  umo?: string | null;
}
export interface SquashSnapshot {
  newSha: string;
  message: string;
  squashedCount: number;
  oldHeadSha: string;
  filesTouched: string[];
}
export type SquashResult =
  | { ok: true; snapshot: SquashSnapshot }
  | { ok: false; reason: string; stderr?: string };
```

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/composables/__tests__/useSpcodeGitSquash.spec.ts`:

```ts
// Author: elecvoid243 @ 2026-08-03
// Spec: docs/superpowers/specs/2026-08-03-git-squash-design.md §4.1
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

const mockPost = vi.fn();
vi.mock("@/api/v1", () => ({
  pluginExtensionApi: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import { useSpcodeGitSquash } from "../useSpcodeGitSquash";

function withSetup<T>(fn: () => T): T {
  let result: T;
  const Comp = defineComponent({
    setup() {
      result = fn();
      return () => h("div");
    },
  });
  mount(Comp);
  return result!;
}

describe("useSpcodeGitSquash", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("squash() posts snake_case body and parses success", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          squashed: true,
          new_sha: "a".repeat(40),
          message: "combined",
          squashed_count: 2,
          old_head_sha: "b".repeat(40),
          files_touched: ["a.ts"],
          reason: null,
          stderr: "",
          elapsed_ms: 5,
        },
      },
    });
    const { squash, isSquashing } = withSetup(() => useSpcodeGitSquash());
    const p = squash({
      shas: ["c".repeat(40), "d".repeat(40)],
      message: "combined",
      worktree: "D:/repo",
      umo: "umo-test",
    });
    expect(isSquashing.value).toBe(true);
    const r = await p;
    expect(isSquashing.value).toBe(false);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.newSha).toBe("a".repeat(40));
      expect(r.snapshot.message).toBe("combined");
      expect(r.snapshot.squashedCount).toBe(2);
      expect(r.snapshot.oldHeadSha).toBe("b".repeat(40));
      expect(r.snapshot.filesTouched).toEqual(["a.ts"]);
    }
    const [endpoint, body] = mockPost.mock.calls[0];
    expect(endpoint).toBe("spcode/git-squash");
    expect(body).toEqual({
      commits: ["c".repeat(40), "d".repeat(40)],
      message: "combined",
      worktree: "D:/repo",
      umo: "umo-test",
    });
  });

  it("omits worktree/umo from the body when nullish", async () => {
    mockPost.mockResolvedValueOnce({
      data: { data: { squashed: false, reason: "worktree_dirty" } },
    });
    const { squash } = withSetup(() => useSpcodeGitSquash());
    await squash({ shas: ["a", "b"], message: "m" });
    const [, body] = mockPost.mock.calls[0];
    expect(body).not.toHaveProperty("worktree");
    expect(body).not.toHaveProperty("umo");
  });

  it("passes failure reason + stderr through", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        data: {
          squashed: false,
          reason: "not_contiguous",
          stderr: "selected commits are not a contiguous range from HEAD",
        },
      },
    });
    const { squash } = withSetup(() => useSpcodeGitSquash());
    const r = await squash({ shas: ["a", "b"], message: "m", umo: "u" });
    expect(r).toEqual({
      ok: false,
      reason: "not_contiguous",
      stderr: "selected commits are not a contiguous range from HEAD",
    });
  });

  it("maps network errors to 'network'", async () => {
    mockPost.mockRejectedValueOnce({
      code: "ERR_NETWORK",
      message: "Network Error",
    });
    const { squash } = withSetup(() => useSpcodeGitSquash());
    const r = await squash({ shas: ["a", "b"], message: "m", umo: "u" });
    expect(r).toEqual({ ok: false, reason: "network" });
  });

  it("dispose() makes subsequent calls return 'aborted'", async () => {
    const { squash, dispose } = withSetup(() => useSpcodeGitSquash());
    dispose();
    const r = await squash({ shas: ["a", "b"], message: "m", umo: "u" });
    expect(r).toEqual({ ok: false, reason: "aborted" });
    expect(mockPost).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /d F:\github\Astrbot\dashboard && npx vitest run src/composables/__tests__/useSpcodeGitSquash.spec.ts`
Expected: FAIL — `Failed to resolve import "../useSpcodeGitSquash"`.

- [ ] **Step 3: Implement the composable**

Create `dashboard/src/composables/useSpcodeGitSquash.ts`:

```ts
// Author: elecvoid243
// Date: 2026-08-03
// Spec: docs/superpowers/specs/2026-08-03-git-squash-design.md §4.1
//
// Vue composable wrapping POST /spcode/git-squash. Lifecycle mirrors
// useSpcodeGitRevert.ts: a single in-flight call (the user confirms
// one squash at a time from the History view), one boolean state
// surface, abort-on-reentry, dispose on unmount. The envelope is
// shallow, so parsing stays inline (same precedent as revert — no
// dedicated parser file).
//
// The endpoint runs `git reset --soft <oldest>^` + `git commit -F -`:
// it REWRITES history (the selected commits disappear), is
// non-idempotent, and requires a clean worktree server-side.

import { ref } from "vue";
import { pluginExtensionApi } from "@/api/v1";

export interface UseSpcodeGitSquash {
  isSquashing: import("vue").Ref<boolean>;
  squash: (params: SquashParams) => Promise<SquashResult>;
  dispose: () => void;
}

export interface SquashParams {
  /** Full SHAs of the selected commits (any order; the backend
   *  authoritatively validates HEAD-anchored contiguity). */
  shas: string[];
  /** Final commit message (already trimmed by the dialog). */
  message: string;
  worktree?: string | null;
  umo?: string | null;
}

export interface SquashSnapshot {
  /** Full SHA of the newly created squashed commit ("" if re-read failed). */
  newSha: string;
  /** Subject line of the new commit. */
  message: string;
  /** How many commits were squashed. */
  squashedCount: number;
  /** HEAD before the rewrite (for diagnostics). */
  oldHeadSha: string;
  /** Repo-relative files touched by the new commit. */
  filesTouched: string[];
}

export type SquashResult =
  | { ok: true; snapshot: SquashSnapshot }
  | { ok: false; reason: string; stderr?: string };

export function useSpcodeGitSquash(): UseSpcodeGitSquash {
  const isSquashing = ref(false);
  let abortController: AbortController | null = null;
  let isMounted = true;

  async function squash(params: SquashParams): Promise<SquashResult> {
    if (!isMounted) return { ok: false, reason: "aborted" };
    abortController?.abort();
    abortController = new AbortController();
    isSquashing.value = true;
    try {
      const resp = await pluginExtensionApi.post<unknown>(
        "spcode/git-squash",
        {
          commits: params.shas,
          message: params.message,
          ...(params.worktree ? { worktree: params.worktree } : {}),
          ...(params.umo ? { umo: params.umo } : {}),
        },
        { signal: abortController.signal },
      );
      if (!isMounted) return { ok: false, reason: "aborted" };
      const data = (
        resp.data as {
          data?: {
            squashed?: boolean;
            reason?: string | null;
            stderr?: string;
            new_sha?: string;
            message?: string;
            squashed_count?: number;
            old_head_sha?: string;
            files_touched?: unknown;
          };
        }
      )?.data;
      if (data && data.reason == null && data.squashed === true) {
        return {
          ok: true,
          snapshot: {
            newSha: typeof data.new_sha === "string" ? data.new_sha : "",
            message: typeof data.message === "string" ? data.message : "",
            squashedCount:
              typeof data.squashed_count === "number" ? data.squashed_count : 0,
            oldHeadSha:
              typeof data.old_head_sha === "string" ? data.old_head_sha : "",
            filesTouched: Array.isArray(data.files_touched)
              ? data.files_touched.filter(
                  (f): f is string => typeof f === "string",
                )
              : [],
          },
        };
      }
      // Failure envelope: reason is guaranteed on every failure path.
      return {
        ok: false,
        reason:
          typeof data?.reason === "string" && data.reason
            ? data.reason
            : "unknown",
        stderr:
          typeof data?.stderr === "string" && data.stderr
            ? data.stderr
            : undefined,
      };
    } catch (err) {
      if (!isMounted) return { ok: false, reason: "aborted" };
      if ((err as { name?: string })?.name === "CanceledError") {
        return { ok: false, reason: "aborted" };
      }
      const anyErr = err as { code?: string; message?: string };
      if (
        anyErr.code === "ERR_NETWORK" ||
        /network/i.test(anyErr.message ?? "")
      ) {
        return { ok: false, reason: "network" };
      }
      return { ok: false, reason: "unknown" };
    } finally {
      if (isSquashing.value && isMounted) isSquashing.value = false;
    }
  }

  function dispose(): void {
    isMounted = false;
    abortController?.abort();
    abortController = null;
  }

  return { isSquashing, squash, dispose };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /d F:\github\Astrbot\dashboard && npx vitest run src/composables/__tests__/useSpcodeGitSquash.spec.ts`
Expected: PASS — 5 passed.

- [ ] **Step 5: Typecheck**

Run: `cd /d F:\github\Astrbot\dashboard && npx vue-tsc --noEmit`
Expected: exit code 0, no output.

- [ ] **Step 6: Commit**

```bash
cd /d F:\github\Astrbot
git add dashboard/src/composables/useSpcodeGitSquash.ts dashboard/src/composables/__tests__/useSpcodeGitSquash.spec.ts
git commit -m "feat(dashboard): add useSpcodeGitSquash composable"
```

---

### Task 3: i18n keys (3 locales) + `GitSquashDialog.vue`

**Files:**
- Modify: `F:\github\Astrbot\dashboard\src\i18n\locales\zh-CN\features\chat.json` (insert after the `cherryPick` object, ≈ L745)
- Modify: `F:\github\Astrbot\dashboard\src\i18n\locales\en-US\features\chat.json` (same relative spot)
- Modify: `F:\github\Astrbot\dashboard\src\i18n\locales\ru-RU\features\chat.json` (same relative spot)
- Create: `F:\github\Astrbot\dashboard\src\components\chat\GitSquashDialog.vue`

**Interfaces:**
- Consumes: nothing from other tasks (Vuetify + `useModuleI18n("features/chat")` only).
- Produces (Task 5 relies on these exact names): component `GitSquashDialog` with props `{ modelValue: boolean; commits: { sha: string; subject: string }[]; loading: boolean }` and events `(e: "update:modelValue", v: boolean)`, `(e: "submit", p: { shas: string[]; message: string })`. i18n namespace `spcodeProjectLoad.diffSidebar.squash.*` (Task 4 also uses `toolbar`, `toolbarAria`, `selectionHint`, `rowSelectTitle`, `rowSelectAria`; Task 5 uses `success` + `error.*`).

- [ ] **Step 1: Add the zh-CN keys**

In `zh-CN/features/chat.json`, inside `spcodeProjectLoad.diffSidebar`, immediately after the closing `}` of the `"cherryPick"` object (keep JSON valid — add a comma after the cherryPick block's closing brace), insert:

```json
      "squash": {
        "toolbar": "压缩提交",
        "toolbarAria": "将选中的连续提交压缩为一个",
        "selectionHint": "仅支持从最新提交起连续选择（至少 2 条）",
        "rowSelectTitle": "选中以压缩",
        "rowSelectAria": "选中提交 {sha} 以压缩",
        "dialogTitle": "压缩提交",
        "messageLabel": "提交信息",
        "messageRequired": "请输入提交信息",
        "historyRewriteWarning": "压缩会改写历史：已推送的提交需要 force push 才能同步到远端。",
        "submit": "压缩",
        "cancel": "取消",
        "success": "已压缩为 {sha}",
        "error": {
          "invalid_body": "请求格式错误",
          "invalid_param": "请选择 2 条以上互不重复的提交",
          "invalid_message": "提交信息不能为空或超过 8192 字符",
          "head_not_selected": "选区必须包含最新提交（HEAD）",
          "not_contiguous": "只能选择从最新提交起连续的一段",
          "root_commit": "不支持压缩仓库的初始提交",
          "worktree_dirty": "工作区有未提交改动，请先 commit 或 stash",
          "operation_in_progress": "已有合并 / cherry-pick / revert 冲突正在进行，请先处理",
          "commit_not_found": "无法解析选中的提交",
          "hook_rejected": "提交被 hook 拒绝（改动仍保留在暂存区，可手动补提交）",
          "identity_not_set": "未配置 git user.name / user.email",
          "nothing_to_commit": "没有可提交的改动",
          "git_error": "压缩失败",
          "network": "网络错误，请重试",
          "unknown": "未知错误"
        }
      },
```

- [ ] **Step 2: Add the en-US keys**

Same position in `en-US/features/chat.json`:

```json
      "squash": {
        "toolbar": "Squash",
        "toolbarAria": "Squash the selected contiguous commits into one",
        "selectionHint": "Select a contiguous range starting from the latest commit (at least 2)",
        "rowSelectTitle": "Select for squash",
        "rowSelectAria": "Select commit {sha} for squash",
        "dialogTitle": "Squash commits",
        "messageLabel": "Commit message",
        "messageRequired": "Please enter a commit message",
        "historyRewriteWarning": "Squashing rewrites history: commits already pushed will need a force push to sync the remote.",
        "submit": "Squash",
        "cancel": "Cancel",
        "success": "Squashed into {sha}",
        "error": {
          "invalid_body": "Malformed request",
          "invalid_param": "Select at least 2 distinct commits",
          "invalid_message": "Commit message is empty or exceeds 8192 characters",
          "head_not_selected": "The selection must include the latest commit (HEAD)",
          "not_contiguous": "Only a contiguous range starting from the latest commit can be squashed",
          "root_commit": "Squashing the repository's root commit is not supported",
          "worktree_dirty": "Uncommitted changes present — commit or stash first",
          "operation_in_progress": "A merge / cherry-pick / revert conflict is already in progress — resolve it first",
          "commit_not_found": "Could not resolve the selected commits",
          "hook_rejected": "Commit rejected by a hook (changes remain staged — you can commit manually)",
          "identity_not_set": "git user.name / user.email is not configured",
          "nothing_to_commit": "Nothing to commit",
          "git_error": "Squash failed",
          "network": "Network error — please retry",
          "unknown": "Unknown error"
        }
      },
```

- [ ] **Step 3: Add the ru-RU keys**

Same position in `ru-RU/features/chat.json`:

```json
      "squash": {
        "toolbar": "Сжать",
        "toolbarAria": "Сжать выбранные последовательные коммиты в один",
        "selectionHint": "Выберите непрерывный диапазон от последнего коммита (минимум 2)",
        "rowSelectTitle": "Выбрать для сжатия",
        "rowSelectAria": "Выбрать коммит {sha} для сжатия",
        "dialogTitle": "Сжатие коммитов",
        "messageLabel": "Сообщение коммита",
        "messageRequired": "Введите сообщение коммита",
        "historyRewriteWarning": "Сжатие переписывает историю: уже отправленные коммиты потребуют force push для синхронизации.",
        "submit": "Сжать",
        "cancel": "Отмена",
        "success": "Сжато в {sha}",
        "error": {
          "invalid_body": "Некорректный запрос",
          "invalid_param": "Выберите минимум 2 разных коммита",
          "invalid_message": "Сообщение пустое или длиннее 8192 символов",
          "head_not_selected": "Выбор должен включать последний коммит (HEAD)",
          "not_contiguous": "Можно сжимать только непрерывный диапазон от последнего коммита",
          "root_commit": "Сжатие корневого коммита репозитория не поддерживается",
          "worktree_dirty": "Есть незафиксированные изменения — сначала commit или stash",
          "operation_in_progress": "Уже идёт merge / cherry-pick / revert — сначала завершите его",
          "commit_not_found": "Не удалось распознать выбранные коммиты",
          "hook_rejected": "Коммит отклонён хуком (изменения остались в индексе — можно закоммитить вручную)",
          "identity_not_set": "Не настроены git user.name / user.email",
          "nothing_to_commit": "Нечего коммитить",
          "git_error": "Сжатие не удалось",
          "network": "Ошибка сети — повторите попытку",
          "unknown": "Неизвестная ошибка"
        }
      },
```

- [ ] **Step 4: Validate the JSON files parse**

Run: `cd /d F:\github\Astrbot\dashboard && node -e "for (const l of ['zh-CN','en-US','ru-RU']) { const j = require('./src/i18n/locales/' + l + '/features/chat.json'); if (!j.spcodeProjectLoad.diffSidebar.squash) throw new Error(l + ' missing squash'); } console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 5: Create `GitSquashDialog.vue`**

```vue
<!-- Author: elecvoid243 @ 2026-08-03
     Spec: docs/superpowers/specs/2026-08-03-git-squash-design.md §4.3
     Squash dialog: lists the selected commits (oldest → newest) with an
     editable message pre-filled with the concatenated subjects. Cloned
     from GitCherryPickDialog.vue (v-model + loading + submit pattern). -->
<template>
  <v-dialog
    :model-value="modelValue"
    persistent
    max-width="520"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">
        {{ tm("spcodeProjectLoad.diffSidebar.squash.dialogTitle") }}
      </v-card-title>
      <v-card-text class="pt-4">
        <div class="git-squash-dialog-list">
          <div
            v-for="c in commits"
            :key="c.sha"
            class="git-squash-dialog-item"
          >
            <span class="git-squash-dialog-sha">{{ c.sha.slice(0, 7) }}</span>
            <span class="git-squash-dialog-subject">{{ c.subject }}</span>
          </div>
        </div>
        <v-textarea
          v-model="messageInput"
          :label="tm('spcodeProjectLoad.diffSidebar.squash.messageLabel')"
          :error-messages="messageError ? [messageError] : []"
          density="compact"
          variant="outlined"
          rows="4"
          auto-grow
          autocomplete="off"
          name="git-squash-message"
          class="mt-3"
        />
        <div class="git-squash-dialog-warning">
          {{
            tm("spcodeProjectLoad.diffSidebar.squash.historyRewriteWarning")
          }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="loading"
          @click="emit('update:modelValue', false)"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.squash.cancel") }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :loading="loading"
          @click="onSubmit"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.squash.submit") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";

const props = defineProps<{
  modelValue: boolean;
  /** Selected commits, oldest → newest (drives both the list and the
   *  message pre-fill). */
  commits: { sha: string; subject: string }[];
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "submit", p: { shas: string[]; message: string }): void;
}>();

const { tm } = useModuleI18n("features/chat");

const messageInput = ref("");
const messageError = ref("");

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      // Spec §2 decision #2: pre-fill with subjects concatenated
      // oldest → newest, one per line.
      messageInput.value = props.commits.map((c) => c.subject).join("\n");
      messageError.value = "";
    }
  },
);

function onSubmit(): void {
  messageError.value = "";
  const message = messageInput.value.trim();
  if (!message) {
    messageError.value = tm(
      "spcodeProjectLoad.diffSidebar.squash.messageRequired",
    );
    return;
  }
  emit("submit", { shas: props.commits.map((c) => c.sha), message });
}
</script>

<style scoped>
.git-squash-dialog-list {
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 4px;
  padding: 4px 8px;
}
.git-squash-dialog-item {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.8;
}
.git-squash-dialog-sha {
  font-family: monospace;
  color: rgba(var(--v-theme-on-surface), 0.6);
  flex-shrink: 0;
}
.git-squash-dialog-subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.git-squash-dialog-warning {
  margin-top: 8px;
  font-size: 11.5px;
  color: rgb(var(--v-theme-warning));
}
</style>
```

- [ ] **Step 6: Typecheck**

Run: `cd /d F:\github\Astrbot\dashboard && npx vue-tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 7: Commit**

```bash
cd /d F:\github\Astrbot
git add dashboard/src/i18n/locales/zh-CN/features/chat.json dashboard/src/i18n/locales/en-US/features/chat.json dashboard/src/i18n/locales/ru-RU/features/chat.json dashboard/src/components/chat/GitSquashDialog.vue
git commit -m "feat(dashboard): add GitSquashDialog and squash i18n keys"
```

---

### Task 4: `GitLogView.vue` selection UI

**Files:**
- Modify: `F:\github\Astrbot\dashboard\src\components\chat\message_list_comps\GitLogView.vue` (script props/emits ≈ L95-113, script state after `expanded` ≈ L223, template toolbar after the cherry-pick `v-btn` ≈ L621, template row after the opening `.git-log-item` div ≈ L667, style after `.git-log-item-revert` rules ≈ L1147)
- Test: `F:\github\Astrbot\dashboard\src\components\chat\message_list_comps\GitLogView.squash.spec.ts`

**Interfaces:**
- Consumes: i18n keys from Task 3 (`squash.toolbar`, `squash.toolbarAria`, `squash.selectionHint`, `squash.rowSelectTitle`, `squash.rowSelectAria`).
- Produces (Task 5 relies on these exact names): prop `squashResetToken?: number`; emit `(e: "squash", payload: { commits: { sha: string; subject: string }[] })` with commits ordered oldest → newest.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/components/chat/message_list_comps/GitLogView.squash.spec.ts`:

```ts
// Author: elecvoid243 @ 2026-08-03
// Spec: docs/superpowers/specs/2026-08-03-git-squash-design.md §4.2
// Selection checkboxes + validity + squash payload for GitLogView.
// Heavy-stub strategy mirrors GitLogView.branchPicker.spec.ts.

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import GitLogView from "./GitLogView.vue";
import type { SpcodeLogSnapshot } from "@/composables/parseSpcodeGitWorkflow";

const vuetifyStubs = {
  "v-icon": { template: "<i />" },
  "v-btn": {
    name: "v-btn",
    props: ["disabled", "title", "size", "variant"],
    template:
      '<button class="v-btn-stub" :disabled="disabled" :title="title"><slot /></button>',
  },
  "v-text-field": {
    name: "v-text-field",
    props: ["modelValue", "label", "placeholder"],
    template: "<div />",
  },
  "v-combobox": {
    name: "v-combobox",
    props: ["modelValue", "items", "label", "placeholder", "hideNoData"],
    template: "<div />",
  },
  "v-progress-circular": { template: "<i />" },
  GitStatsPanel: { template: "<div />" },
  FilePatchPanel: { template: "<div />" },
};

function makeCommit(sha: string) {
  return {
    sha,
    shaShort: sha.slice(0, 7),
    author: { name: "alice", email: "alice@example.com" },
    committer: { name: "alice", email: "alice@example.com" },
    date: "2026-08-01T10:00:00+08:00",
    subject: `commit ${sha.slice(0, 7)}`,
    body: null,
    parents: [],
    shortstat: { files: 1, additions: 2, deletions: 3 },
  };
}

const SHAS = ["a".repeat(40), "b".repeat(40), "c".repeat(40), "d".repeat(40)];

function makeSnapshot(): SpcodeLogSnapshot {
  return {
    success: true,
    reason: null,
    loaded: true,
    elapsedMs: 1,
    umo: "u",
    worktree: "w",
    directory: "d",
    ref: "HEAD",
    count: SHAS.length,
    hasMore: false,
    truncated: false,
    maxBytes: 1024,
    commits: SHAS.map(makeCommit), // newest → oldest (git log order)
  };
}

function mountView(props: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mount(GitLogView as any, {
    props: {
      state: { kind: "ok", snapshot: makeSnapshot() },
      hasMore: false,
      isLoading: false,
      gitShow: {
        getState: () => ({ kind: "idle" }),
        getData: () => null,
        getFileState: () => ({ kind: "idle" }),
        fetch: () => Promise.resolve(),
        fetchFile: () => Promise.resolve(),
      },
      focusedCommitSha: null,
      gitStats: { state: { value: { kind: "idle" } }, refresh: () => {} },
      statsOpen: false,
      range: null,
      topFilesLimit: 10,
      branchItems: ["main", "dev"],
      currentBranch: "main",
      activeRef: "HEAD",
      squashResetToken: 0,
      ...props,
    },
    global: { stubs: vuetifyStubs },
  });
}

function findSquashButton(w: ReturnType<typeof mountView>) {
  // The squash toolbar button is the only one whose title comes from
  // squash.toolbarAria; locate it via the stable class added in Task 4.
  return w.find(".git-log-squash-btn");
}

describe("GitLogView squash selection (spec 2026-08-03)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders a selection checkbox per row when viewingCurrent", () => {
    const w = mountView();
    expect(w.findAll(".git-log-item-select")).toHaveLength(SHAS.length);
  });

  it("hides checkboxes and the squash button when viewing another ref", () => {
    const w = mountView({ activeRef: "dev" });
    expect(w.findAll(".git-log-item-select")).toHaveLength(0);
    expect(findSquashButton(w).exists()).toBe(false);
  });

  it("single selection is invalid; top-2 contiguous is valid", async () => {
    const w = mountView();
    const boxes = w.findAll(".git-log-item-select");
    await boxes[0].trigger("click");
    expect(findSquashButton(w).attributes("disabled")).toBeDefined();
    await boxes[1].trigger("click");
    expect(findSquashButton(w).attributes("disabled")).toBeUndefined();
  });

  it("non-contiguous selection (gap) stays invalid", async () => {
    const w = mountView();
    const boxes = w.findAll(".git-log-item-select");
    await boxes[0].trigger("click");
    await boxes[2].trigger("click"); // skips row 1 → gap
    expect(findSquashButton(w).attributes("disabled")).toBeDefined();
  });

  it("missing-HEAD selection stays invalid", async () => {
    const w = mountView();
    const boxes = w.findAll(".git-log-item-select");
    await boxes[1].trigger("click");
    await boxes[2].trigger("click");
    expect(findSquashButton(w).attributes("disabled")).toBeDefined();
  });

  it("emits squash payload ordered oldest → newest", async () => {
    const w = mountView();
    const boxes = w.findAll(".git-log-item-select");
    await boxes[0].trigger("click");
    await boxes[1].trigger("click");
    await findSquashButton(w).trigger("click");
    const events = w.emitted("squash");
    expect(events).toHaveLength(1);
    const payload = events![0][0] as {
      commits: { sha: string; subject: string }[];
    };
    expect(payload.commits.map((c) => c.sha)).toEqual([SHAS[1], SHAS[0]]);
    expect(payload.commits[0].subject).toBe(`commit ${SHAS[1].slice(0, 7)}`);
  });

  it("clears the selection when squashResetToken changes", async () => {
    const w = mountView();
    const boxes = w.findAll(".git-log-item-select");
    await boxes[0].trigger("click");
    await boxes[1].trigger("click");
    expect(findSquashButton(w).attributes("disabled")).toBeUndefined();
    await w.setProps({ squashResetToken: 1 });
    expect(findSquashButton(w).attributes("disabled")).toBeDefined();
    expect(w.findAll(".git-log-item-select.is-selected")).toHaveLength(0);
  });

  it("clears the selection when leaving the current branch view", async () => {
    const w = mountView();
    const boxes = w.findAll(".git-log-item-select");
    await boxes[0].trigger("click");
    await w.setProps({ activeRef: "dev" });
    await w.setProps({ activeRef: "HEAD" });
    expect(w.findAll(".git-log-item-select.is-selected")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /d F:\github\Astrbot\dashboard && npx vitest run src/components/chat/message_list_comps/GitLogView.squash.spec.ts`
Expected: FAIL — `.git-log-item-select` finds 0 elements / `.git-log-squash-btn` missing.

- [ ] **Step 3: Script changes in `GitLogView.vue`**

Edit 1 — props: after the `activeRef: string | null;` prop entry (end of the `defineProps` type block), add:

```ts
  /** 2026-08-03 git-squash (spec 2026-08-03-git-squash-design §4.2):
   *  bumped by the sidebar after a successful squash so we clear the
   *  selection. Optional so the sidebar mount compiles before its
   *  wiring task lands. */
  squashResetToken?: number;
```

Edit 2 — emits: after the `(e: "cherry-pick-blank"): void;` entry, add:

```ts
  // 2026-08-03 git-squash: toolbar entry. The sidebar owns the dialog
  // + the /spcode/git-squash call; we surface the picked commits
  // ordered oldest → newest (dialog lists + pre-fills in this order).
  (e: "squash", payload: { commits: { sha: string; subject: string }[] }): void;
```

Edit 3 — state + computed + handlers: immediately after the `function toggleCommit(...)` block (≈ L235), add:

```ts
// ── Squash selection (2026-08-03, spec 2026-08-03-git-squash-design §4.2) ──
// Local-only by design: never lifted to Pinia, never persisted, never
// conflated with `expanded` (which tracks the accordion state).
const selectedCommits = ref<Set<string>>(new Set<string>());

function toggleSquashSelection(sha: string): void {
  const next = new Set(selectedCommits.value);
  if (next.has(sha)) next.delete(sha);
  else next.add(sha);
  selectedCommits.value = next;
}

/** Valid iff the selection is exactly the top N rows (N >= 2) of the
 *  displayed list. Checkboxes only render while viewingCurrent, so
 *  the displayed list is the unfiltered HEAD-first history and
 *  "top N rows" ⇔ "HEAD-anchored contiguous". The backend
 *  re-validates authoritatively via rev-list — this is UX-only. */
const squashSelection = computed<"none" | "valid" | "invalid">(() => {
  const n = selectedCommits.value.size;
  if (n === 0) return "none";
  if (n < 2) return "invalid";
  const top = commits.value.slice(0, n);
  if (top.length < n) return "invalid";
  return top.every((c) => selectedCommits.value.has(c.sha))
    ? "valid"
    : "invalid";
});

function onSquashClick(): void {
  const n = selectedCommits.value.size;
  // `commits` is newest → oldest; take the top N, keep the picked
  // ones (all of them, by validity), then reverse to oldest → newest.
  const picked = commits.value
    .slice(0, n)
    .filter((c) => selectedCommits.value.has(c.sha))
    .reverse()
    .map((c) => ({ sha: c.sha, subject: c.subject }));
  emit("squash", { commits: picked });
}

// Reset channels: the sidebar bumps squashResetToken after a
// successful squash; leaving the current-branch view unmounts the
// checkboxes, so any stale selection must not survive invisibly.
watch(
  () => props.squashResetToken,
  () => {
    selectedCommits.value = new Set();
  },
);
watch(viewingCurrent, (v) => {
  if (!v) selectedCommits.value = new Set();
});
```

- [ ] **Step 4: Template changes**

Edit 1 — toolbar button: immediately after the cherry-pick toolbar `v-btn` block (the one with the comment `<!-- 2026-08-01 git-cherry-pick: standalone entry (blank ref). -->`, ending `</v-btn>` ≈ L621), insert:

```html
        <!-- 2026-08-03 git-squash: toolbar entry, gated on a valid
             HEAD-anchored contiguous selection (top N rows, N >= 2).
             Title doubles as the invalid-selection hint. -->
        <v-btn
          v-if="viewingCurrent"
          class="git-log-squash-btn"
          size="small"
          variant="text"
          :disabled="squashSelection !== 'valid'"
          :title="
            squashSelection === 'invalid'
              ? tm('spcodeProjectLoad.diffSidebar.squash.selectionHint')
              : tm('spcodeProjectLoad.diffSidebar.squash.toolbarAria')
          "
          @click="onSquashClick"
        >
          <v-icon size="14" start>mdi-arrow-collapse-vertical</v-icon>
          {{ tm("spcodeProjectLoad.diffSidebar.squash.toolbar") }}
          <template v-if="selectedCommits.size > 0">
            ({{ selectedCommits.size }})</template
          >
        </v-btn>
```

Edit 2 — per-row checkbox: inside the `.git-log-item` div, immediately BEFORE the `<button type="button" class="git-log-item-header" ...>` element, insert (it must NOT go inside the header button — nested buttons are invalid HTML):

```html
        <!-- 2026-08-03 git-squash: per-row selection checkbox,
             absolutely positioned over the commit-icon gutter.
             Revealed on row hover / focus; stays visible while
             checked. Same viewingCurrent gate as the revert button. -->
        <button
          v-if="viewingCurrent"
          type="button"
          class="git-log-item-select"
          :class="{ 'is-selected': selectedCommits.has(c.sha) }"
          :title="tm('spcodeProjectLoad.diffSidebar.squash.rowSelectTitle')"
          :aria-label="
            tm('spcodeProjectLoad.diffSidebar.squash.rowSelectAria', {
              sha: c.shaShort || c.sha.slice(0, 7),
            })
          "
          :aria-pressed="selectedCommits.has(c.sha)"
          @click.stop="toggleSquashSelection(c.sha)"
        >
          <v-icon size="14">
            {{
              selectedCommits.has(c.sha)
                ? "mdi-checkbox-marked"
                : "mdi-checkbox-blank-outline"
            }}
          </v-icon>
        </button>
```

- [ ] **Step 5: Style changes**

At the end of the `<style scoped>` block (after the `.git-log-item-revert` / `.git-log-item-cherry-pick` rules ≈ L1147), append. If `.git-log-item` already declares `position`, keep it and skip the first rule:

```css
/* 2026-08-03 git-squash: anchor for the absolutely positioned
   selection checkbox. */
.git-log-item {
  position: relative;
}
/* 2026-08-03 git-squash: per-row selection checkbox. Hidden until
   the row is hovered / the button is focused / it is checked — the
   same hover-reveal pattern as .git-log-item-revert, plus a
   persistent visible state for checked rows so the current
   selection is readable without hovering. */
.git-log-item-select {
  position: absolute;
  left: 2px;
  top: 6px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  padding: 1px;
  border: none;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.45);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.12s,
    color 0.12s;
}
.git-log-item:hover .git-log-item-select,
.git-log-item-select:focus-visible,
.git-log-item-select.is-selected {
  opacity: 1;
}
.git-log-item-select.is-selected {
  color: rgb(var(--v-theme-primary));
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /d F:\github\Astrbot\dashboard && npx vitest run src/components/chat/message_list_comps/GitLogView.squash.spec.ts`
Expected: PASS — 8 passed.

- [ ] **Step 7: Regression-run the existing GitLogView spec**

Run: `cd /d F:\github\Astrbot\dashboard && npx vitest run src/components/chat/message_list_comps/GitLogView.branchPicker.spec.ts`
Expected: PASS (the new prop is optional; existing mounts unaffected).

- [ ] **Step 8: Typecheck**

Run: `cd /d F:\github\Astrbot\dashboard && npx vue-tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 9: Commit**

```bash
cd /d F:\github\Astrbot
git add dashboard/src/components/chat/message_list_comps/GitLogView.vue dashboard/src/components/chat/message_list_comps/GitLogView.squash.spec.ts
git commit -m "feat(dashboard): add squash selection UI to git history view"
```

---

### Task 5: `GitDiffSidebar.vue` orchestration

**Files:**
- Modify: `F:\github\Astrbot\dashboard\src\components\chat\GitDiffSidebar.vue` (imports ≈ L77, composable instances ≈ L706, dialog state ≈ L918, reason palette after `REVERT_REASON_I18N_KEYS` ≈ L1307, handlers after `onConfirmRevert` ≈ L1360, GitLogView mount ≈ L4519, dialog mount after `<GitCherryPickDialog ... />` ≈ L4703, dispose ≈ L3486)

**Interfaces:**
- Consumes: Task 2's `useSpcodeGitSquash` (`isSquashing`, `squash`, `dispose`); Task 3's `GitSquashDialog` props/events + `squash.*` i18n keys; Task 4's `squashResetToken` prop + `squash` emit.
- Produces: the fully wired feature. No later tasks.

- [ ] **Step 1: Imports**

After the line `import GitCherryPickDialog from "@/components/chat/GitCherryPickDialog.vue";` (≈ L77) insert:

```ts
import GitSquashDialog from "@/components/chat/GitSquashDialog.vue";
import { useSpcodeGitSquash } from "@/composables/useSpcodeGitSquash";
```

- [ ] **Step 2: Composable instance + state**

After the `const gitRevert = useSpcodeGitRevert();` line (and its 2-line comment, ≈ L706-708) insert:

```ts
// 2026-08-03 git-squash: History-view multi-commit squash. The
// sidebar owns the dialog + the write call (mirroring revert).
const gitSquash = useSpcodeGitSquash();
```

After the `const pendingRevert = ref<{ sha: string; subject: string } | null>(null);` line (≈ L919) insert:

```ts
// 2026-08-03 git-squash: dialog state + the token that clears
// GitLogView's selection after a successful squash.
const squashDialogOpen = ref(false);
const pendingSquash = ref<{ sha: string; subject: string }[] | null>(null);
const squashResetToken = ref(0);
```

- [ ] **Step 3: Reason palette**

Immediately after the closing `};` of `REVERT_REASON_I18N_KEYS` (≈ L1307), insert:

```ts
// 2026-08-03 git-squash: reason → snackbar mapping (mirrors
// REVERT_REASON_I18N_KEYS). withStderr entries surface git output
// in the snackbar's <pre> block.
const SQUASH_REASON_I18N_KEYS: Record<
  string,
  { key: string; color: "warning" | "error"; withStderr?: boolean }
> = {
  invalid_body: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.invalid_body",
    color: "error",
  },
  invalid_param: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.invalid_param",
    color: "error",
  },
  invalid_message: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.invalid_message",
    color: "error",
  },
  head_not_selected: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.head_not_selected",
    color: "warning",
  },
  not_contiguous: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.not_contiguous",
    color: "warning",
  },
  root_commit: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.root_commit",
    color: "warning",
  },
  worktree_dirty: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.worktree_dirty",
    color: "warning",
  },
  operation_in_progress: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.operation_in_progress",
    color: "warning",
  },
  commit_not_found: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.commit_not_found",
    color: "error",
  },
  hook_rejected: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.hook_rejected",
    color: "warning",
    withStderr: true,
  },
  identity_not_set: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.identity_not_set",
    color: "error",
  },
  nothing_to_commit: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.nothing_to_commit",
    color: "error",
    withStderr: true,
  },
  git_error: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.git_error",
    color: "error",
    withStderr: true,
  },
  network: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.network",
    color: "error",
  },
  unknown: {
    key: "spcodeProjectLoad.diffSidebar.squash.error.unknown",
    color: "error",
  },
};
```

- [ ] **Step 4: Handlers**

Immediately after the `onConfirmRevert` function's closing brace (≈ L1360), insert:

```ts
// ── Squash commits (History view, 2026-08-03) ────────────────────
function onLogSquashRequest(payload: {
  commits: { sha: string; subject: string }[];
}): void {
  pendingSquash.value = payload.commits;
  squashDialogOpen.value = true;
}

async function onSquashSubmit(p: {
  shas: string[];
  message: string;
}): Promise<void> {
  const result = await gitSquash.squash({
    shas: p.shas,
    message: p.message,
    worktree: selectedWorktree.value,
    umo: spcodeStatus.status.value.umo,
  });
  if (result.ok) {
    squashDialogOpen.value = false;
    pendingSquash.value = null;
    squashResetToken.value++;
    showSnackbar(
      tm("spcodeProjectLoad.diffSidebar.squash.success", {
        sha: result.snapshot.newSha.slice(0, 7),
      }),
      "success",
    );
    // Plain refreshes (revert precedent): the git-log ETag embeds
    // head_sha + .git/index mtime — both changed by reset+commit —
    // so the conditional request revalidates server-side and never
    // replays a stale 304. No invalidateEtag call needed.
    void Promise.all([
      gitLog.refresh(),
      gitStatus.refresh(),
      composable.refresh(),
    ]);
    return;
  }
  if (result.reason === "aborted") return;
  const meta =
    SQUASH_REASON_I18N_KEYS[result.reason] ?? SQUASH_REASON_I18N_KEYS.unknown;
  squashDialogOpen.value = false;
  pendingSquash.value = null;
  showSnackbar(
    tm(meta.key),
    meta.color,
    meta.withStderr ? result.stderr : undefined,
  );
}
```

- [ ] **Step 5: GitLogView mount — add prop + listener**

In the `<GitLogView ... />` template block (≈ L4519-4542), add one prop and one listener (order within the tag is free; place them after the `@cherry-pick-blank` line):

```html
            :squash-reset-token="squashResetToken"
            @squash="onLogSquashRequest"
```

- [ ] **Step 6: Dialog mount**

Immediately after the `<GitCherryPickDialog ... />` block (≈ L4698-4703), insert:

```html
        <!-- 2026-08-03 git-squash: dialog for the history-view
             multi-commit squash (commits listed oldest → newest). -->
        <GitSquashDialog
          v-model="squashDialogOpen"
          :commits="pendingSquash ?? []"
          :loading="gitSquash.isSquashing.value"
          @submit="onSquashSubmit"
        />
```

- [ ] **Step 7: Dispose**

In the `onBeforeUnmount` block, after the `gitRevert.dispose();` line insert:

```ts
  gitSquash.dispose();
```

- [ ] **Step 8: Typecheck**

Run: `cd /d F:\github\Astrbot\dashboard && npx vue-tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 9: Commit**

```bash
cd /d F:\github\Astrbot
git add dashboard/src/components/chat/GitDiffSidebar.vue
git commit -m "feat(dashboard): wire git squash dialog and orchestration into GitDiffSidebar"
```

---

### Task 6: Full verification

**Files:** none (verification only; fixes, if any, amend the owning task's commit with a new fix commit).

- [ ] **Step 1: Frontend typecheck + full test suite**

Run: `cd /d F:\github\Astrbot\dashboard && npx vue-tsc --noEmit`
Expected: exit code 0.

Run: `cd /d F:\github\Astrbot\dashboard && npx vitest run src/composables/__tests__/useSpcodeGitSquash.spec.ts src/components/chat/message_list_comps/GitLogView.squash.spec.ts src/components/chat/message_list_comps/GitLogView.branchPicker.spec.ts src/components/chat/message_list_comps/DocumentManager.spec.ts`
Expected: all test files PASS.

- [ ] **Step 2: Backend full git webapi test sweep**

Run: `cd /d F:\github\astrbot_plugin_spcode_toolkit && python -m pytest tests/test_git_squash.py tests/test_git_revert.py tests/test_git_commit.py tests/test_git_cherry_pick.py -q`
Expected: all PASS. (If `tests/test_git_cherry_pick.py` does not exist, drop it from the command.)

- [ ] **Step 3: Manual smoke test (optional but recommended)**

1. `cd /d F:\github\Astrbot\dashboard && pnpm dev`, open the dashboard, load a git project with ≥ 3 local commits.
2. Git 历史 tab → hover commit rows → checkboxes appear; select the top 2 rows.
3. "压缩提交 (2)" button enables → click → dialog lists both commits oldest → newest with pre-filled message → edit → 压缩.
4. Expect: success snackbar `已压缩为 <sha>`; history list shows one fewer commit; `git log --oneline` in a terminal confirms the squash.
5. Negative check: select rows 1+2 (gap from HEAD) → button stays disabled with hint tooltip.

---

## Self-Review Notes (completed by the plan author)

- **Spec coverage:** backend §3 (Task 1), frontend §4.1 (Task 2), §4.3 + §4.5 (Task 3), §4.2 (Task 4), §4.4 (Task 5), §6 tests (Tasks 1/2/4 + Task 6 sweep). §5 edge cases map to: Task 1 validation steps 3/6/8/9/10, Task 4 validity computed + watchers, Task 2 single-in-flight guard.
- **Type consistency:** `SquashParams/SquashResult/SquashSnapshot` (Task 2) == names used in Task 5; dialog `commits`/`submit` payload (Task 3) == Task 5 mount + handler; emit payload `{ commits }` (Task 4) == `onLogSquashRequest` param (Task 5); backend success keys `new_sha/squashed_count/old_head_sha/files_touched/message` (Task 1) == composable parse (Task 2).
- **Deviations from spec (intentional, spec already amended in commit d2cf63e4d):** no parser file (inline parse); no `invalidateEtag()` (ETag embeds head_sha + index mtime); emit payload carries `{ commits: [{sha, subject}] }` instead of parallel arrays; `squashResetToken` is an optional prop.


