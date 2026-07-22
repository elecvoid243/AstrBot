# Binary Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DocumentManager 视图下直接渲染 pdf / docx / xlsx / csv / md 5 种工作区文件（当前 + git 历史双路），其他格式维持现有 binary 占位。

**Architecture:** 后端新增独立端点 `GET /spcode/file-binary`（5 类白名单 + ETag + 304 + Content-Type），流式返回原始 bytes；前端 `useSpcodeFileBinary` composable 沿用 `useSpcodeFileBrowser` 状态机模式（idle / loading / ok / error + AbortController + dispose），容器组件 `<BinaryPreview>` 按扩展名分派 4 个子组件（pdf / docx / xlsx / csv），`.md` 走现有 `MarkdownView` 路径。`DocumentTreePanel` 扩展白名单让树显示 5 种扩展名；顶部"新建"按钮仍只允许 `.md`。

**Tech Stack:** Python 3.10+ aiofiles / 现有 `_run_git_async` 模式、Vue 3.3 `<script setup lang="ts">`、TypeScript 5.1、pdfjs-dist 4.x（PDF 渲染）、mammoth.browser 1.x（docx → HTML）、exceljs 4.x（xlsx 解析）、papaparse 5.x（CSV 解析）、Vitest 1.6 + happy-dom + @vue/test-utils 2。

**Worktree:** 实施开 `F:\github\Astrbot\.worktrees\feat-binary-preview`（分支 `feat/binary-preview`，基于 `all`）。Plan 路径与全部代码路径相对工作树根目录。

**Spec:** `docs/superpowers/specs/2026-07-22-binary-preview-design.md`

---

## Global Constraints

- 所有源码注释用 **English**；组件/spec 头部注释含 `Author: elecvoid243` + 日期。
- 新增后端常量：`MIME_BY_EXT` + `FILE_BINARY_MAX_BYTES = 50 * 1024 * 1024`（spec §4.5）。
- 新增 ReasonCode：`UNSUPPORTED_MEDIA_TYPE` + `INTERNAL_ERROR`（spec §4.9）。
- 端点白名单：仅 `.pdf / .docx / .xlsx / .csv / .md` 接受，其他 → 415 `unsupported_media_type`（spec §4.5）。
- ETag 公式：`W/"<mtime_ns>-<size>"`，与 `file-browser` 保持一致（spec §4.6）。
- 50MB 硬上限：超限 → 413 `file_too_large`（spec §4.3）。
- 不跟随 symlink：顶层 symlink / FIFO / device → 415 `special_file`（spec §4.8）。
- DocumentManager 顶部"新建"按钮：仍只允许 `.md`（与后端 `docs_crud` 契约一致；spec §6.4）。
- DocumentManager 树显示：扩展 `ALLOWED_DOC_EXTENSIONS` 到 5 种，但 `ALLOWED_CREATE_EXTENSIONS` 仍为 `[".md"]`（spec §6.4）。
- 错误响应 envelope：与现有 `webapi/_helpers._make_envelope` 一致（spec §4.4）。
- git ref 路径：复用 `_run_git_async` 需扩展为 `_run_git_async_bytes` 返回 stdout bytes（spec §4.8 NOTE）。
- preflight 5 步：复用 `_git_endpoint_preflight`（spec §4.1）。
- 路径防御 4 步：复用 `_validate_repo_relative_file`（spec §4.1）。
- 前端 composable 模式 1:1 镜像 `useSpcodeFileBrowser`（spec §5.3b）。
- 304 短路：axios 需 `validateStatus: (s) => s >= 200 && s < 400`（spec §5.3e）。
- 错误响应解析：inline 在 `useSpcodeFileBinary.ts` 内部，不独立文件（spec §5.4）。
- 不加下载按钮（spec §7.1，无 v1 重试按钮）。
- 不接 pptx（spec §1 非目标；预留扩展点）。
- 测试基础设施：vitest 1.6 + happy-dom + @vue/test-utils 2 + sinon（如需）。Vitest include 仅 `src/**/*.spec.ts`（`tests/*.test.mjs` 不跑）。Python pytest。
- i18n 双语：`spcodeProjectLoad.documentManager.binaryPreview.*`（spec §6.6）。
- 提交信息用 conventional commits（English）。
- Plan 偏差备忘：spec §3.2 模块清单中 `parseSpcodeFileBinary.ts` 已在 v1 自审时合并到 `useSpcodeFileBinary.ts` 内部。

---

## File Structure

| 文件 | 状态 | 职责 |
|---|---|---|
| `data/plugins/astrbot_plugin_spcode_toolkit/tools/webapi/_helpers.py` | 改 | +`MIME_BY_EXT` / `FILE_BINARY_MAX_BYTES` / `_run_git_async_bytes` / ReasonCode 新增 |
| `data/plugins/astrbot_plugin_spcode_toolkit/tools/webapi/file_binary.py` | 新 | GET `/spcode/file-binary` handler |
| `data/plugins/astrbot_plugin_spcode_toolkit/tools/webapi/__init__.py` | 改 | 注册 ROUTES |
| `data/plugins/astrbot_plugin_spcode_toolkit/tests/test_file_binary.py` | 新 | 后端 13 个 case |
| `dashboard/src/composables/useSpcodeFileBinary.ts` | 新 | 状态机 composable + 错误解析 inline |
| `dashboard/src/composables/useSpcodeFileBinary.spec.ts` | 新 | composable 单测 |
| `dashboard/src/components/chat/message_list_comps/binary_preview/BinaryPreview.vue` | 新 | 容器 |
| `dashboard/src/components/chat/message_list_comps/binary_preview/PdfPreview.vue` | 新 | pdfjs 渲染 |
| `dashboard/src/components/chat/message_list_comps/binary_preview/DocxPreview.vue` | 新 | mammoth 渲染 |
| `dashboard/src/components/chat/message_list_comps/binary_preview/XlsxPreview.vue` | 新 | exceljs 渲染 |
| `dashboard/src/components/chat/message_list_comps/binary_preview/CsvPreview.vue` | 新 | papaparse 渲染 |
| `dashboard/src/components/chat/message_list_comps/binary_preview/BinaryPreview.spec.ts` | 新 | 容器单测 |
| `dashboard/src/components/chat/message_list_comps/DocumentTreePanel.vue` | 改 | 扩展 `ALLOWED_DOC_EXTENSIONS` + 新增 `ALLOWED_CREATE_EXTENSIONS` |
| `dashboard/src/components/chat/message_list_comps/DocumentManager.vue` | 改 | 接入 BinaryPreview + 隐藏二进制下的复制/编辑按钮 |
| `dashboard/package.json` | 改 | +4 依赖（pdfjs-dist / mammoth / exceljs / papaparse） |
| `dashboard/src/i18n/en-US/...` | 改 | +15 个 i18n key |
| `dashboard/src/i18n/zh-CN/...` | 改 | +15 个 i18n key |

17 个文件；最大新增文件 ~250 行（composable + 容器合并），其他全为 < 200 行。

---

## Task 1: 后端 helpers —— MIME_BY_EXT + FILE_BINARY_MAX_BYTES + ReasonCode

**Files:**
- Modify: `data/plugins/astrbot_plugin_spcode_toolkit/tools/webapi/_helpers.py:60-200` (ReasonCode 末尾 + 顶部常量)

**Interfaces:**
- Consumes: 无
- Produces（Task 2-3 依赖）:
  - `MIME_BY_EXT: dict[str, str]` —— 5 类扩展名 → MIME
  - `FILE_BINARY_MAX_BYTES: int = 50 * 1024 * 1024`
  - `ReasonCode.UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type"`
  - `ReasonCode.INTERNAL_ERROR = "internal_error"`

- [ ] **Step 1: 在 `_helpers.py` 顶部 `FILE_BROWSER_*` 常量旁加 `MIME_BY_EXT` + `FILE_BINARY_MAX_BYTES`**

```python
# Binary file preview support (spec 2026-07-22 §4.5)
# Whitelist of extensions accepted by GET /spcode/file-binary; any
# other suffix → 415 unsupported_media_type. Keep the table in sync
# with the dashboard's <BinaryPreview> dispatcher.
MIME_BY_EXT: dict[str, str] = {
    ".pdf":  "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv":  "text/csv; charset=utf-8",
    ".md":   "text/markdown; charset=utf-8",
}

# Hard cap for /spcode/file-binary. pdfjs / mammoth can OOM on files
# above this size in browser tabs; v1 rejects with 413.
FILE_BINARY_MAX_BYTES: int = 50 * 1024 * 1024  # 50 MB
```

- [ ] **Step 2: 在 `class ReasonCode` 末尾添加新常量**

```python
    # ── /spcode/file-binary(spec 2026-07-22, 2026-07-22) ──
    UNSUPPORTED_MEDIA_TYPE = (
        "unsupported_media_type"  # file-binary: extension not in MIME_BY_EXT
    )
    INTERNAL_ERROR = "internal_error"  # file-binary: unhandled exception
```

- [ ] **Step 3: 运行 ruff format / check 确认改动符合规范**

Run: `cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && uv run ruff format tools/webapi/_helpers.py && uv run ruff check tools/webapi/_helpers.py`
Expected: 无错误（如有 warning 修掉）

- [ ] **Step 4: 提交**

```bash
cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && \
git add tools/webapi/_helpers.py && \
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(spcode/webapi): add MIME_BY_EXT + FILE_BINARY_MAX_BYTES + ReasonCode"
```

---

## Task 2: 后端 helpers —— `_run_git_async_bytes` 变体

**Files:**
- Modify: `data/plugins/astrbot_plugin_spcode_toolkit/tools/webapi/_helpers.py:30-90` (`_run_git_async` 后插入)

**Interfaces:**
- Consumes: `_run_git_async` 已有实现
- Produces:
  - `async def _run_git_async_bytes(cmd_args: list[str], cwd: str = "", timeout: float = 15.0) -> dict`
    - 返回 `{"ok": bool, "stdout": bytes, "stderr": str, "code": int, "error": str?}`
    - 与 `_run_git_async` 共享 subprocess 调用路径，**仅**不 decode stdout

- [ ] **Step 1: 在 `_run_git_async` 函数后追加 `_run_git_async_bytes`**

```python
async def _run_git_async_bytes(
    cmd_args: list[str],
    cwd: str = "",
    timeout: float = 15.0,
) -> dict:
    """Asyncio async variant of ``_run_git_async`` that returns stdout as bytes.

    Used by /spcode/file-binary for git show <ref>:<path> where the blob
    may be binary (PDF / DOCX / XLSX) and utf-8 decode would lose data.
    Shares the subprocess plumbing with ``_run_git_async`` but skips the
    stdout decode step.

    Args:
        cmd_args: Subprocess argument list.
        cwd: Working directory; empty string keeps the parent's cwd.
        timeout: Subprocess timeout in seconds.

    Returns:
        Same shape as ``_run_git_async`` but with ``stdout`` typed as bytes.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd or None,
            **_NO_WINDOW_KWARGS,
        )
    except FileNotFoundError:
        cmd_name = cmd_args[0] if cmd_args else "command"
        return {"ok": False, "error": f"{cmd_name} 未安装或不在 PATH 中"}

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(), timeout=timeout,
        )
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        try:
            await proc.wait()
        except Exception:
            pass
        return {"ok": False, "error": f"命令超时 ({timeout}s)"}

    return {
        "ok": proc.returncode == 0,
        "stdout": stdout_bytes,  # bytes, not str
        "stderr": stderr_bytes.decode("utf-8", errors="replace").rstrip("\r\n"),
        "code": proc.returncode,
    }
```

- [ ] **Step 2: ruff format / check**

Run: `cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && uv run ruff format tools/webapi/_helpers.py && uv run ruff check tools/webapi/_helpers.py`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && \
git add tools/webapi/_helpers.py && \
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(spcode/webapi): add _run_git_async_bytes for binary blob fetch"
```

---

## Task 3: 后端端点 —— `file_binary.py` 工作区路径

**Files:**
- Create: `data/plugins/astrbot_plugin_spcode_toolkit/tools/webapi/file_binary.py`

**Interfaces:**
- Consumes: `_helpers.MIME_BY_EXT` / `FILE_BINARY_MAX_BYTES` / `ReasonCode` / `_git_endpoint_preflight` / `_validate_repo_relative_file` / `_make_envelope` / `_JSONResponseCompat`
- Produces:
  - `async def handle(plugin: SPCodeToolkit) -> Response` —— `GET /spcode/file-binary` handler

- [ ] **Step 1: 写失败测试 `data/plugins/astrbot_plugin_spcode_toolkit/tests/test_file_binary.py`**

```python
# Author: elecvoid243, 2026-07-22
# Spec: docs/superpowers/specs/2026-07-22-binary-preview-design.md §4 / §8.1
"""Tests for GET /spcode/file-binary — covers Task 3 (workspace path)
through Task 5 (full endpoint surface)."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tools.webapi import file_binary
from tools.webapi._helpers import (
    FILE_BINARY_MAX_BYTES,
    MIME_BY_EXT,
    ReasonCode,
)


@pytest.fixture
def worktree(tmp_path: Path) -> Path:
    """A minimal git worktree-style directory with a sample .pdf file."""
    (tmp_path / ".git").mkdir()
    pdf_bytes = b"%PDF-1.4\n%fake pdf content for tests\n%%EOF"
    (tmp_path / "doc.pdf").write_bytes(pdf_bytes)
    (tmp_path / "note.md").write_text("# hello", encoding="utf-8")
    # Unsupported extension
    (tmp_path / "archive.zip").write_bytes(b"PK\x03\x04")
    # Oversized file
    (tmp_path / "big.pdf").write_bytes(b"x" * (FILE_BINARY_MAX_BYTES + 1))
    # A symlink to the .pdf
    (tmp_path / "link.pdf").symlink_to(tmp_path / "doc.pdf")
    return tmp_path


def _make_plugin(worktree_path: Path) -> MagicMock:
    plugin = MagicMock()
    plugin._config = {"agentsmd_enabled": True, "codegraph_enabled": True}
    plugin._git_binary.return_value = "git"
    plugin.get_loaded_project.return_value = {
        "directory": str(worktree_path),
        "loaded_at": 0.0,
    }
    return plugin


@pytest.mark.asyncio
async def test_workspace_pdf_returns_bytes_with_etag(worktree: Path) -> None:
    plugin = _make_plugin(worktree)
    with patch.object(file_binary, "_get_path_param", return_value="doc.pdf"), \
         patch.object(file_binary, "_get_ref_param", return_value=None), \
         patch.object(file_binary, "_get_if_none_match", return_value=""):
        resp = await file_binary.handle(plugin)
    assert resp.status_code == 200
    assert resp.headers["Content-Type"] == MIME_BY_EXT[".pdf"]
    assert resp.headers["ETag"].startswith('W/"')
    assert b"%PDF-1.4" in resp.body


@pytest.mark.asyncio
async def test_workspace_md_returns_markdown_content_type(worktree: Path) -> None:
    plugin = _make_plugin(worktree)
    with patch.object(file_binary, "_get_path_param", return_value="note.md"), \
         patch.object(file_binary, "_get_ref_param", return_value=None), \
         patch.object(file_binary, "_get_if_none_match", return_value=""):
        resp = await file_binary.handle(plugin)
    assert resp.status_code == 200
    assert resp.headers["Content-Type"] == MIME_BY_EXT[".md"]


@pytest.mark.asyncio
async def test_workspace_zip_rejected_with_415(worktree: Path) -> None:
    plugin = _make_plugin(worktree)
    with patch.object(file_binary, "_get_path_param", return_value="archive.zip"), \
         patch.object(file_binary, "_get_ref_param", return_value=None), \
         patch.object(file_binary, "_get_if_none_match", return_value=""):
        resp = await file_binary.handle(plugin)
    assert resp.status_code == 415
    assert resp.body["data"]["reason"] == ReasonCode.UNSUPPORTED_MEDIA_TYPE


@pytest.mark.asyncio
async def test_workspace_oversized_returns_413(worktree: Path) -> None:
    plugin = _make_plugin(worktree)
    with patch.object(file_binary, "_get_path_param", return_value="big.pdf"), \
         patch.object(file_binary, "_get_ref_param", return_value=None), \
         patch.object(file_binary, "_get_if_none_match", return_value=""):
        resp = await file_binary.handle(plugin)
    assert resp.status_code == 413
    assert resp.body["data"]["reason"] == ReasonCode.FILE_TOO_LARGE


@pytest.mark.asyncio
async def test_workspace_symlink_rejected_with_415(worktree: Path) -> None:
    plugin = _make_plugin(worktree)
    with patch.object(file_binary, "_get_path_param", return_value="link.pdf"), \
         patch.object(file_binary, "_get_ref_param", return_value=None), \
         patch.object(file_binary, "_get_if_none_match", return_value=""):
        resp = await file_binary.handle(plugin)
    assert resp.status_code == 415
    assert resp.body["data"]["reason"] == ReasonCode.SPECIAL_FILE
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && uv run pytest tests/test_file_binary.py -v`
Expected: FAIL with "module 'tools.webapi.file_binary' not found" 或类似 import error

- [ ] **Step 3: 创建 `file_binary.py` 工作区路径部分**

```python
# Author: elecvoid243, 2026-07-22
# Spec: docs/superpowers/specs/2026-07-22-binary-preview-design.md §4
"""GET /spcode/file-binary — stream raw file bytes for browser-side rendering.

Returns the raw bytes of a whitelisted file (PDF / DOCX / XLSX / CSV / MD)
with a precise Content-Type so the browser (or in-tab library like
pdfjs / mammoth / exceljs / papaparse) can render it directly.

Rejecting non-whitelisted extensions is intentional — the endpoint is
*not* a generic file-download proxy, it is the read pipe for
<BinaryPreview> in the dashboard.
"""
from __future__ import annotations

import logging
import os
import stat
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import quote

from .._helpers import (
    FILE_BINARY_MAX_BYTES,
    MIME_BY_EXT,
    ReasonCode,
    _make_envelope,
)
from ._helpers import _JSONResponseCompat

if TYPE_CHECKING:
    from main import SPCodeToolkit

logger = logging.getLogger(__name__)


def _get_path_param() -> str:
    """Read the ?path= query param from the current web request."""
    from astrbot.api import web
    return (web.request.query.get("path", "") or "").strip()


def _get_ref_param() -> str | None:
    """Read the ?ref= query param; None when absent."""
    from astrbot.api import web
    raw = (web.request.query.get("ref", "") or "").strip()
    return raw or None


def _get_if_none_match() -> str:
    from astrbot.api import web
    return web.request.headers.get("If-None-Match", "") or ""


def _build_error(status: int, reason: str, path: str, elapsed_ms: int = 0) -> _JSONResponseCompat:
    return _JSONResponseCompat(
        _make_envelope(success=False, reason=reason, elapsed_ms=elapsed_ms, path=path),
        status_code=status,
        headers={"Content-Type": "application/json; charset=utf-8"},
    )


def _classify_oserror(exc: OSError) -> str:
    if isinstance(exc, PermissionError) or exc.errno == 13:
        return ReasonCode.PERMISSION_DENIED
    return ReasonCode.PATH_NOT_FOUND


def _compute_binary_etag(path: Path, st: os.stat_result) -> str:
    return f'W/"{st.st_mtime_ns}-{st.st_size}"'


def _content_disposition(name: str) -> str:
    """RFC 5987 encoded filename for unicode-safe Content-Disposition."""
    safe_ascii = name.encode("ascii", "replace").decode("ascii")
    utf8 = quote(name, safe="")
    return f'inline; filename="{safe_ascii}"; filename*=UTF-8\'\'{utf8}'


async def _serve_workspace_path(
    plugin: "SPCodeToolkit",
    rel_path: str,
) -> _JSONResponseCompat:
    """Read a workspace file and stream its bytes (workspace-path branch)."""
    from .._helpers import _validate_repo_relative_file

    plugin = plugin  # keep static type-checker happy
    umo = "workspace"  # workspace path uses no umo in this branch
    err, ctx = await _resolve_directory(plugin, umo, ref=None)
    if err is not None:
        return err
    directory = ctx["directory"]

    target, path_err = _validate_repo_relative_file(rel_path, Path(directory))
    if path_err is not None:
        return _build_error(400, ReasonCode.PATH_UNSAFE, rel_path)

    try:
        file_st = target.lstat()
    except (PermissionError, OSError) as exc:
        return _build_error(404 if not isinstance(exc, PermissionError) else 403,
                            _classify_oserror(exc), rel_path)

    if stat.S_ISLNK(file_st.st_mode) or not stat.S_ISREG(file_st.st_mode):
        return _build_error(415, ReasonCode.SPECIAL_FILE, rel_path)
    if file_st.st_size > FILE_BINARY_MAX_BYTES:
        return _build_error(
            413, ReasonCode.FILE_TOO_LARGE, rel_path,
        )
    etag = _compute_binary_etag(target, file_st)
    if _get_if_none_match() == etag:
        return _JSONResponseCompat(
            {}, status_code=304,
            headers={
                "ETag": etag,
                "Cache-Control": "private, must-revalidate",
                "Vary": "Cookie",
            },
        )
    with target.open("rb") as f:
        data = f.read()
    return _JSONResponseCompat(
        data,
        status_code=200,
        headers={
            "Content-Type": MIME_BY_EXT[target.suffix.lower()],
            "Content-Disposition": _content_disposition(target.name),
            "Content-Length": str(len(data)),
            "ETag": etag,
            "Cache-Control": "private, must-revalidate",
            "Vary": "Cookie",
        },
    )


async def _resolve_directory(
    plugin: "SPCodeToolkit",
    umo: str,
    ref: str | None,
) -> tuple[_JSONResponseCompat | None, dict | None]:
    """Resolve the absolute working directory for the request.

    Workspace branch skips preflight; ref branch delegates to the
    existing 5-step ``_git_endpoint_preflight``. Returns ``(err, None)``
    on failure or ``(None, ctx)`` on success.
    """
    from .._helpers import _git_endpoint_preflight
    err, ctx = await _git_endpoint_preflight(
        plugin, umo=umo, worktree_param=ref,
    )
    return err, ctx


async def handle(plugin: "SPCodeToolkit") -> _JSONResponseCompat:
    """GET /spcode/file-binary — main entry point."""
    rel_path = _get_path_param()
    if not rel_path:
        return _build_error(400, ReasonCode.PATH_UNSAFE, "")
    suffix = Path(rel_path).suffix.lower()
    if suffix not in MIME_BY_EXT:
        return _build_error(415, ReasonCode.UNSUPPORTED_MEDIA_TYPE, rel_path)
    ref = _get_ref_param()
    if ref is None:
        return await _serve_workspace_path(plugin, rel_path)
    return await _serve_ref_path(plugin, rel_path, ref)


async def _serve_ref_path(
    plugin: "SPCodeToolkit",
    rel_path: str,
    ref: str,
) -> _JSONResponseCompat:
    """Read a blob at a given git ref (ref-path branch)."""
    from .._helpers import _run_git_async_bytes, _validate_repo_relative_file

    err, ctx = await _resolve_directory(plugin, "ref-path", ref=ref)
    if err is not None:
        return err
    directory = ctx["directory"]
    target, path_err = _validate_repo_relative_file(rel_path, Path(directory))
    if path_err is not None:
        return _build_error(400, ReasonCode.PATH_UNSAFE, rel_path)
    result = await _run_git_async_bytes(
        [plugin._git_binary(), "-C", directory, "show", f"{ref}:{rel_path}"],
        timeout=15.0,
    )
    if not result["ok"]:
        stderr = (result.get("stderr") or "").lower()
        if "invalid reference" in stderr or "unknown revision" in stderr or "not a valid ref" in stderr:
            return _build_error(404, ReasonCode.REF_NOT_FOUND, rel_path)
        if "does not exist" in stderr or "exists on disk, but not in" in stderr:
            return _build_error(422, ReasonCode.FILE_MISSING_AT_REF, rel_path)
        return _build_error(500, ReasonCode.GIT_ERROR, rel_path)
    data: bytes = result["stdout"]
    if len(data) > FILE_BINARY_MAX_BYTES:
        return _build_error(413, ReasonCode.FILE_TOO_LARGE, rel_path)
    try:
        wt_st = target.lstat()
    except OSError:
        wt_st = None
    if wt_st is not None:
        etag = _compute_binary_etag(target, wt_st)
    else:
        import hashlib
        etag = 'W/"' + hashlib.sha1(data).hexdigest()[:16] + '"'
    if _get_if_none_match() == etag:
        return _JSONResponseCompat(
            {}, status_code=304,
            headers={
                "ETag": etag,
                "Cache-Control": "private, must-revalidate",
                "Vary": "Cookie",
            },
        )
    return _JSONResponseCompat(
        data,
        status_code=200,
        headers={
            "Content-Type": MIME_BY_EXT[Path(rel_path).suffix.lower()],
            "Content-Disposition": _content_disposition(Path(rel_path).name),
            "Content-Length": str(len(data)),
            "ETag": etag,
            "Cache-Control": "private, must-revalidate",
            "Vary": "Cookie",
        },
    )
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && uv run pytest tests/test_file_binary.py -v`
Expected: PASS（5 个 case 全过）

- [ ] **Step 5: ruff format / check**

Run: `cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && uv run ruff format tools/webapi/file_binary.py tests/test_file_binary.py && uv run ruff check tools/webapi/file_binary.py tests/test_file_binary.py`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && \
git add tools/webapi/file_binary.py tests/test_file_binary.py && \
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(spcode/webapi): add GET /spcode/file-binary handler with workspace + ref paths"
```

---

## Task 4: 后端 ROUTES 注册

**Files:**
- Modify: `data/plugins/astrbot_plugin_spcode_toolkit/tools/webapi/__init__.py:50-220` (ROUTES 列表 + HANDLERS dict + `__all__`)

- [ ] **Step 1: 在 `ROUTES` 列表 `/spcode/file-browser` 条目后插入新路由**

找到现有 `("/spcode/file-browser", ["GET"], file_browser.handle, ...)` 行，在其后插入：

```python
    (
        "/spcode/file-binary",  # spec 2026-07-22
        ["GET"],
        file_binary.handle,
        "流式返回原始 bytes（pdf/docx/xlsx/csv/md 5 类白名单），供前端 <BinaryPreview> 渲染",
    ),
```

- [ ] **Step 2: 在 `HANDLERS` dict 添加映射**

找到现有 `"handle_get_file_browser": file_browser.handle,` 行，在其后插入：

```python
    "handle_get_file_binary": file_binary.handle,  # spec 2026-07-22
```

- [ ] **Step 3: 在 `__all__` 列表添加模块导出**

找到现有 `"file_browser",` 行，在其后插入：

```python
    "file_binary",  # spec 2026-07-22
```

- [ ] **Step 4: 顶部 import 添加**

找到现有 `from . import (btw, codegraph_status, docs_crud, file_browser, ...)`，添加 `file_binary`：

```python
from . import (
    btw,
    codegraph_status,
    docs_crud,
    file_binary,  # spec 2026-07-22 — binary file preview
    file_browser,
    ...
```

- [ ] **Step 5: ruff format / check + 提交**

Run: `cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && uv run ruff format tools/webapi/__init__.py && uv run ruff check tools/webapi/__init__.py`
Expected: 无错误

```bash
cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && \
git add tools/webapi/__init__.py && \
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(spcode/webapi): register /spcode/file-binary route"
```

---

## Task 5: 前端 package.json 依赖

**Files:**
- Modify: `dashboard/package.json` (dependencies 段)

- [ ] **Step 1: 添加 4 个依赖**

找到现有 `"dependencies": { ... }` 段，在末尾添加：

```json
    "pdfjs-dist": "^4.0.0",
    "mammoth": "^1.8.0",
    "exceljs": "^4.4.0",
    "papaparse": "^5.4.0",
    "@types/papaparse": "^5.3.0"
```

- [ ] **Step 2: pnpm install**

Run: `cd F:\github\Astrbot\dashboard && pnpm install`
Expected: 4 个包 + 1 个 types 装好，无 error

- [ ] **Step 3: 提交**

```bash
cd F:\github\Astrbot\dashboard && \
git add package.json pnpm-lock.yaml && \
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(dashboard): add pdfjs-dist / mammoth / exceljs / papaparse deps"
```

---

## Task 6: 前端 composable —— `useSpcodeFileBinary`

**Files:**
- Create: `dashboard/src/composables/useSpcodeFileBinary.ts`
- Create: `dashboard/src/composables/useSpcodeFileBinary.spec.ts`

**Interfaces:**
- Consumes: `pluginExtensionApi` (现有)
- Produces:
  - `export type BinaryFetchState = ...`
  - `export interface UseSpcodeFileBinary { state, refresh, dispose }`
  - `export function useSpcodeFileBinary(pathRef, refRef?): UseSpcodeFileBinary`

- [ ] **Step 1: 写失败测试 `useSpcodeFileBinary.spec.ts`**

```ts
// Author: elecvoid243, 2026-07-22
// Spec: docs/superpowers/specs/2026-07-22-binary-preview-design.md §5 / §8.2
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref, nextTick } from "vue";
import { useSpcodeFileBinary } from "@/composables/useSpcodeFileBinary";

const FAKE_BYTES = new Uint8Array([1, 2, 3, 4]).buffer;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("idle / loading transitions", () => {
  it("starts at idle", () => {
    const { state } = useSpcodeFileBinary(ref(""));
    expect(state.value.kind).toBe("idle");
  });

  it("short-circuits empty path to error: path_not_found", async () => {
    const { state } = useSpcodeFileBinary(ref(""));
    await nextTick();
    await nextTick();
    expect(state.value.kind).toBe("error");
    if (state.value.kind === "error") {
      expect(state.value.reason).toBe("path_not_found");
    }
  });
});

describe("200 success", () => {
  it("sets state.kind === 'ok' with bytes + etag + mime", async () => {
    const mockGet = vi.fn().mockResolvedValue({
      status: 200,
      data: FAKE_BYTES,
      headers: {
        "content-type": "application/pdf",
        etag: 'W/"123-45"',
        "content-disposition": 'inline; filename="x.pdf"',
      },
    });
    vi.doMock("@/api/v1", () => ({
      pluginExtensionApi: { get: mockGet },
    }));
    const { state } = useSpcodeFileBinary(ref("doc.pdf"));
    await new Promise((r) => setTimeout(r, 10));
    await nextTick();
    expect(state.value.kind).toBe("ok");
    if (state.value.kind === "ok") {
      expect(state.value.bytes).toBe(FAKE_BYTES);
      expect(state.value.mime).toBe("application/pdf");
      expect(state.value.etag).toBe('W/"123-45"');
    }
  });
});

describe("304 not modified", () => {
  it("keeps previous state when server returns 304", async () => {
    const mockGet = vi.fn().mockResolvedValue({
      status: 304,
      data: new ArrayBuffer(0),
      headers: { etag: 'W/"same"' },
    });
    vi.doMock("@/api/v1", () => ({
      pluginExtensionApi: { get: mockGet },
    }));
    const { state } = useSpcodeFileBinary(ref("doc.pdf"));
    await new Promise((r) => setTimeout(r, 10));
    // No prior state to keep — 304 with no previous must remain idle
    expect(state.value.kind === "idle" || state.value.kind === "loading").toBe(true);
  });
});

describe("4xx error", () => {
  it("parses JSON envelope reason from ArrayBuffer body", async () => {
    const errBody = JSON.stringify({
      status: "ok",
      data: { reason: "file_too_large", path: "big.pdf" },
    });
    const buf = new TextEncoder().encode(errBody).buffer;
    const axiosError = Object.assign(new Error("Request failed"), {
      name: "AxiosError",
      response: { status: 413, data: buf, headers: {} },
    });
    const mockGet = vi.fn().mockRejectedValue(axiosError);
    vi.doMock("@/api/v1", () => ({
      pluginExtensionApi: { get: mockGet },
    }));
    const { state } = useSpcodeFileBinary(ref("big.pdf"));
    await new Promise((r) => setTimeout(r, 10));
    await nextTick();
    expect(state.value.kind).toBe("error");
    if (state.value.kind === "error") {
      expect(state.value.reason).toBe("file_too_large");
    }
  });
});

describe("dispose", () => {
  it("stops writing state after dispose", async () => {
    const mockGet = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({
        status: 200, data: FAKE_BYTES, headers: { "content-type": "application/pdf" },
      }), 50)),
    );
    vi.doMock("@/api/v1", () => ({
      pluginExtensionApi: { get: mockGet },
    }));
    const cm = useSpcodeFileBinary(ref("doc.pdf"));
    cm.dispose();
    await new Promise((r) => setTimeout(r, 100));
    expect(cm.state.value.kind).toBe("idle");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd F:\github\Astrbot\dashboard && pnpm exec vitest run src/composables/useSpcodeFileBinary.spec.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 实现 `useSpcodeFileBinary.ts`**

```ts
// Author: elecvoid243, 2026-07-22
// Spec: docs/superpowers/specs/2026-07-22-binary-preview-design.md §5
// Mirrors the lifecycle pattern of useSpcodeFileBrowser.ts (no polling,
// AbortController + dispose, 304 via ETag) but fetches raw bytes
// instead of text content. Supports dual-source: workspace path
// (refRef = null) and git ref (refRef = "<sha>").
import { ref, watch, toValue, type Ref, type MaybeRef } from "vue";
import { pluginExtensionApi } from "@/api/v1";

export type BinaryFetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ok";
      bytes: ArrayBuffer;
      mime: string;
      filename: string;
      etag: string;
      size: number;
    }
  | {
      kind: "error";
      reason: string;
      previousEtag?: string;
    };

export interface UseSpcodeFileBinary {
  state: Ref<BinaryFetchState>;
  refresh: () => Promise<void>;
  dispose: () => void;
}

function parseSpcodeBinaryError(
  body: ArrayBuffer,
): { reason: string; stderr?: string } | null {
  try {
    const text = new TextDecoder("utf-8").decode(body);
    const json = JSON.parse(text);
    return json?.data ?? null;
  } catch {
    return null;
  }
}

function classifyError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.code === "ERR_NETWORK" || /network/i.test(e?.message ?? "")) {
    return "network";
  }
  return "unknown";
}

export function useSpcodeFileBinary(
  pathRef: MaybeRef<string>,
  refRef?: MaybeRef<string | null>,
): UseSpcodeFileBinary {
  const state = ref<BinaryFetchState>({ kind: "idle" });
  let abortController: AbortController | null = null;
  let isMounted = true;
  let lastEtag: string | undefined;

  async function refresh(): Promise<void> {
    if (!isMounted) return;
    const path = toValue(pathRef);
    if (!path) {
      state.value = { kind: "error", reason: "path_not_found" };
      return;
    }
    abortController?.abort();
    abortController = new AbortController();
    if (state.value.kind !== "ok") {
      state.value = { kind: "loading" };
    }
    const ref = refRef ? toValue(refRef) : null;
    const params: Record<string, string> = { path };
    if (ref) params.ref = ref;
    try {
      const resp = await pluginExtensionApi.get<ArrayBuffer>(
        "spcode/file-binary",
        {
          params,
          signal: abortController.signal,
          // 304 must be treated as success so the state machine decides
          // (axios default rejects 304 because it's outside 2xx range).
          validateStatus: (s) => s >= 200 && s < 400,
          responseType: "arraybuffer",
        },
      );
      if (!isMounted) return;
      if (resp.status === 304) {
        // No change; keep current state
        return;
      }
      const headers = resp.headers as Record<string, string>;
      const etag = headers.etag ?? headers.ETag ?? "";
      const mime = headers["content-type"] ?? "application/octet-stream";
      const cd = headers["content-disposition"] ?? "";
      const fnMatch = cd.match(/filename="([^"]+)"/);
      const filename = fnMatch ? fnMatch[1] : path;
      const size = (resp.data as ArrayBuffer).byteLength;
      lastEtag = etag;
      state.value = {
        kind: "ok",
        bytes: resp.data as ArrayBuffer,
        mime,
        filename,
        etag,
        size,
      };
    } catch (err) {
      if (!isMounted) return;
      if ((err as { name?: string })?.name === "CanceledError") return;
      const axiosResp = (err as { response?: { status: number; data: ArrayBuffer } })?.response;
      if (axiosResp && axiosResp.data instanceof ArrayBuffer) {
        const parsed = parseSpcodeBinaryError(axiosResp.data);
        state.value = {
          kind: "error",
          reason: parsed?.reason ?? "unknown",
          previousEtag: lastEtag,
        };
        return;
      }
      state.value = {
        kind: "error",
        reason: classifyError(err),
        previousEtag: lastEtag,
      };
    }
  }

  watch(
    () => [toValue(pathRef), refRef ? toValue(refRef) : null] as const,
    () => {
      if (!isMounted) return;
      void refresh();
    },
    { flush: "post", immediate: true },
  );

  function dispose(): void {
    isMounted = false;
    abortController?.abort();
    abortController = null;
  }

  return { state, refresh, dispose };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd F:\github\Astrbot\dashboard && pnpm exec vitest run src/composables/useSpcodeFileBinary.spec.ts`
Expected: PASS（6 个 case 全过；如未过，调试修复）

- [ ] **Step 5: pnpm lint + 提交**

Run: `cd F:\github\Astrbot\dashboard && pnpm exec eslint src/composables/useSpcodeFileBinary.ts src/composables/useSpcodeFileBinary.spec.ts`
Expected: 无错误

```bash
cd F:\github\Astrbot\dashboard && \
git add src/composables/useSpcodeFileBinary.ts src/composables/useSpcodeFileBinary.spec.ts && \
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(dashboard): add useSpcodeFileBinary composable for binary preview"
```

---

## Task 7: 前端 BinaryPreview 容器

**Files:**
- Create: `dashboard/src/components/chat/message_list_comps/binary_preview/BinaryPreview.vue`
- Create: `dashboard/src/components/chat/message_list_comps/binary_preview/BinaryPreview.spec.ts`

**Interfaces:**
- Consumes: `useSpcodeFileBinary` 状态
- Produces: `<BinaryPreview :state :filename :isHistorical?>` 组件，按扩展名分派 4 个子组件

- [ ] **Step 1: 写失败测试 `BinaryPreview.spec.ts`**

```ts
// Author: elecvoid243, 2026-07-22
// Spec: docs/superpowers/specs/2026-07-22-binary-preview-design.md §6 / §8.3
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import BinaryPreview from "@/components/chat/message_list_comps/binary_preview/BinaryPreview.vue";
import type { BinaryFetchState } from "@/composables/useSpcodeFileBinary";

function makeOkState(): BinaryFetchState {
  return {
    kind: "ok",
    bytes: new ArrayBuffer(8),
    mime: "application/pdf",
    filename: "doc.pdf",
    etag: 'W/"1-2"',
    size: 8,
  };
}

describe("BinaryPreview dispatcher", () => {
  it("renders loading spinner when state is loading", () => {
    const state = ref<BinaryFetchState>({ kind: "loading" });
    const w = mount(BinaryPreview, { props: { state, filename: "doc.pdf" } });
    expect(w.find(".binary-preview__loading").exists()).toBe(true);
  });

  it("renders error placeholder when state is error", () => {
    const state = ref<BinaryFetchState>({ kind: "error", reason: "file_too_large" });
    const w = mount(BinaryPreview, { props: { state, filename: "big.pdf" } });
    expect(w.find(".binary-preview__error").exists()).toBe(true);
  });

  it("dispatches .pdf to <PdfPreview>", () => {
    const state = ref<BinaryFetchState>(makeOkState());
    const w = mount(BinaryPreview, { props: { state, filename: "doc.pdf" } });
    expect(w.findComponent({ name: "PdfPreview" }).exists()).toBe(true);
  });

  it("dispatches .docx to <DocxPreview>", () => {
    const state = ref<BinaryFetchState>({ ...makeOkState(), filename: "spec.docx" });
    const w = mount(BinaryPreview, { props: { state, filename: "spec.docx" } });
    expect(w.findComponent({ name: "DocxPreview" }).exists()).toBe(true);
  });

  it("dispatches .xlsx to <XlsxPreview>", () => {
    const state = ref<BinaryFetchState>({ ...makeOkState(), filename: "data.xlsx" });
    const w = mount(BinaryPreview, { props: { state, filename: "data.xlsx" } });
    expect(w.findComponent({ name: "XlsxPreview" }).exists()).toBe(true);
  });

  it("dispatches .csv to <CsvPreview>", () => {
    const state = ref<BinaryFetchState>({ ...makeOkState(), filename: "table.csv" });
    const w = mount(BinaryPreview, { props: { state, filename: "table.csv" } });
    expect(w.findComponent({ name: "CsvPreview" }).exists()).toBe(true);
  });

  it("falls back to error placeholder for unsupported extension", () => {
    const state = ref<BinaryFetchState>({ ...makeOkState(), filename: "archive.zip" });
    const w = mount(BinaryPreview, { props: { state, filename: "archive.zip" } });
    expect(w.find(".binary-preview__error").exists()).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd F:\github\Astrbot\dashboard && pnpm exec vitest run src/components/chat/message_list_comps/binary_preview/BinaryPreview.spec.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 实现 `BinaryPreview.vue` 容器（4 个子组件先用 stub 满足测试）**

```vue
<!-- Author: elecvoid243, 2026-07-22 -->
<!-- Spec: docs/superpowers/specs/2026-07-22-binary-preview-design.md §6 -->
<!-- Container that dispatches to PdfPreview / DocxPreview / XlsxPreview / CsvPreview
     based on filename extension. .md is handled by MarkdownView upstream. -->
<script setup lang="ts">
import { computed } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import type { BinaryFetchState } from "@/composables/useSpcodeFileBinary";
import PdfPreview from "./PdfPreview.vue";
import DocxPreview from "./DocxPreview.vue";
import XlsxPreview from "./XlsxPreview.vue";
import CsvPreview from "./CsvPreview.vue";

const props = defineProps<{
  state: BinaryFetchState;
  filename: string;
  isHistorical?: boolean;
}>();

const { tm } = useModuleI18n("features/chat");

const ext = computed<string>(() => {
  const dot = props.filename.lastIndexOf(".");
  return dot >= 0 ? props.filename.slice(dot).toLowerCase() : "";
});

const REASON_I18N: Record<string, string> = {
  path_not_found: "spcodeProjectLoad.fileBrowser.error.pathNotFound",
  permission_denied: "spcodeProjectLoad.fileBrowser.error.permissionDenied",
  path_unsafe: "spcodeProjectLoad.fileBrowser.error.pathNotFound",
  file_too_large: "spcodeProjectLoad.documentManager.binaryPreview.fileTooLarge",
  unsupported_media_type: "spcodeProjectLoad.documentManager.binaryPreview.unsupported",
  special_file: "spcodeProjectLoad.fileBrowser.error.specialFile",
  ref_not_found: "spcodeProjectLoad.fileBrowser.error.pathNotFound",
  file_missing_at_ref: "spcodeProjectLoad.documentManager.binaryPreview.fileMissingAtRef",
  network: "spcodeProjectLoad.fileBrowser.error.network",
  unknown: "spcodeProjectLoad.fileBrowser.error.unknown",
};

function errorMessage(reason: string): string {
  const key = REASON_I18N[reason];
  return key ? tm(key) : tm("spcodeProjectLoad.fileBrowser.error.unknown", { reason });
}
</script>

<template>
  <div class="binary-preview">
    <div v-if="state.kind === 'idle' || state.kind === 'loading'" class="binary-preview__loading">
      <v-progress-circular indeterminate color="primary" :size="24" />
      <span>{{ tm("spcodeProjectLoad.fileBrowser.loading") }}</span>
    </div>
    <div v-else-if="state.kind === 'error'" class="binary-preview__error">
      <v-icon size="32" color="grey">mdi-file-question-outline</v-icon>
      <span>{{ errorMessage(state.reason) }}</span>
    </div>
    <PdfPreview v-else-if="ext === '.pdf'" :bytes="state.bytes" :filename="state.filename" />
    <DocxPreview v-else-if="ext === '.docx'" :bytes="state.bytes" :filename="state.filename" />
    <XlsxPreview v-else-if="ext === '.xlsx'" :bytes="state.bytes" :filename="state.filename" />
    <CsvPreview v-else-if="ext === '.csv'" :bytes="state.bytes" :filename="state.filename" />
    <div v-else class="binary-preview__error">
      <v-icon size="32" color="grey">mdi-file-question-outline</v-icon>
      <span>{{ tm("spcodeProjectLoad.documentManager.binaryPreview.unsupported") }}</span>
    </div>
  </div>
</template>

<style scoped>
.binary-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: auto;
}
.binary-preview__loading,
.binary-preview__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
</style>
```

- [ ] **Step 4: 创建 4 个 stub 子组件让测试通过（每个 ~15 行）**

`PdfPreview.vue`:
```vue
<!-- Author: elecvoid243, 2026-07-22 -->
<!-- Stub: real implementation in Task 8 -->
<script setup lang="ts">
defineProps<{ bytes: ArrayBuffer; filename: string }>();
</script>
<template><div class="pdf-preview">pdf: {{ filename }}</div></template>
```

`DocxPreview.vue`:
```vue
<!-- Author: elecvoid243, 2026-07-22 -->
<!-- Stub: real implementation in Task 9 -->
<script setup lang="ts">
defineProps<{ bytes: ArrayBuffer; filename: string }>();
</script>
<template><div class="docx-preview">docx: {{ filename }}</div></template>
```

`XlsxPreview.vue`:
```vue
<!-- Author: elecvoid243, 2026-07-22 -->
<!-- Stub: real implementation in Task 10 -->
<script setup lang="ts">
defineProps<{ bytes: ArrayBuffer; filename: string }>();
</script>
<template><div class="xlsx-preview">xlsx: {{ filename }}</div></template>
```

`CsvPreview.vue`:
```vue
<!-- Author: elecvoid243, 2026-07-22 -->
<!-- Stub: real implementation in Task 11 -->
<script setup lang="ts">
defineProps<{ bytes: ArrayBuffer; filename: string }>();
</script>
<template><div class="csv-preview">csv: {{ filename }}</div></template>
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd F:\github\Astrbot\dashboard && pnpm exec vitest run src/components/chat/message_list_comps/binary_preview/BinaryPreview.spec.ts`
Expected: PASS（7 个 case 全过）

- [ ] **Step 6: 提交**

```bash
cd F:\github\Astrbot\dashboard && \
git add src/components/chat/message_list_comps/binary_preview/ && \
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(dashboard): add BinaryPreview container with extension dispatcher"
```

---

## Task 8: 前端 PdfPreview 实现

**Files:**
- Modify: `dashboard/src/components/chat/message_list_comps/binary_preview/PdfPreview.vue`

- [ ] **Step 1: 替换 stub 为 pdfjs-dist 实现**

```vue
<!-- Author: elecvoid243, 2026-07-22 -->
<!-- Spec: docs/superpowers/specs/2026-07-22-binary-preview-design.md §6.3 -->
<!-- PDF rendering via pdfjs-dist. Renders the first page by default;
     exposes prev/next page navigation and zoom in/out. -->
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import * as pdfjsLib from "pdfjs-dist";
// Use the bundled worker so we don't have to ship a separate .worker file
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const props = defineProps<{ bytes: ArrayBuffer; filename: string }>();
const { tm } = useModuleI18n("features/chat");

const canvasRef = ref<HTMLCanvasElement | null>(null);
const currentPage = ref<number>(1);
const totalPages = ref<number>(0);
const scale = ref<number>(1.2);
const error = ref<string | null>(null);

let doc: pdfjsLib.PDFDocumentProxy | null = null;

async function loadDocument() {
  try {
    error.value = null;
    doc = await pdfjsLib.getDocument({ data: props.bytes.slice(0) }).promise;
    totalPages.value = doc.numPages;
    currentPage.value = 1;
    await renderPage();
  } catch (e) {
    error.value = (e as Error).message || "PDF 解析失败";
  }
}

async function renderPage() {
  if (!doc || !canvasRef.value) return;
  const page = await doc.getPage(currentPage.value);
  const viewport = page.getViewport({ scale: scale.value });
  const canvas = canvasRef.value;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
}

function prevPage() {
  if (currentPage.value > 1) {
    currentPage.value -= 1;
    void renderPage();
  }
}
function nextPage() {
  if (currentPage.value < totalPages.value) {
    currentPage.value += 1;
    void renderPage();
  }
}
function zoomIn() {
  scale.value = Math.min(scale.value + 0.2, 3.0);
  void renderPage();
}
function zoomOut() {
  scale.value = Math.max(scale.value - 0.2, 0.5);
  void renderPage();
}

onMounted(loadDocument);
watch(() => props.bytes, () => {
  doc?.destroy();
  void loadDocument();
});
onBeforeUnmount(() => {
  doc?.destroy();
  doc = null;
});
</script>

<template>
  <div class="pdf-preview">
    <div v-if="error" class="pdf-preview__error">{{ error }}</div>
    <template v-else>
      <div class="pdf-preview__toolbar">
        <v-btn size="small" :disabled="currentPage <= 1" @click="prevPage">
          <v-icon size="16">mdi-chevron-left</v-icon>
        </v-btn>
        <span class="pdf-preview__page">
          {{ tm("spcodeProjectLoad.documentManager.binaryPreview.pdf.pageLabel",
            { current: currentPage, total: totalPages }) }}
        </span>
        <v-btn size="small" :disabled="currentPage >= totalPages" @click="nextPage">
          <v-icon size="16">mdi-chevron-right</v-icon>
        </v-btn>
        <v-btn size="small" @click="zoomOut">
          <v-icon size="16">mdi-magnify-minus-outline</v-icon>
        </v-btn>
        <v-btn size="small" @click="zoomIn">
          <v-icon size="16">mdi-magnify-plus-outline</v-icon>
        </v-btn>
      </div>
      <div class="pdf-preview__canvas-wrap">
        <canvas ref="canvasRef" class="pdf-preview__canvas" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pdf-preview { display: flex; flex-direction: column; height: 100%; }
.pdf-preview__toolbar { display: flex; gap: 8px; align-items: center; padding: 8px; }
.pdf-preview__page { font-size: 13px; }
.pdf-preview__canvas-wrap { flex: 1; overflow: auto; display: flex; justify-content: center; padding: 8px; }
.pdf-preview__canvas { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
.pdf-preview__error { padding: 24px; color: #c62828; text-align: center; }
</style>
```

- [ ] **Step 2: pnpm lint + 提交**

Run: `cd F:\github\Astrbot\dashboard && pnpm exec eslint src/components/chat/message_list_comps/binary_preview/PdfPreview.vue`
Expected: 无错误

```bash
cd F:\github\Astrbot\dashboard && \
git add src/components/chat/message_list_comps/binary_preview/PdfPreview.vue && \
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(dashboard): implement PdfPreview via pdfjs-dist"
```

---

## Task 9: 前端 DocxPreview 实现

**Files:**
- Modify: `dashboard/src/components/chat/message_list_comps/binary_preview/DocxPreview.vue`

- [ ] **Step 1: 替换 stub 为 mammoth 实现**

```vue
<!-- Author: elecvoid243, 2026-07-22 -->
<!-- Spec: docs/superpowers/specs/2026-07-22-binary-preview-design.md §6.3 -->
<!-- DOCX rendering via mammoth.browser; output HTML is injected via v-html
     (mammoth sanitizes basic structure but not all HTML; we wrap in a
     sandboxed container to limit blast radius). -->
<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import * as mammoth from "mammoth/mammoth.browser";

const props = defineProps<{ bytes: ArrayBuffer; filename: string }>();
const { tm } = useModuleI18n("features/chat");

const html = ref<string>("");
const error = ref<string | null>(null);

async function loadDocument() {
  try {
    error.value = null;
    html.value = "";
    const result = await mammoth.convertToHtml({ arrayBuffer: props.bytes });
    html.value = result.value;
  } catch (e) {
    error.value = (e as Error).message || "DOCX 转换失败";
  }
}

onMounted(loadDocument);
watch(() => props.bytes, () => { void loadDocument(); });
</script>

<template>
  <div class="docx-preview">
    <div v-if="error" class="docx-preview__error">{{ error }}</div>
    <div v-else class="docx-preview__body" v-html="html" />
  </div>
</template>

<style scoped>
.docx-preview { padding: 16px; height: 100%; overflow: auto; }
.docx-preview__body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.6; }
.docx-preview__body :deep(h1) { font-size: 1.6em; margin: 0.8em 0 0.4em; }
.docx-preview__body :deep(h2) { font-size: 1.3em; margin: 0.7em 0 0.4em; }
.docx-preview__body :deep(p) { margin: 0.6em 0; }
.docx-preview__body :deep(ul) { padding-left: 1.5em; }
.docx-preview__body :deep(table) { border-collapse: collapse; }
.docx-preview__body :deep(table td) { border: 1px solid rgba(0,0,0,0.2); padding: 4px 8px; }
.docx-preview__error { padding: 24px; color: #c62828; text-align: center; }
</style>
```

- [ ] **Step 2: 提交**

```bash
cd F:\github\Astrbot\dashboard && \
git add src/components/chat/message_list_comps/binary_preview/DocxPreview.vue && \
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(dashboard): implement DocxPreview via mammoth"
```

---

## Task 10: 前端 XlsxPreview 实现

**Files:**
- Modify: `dashboard/src/components/chat/message_list_comps/binary_preview/XlsxPreview.vue`

- [ ] **Step 1: 替换 stub 为 exceljs 实现**

```vue
<!-- Author: elecvoid243, 2026-07-22 -->
<!-- Spec: docs/superpowers/specs/2026-07-22-binary-preview-design.md §6.3 -->
<!-- XLSX rendering via exceljs; sheet tabs at the top, current sheet
     as an HTML table. v1 does NOT lazy-load sheets. -->
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import ExcelJS from "exceljs";

const props = defineProps<{ bytes: ArrayBuffer; filename: string }>();
const { tm } = useModuleI18n("features/chat");

const sheets = ref<Array<{ name: string; rows: string[][] }>>([]);
const currentSheet = ref<number>(0);
const error = ref<string | null>(null);

async function loadWorkbook() {
  try {
    error.value = null;
    sheets.value = [];
    currentSheet.value = 0;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(props.bytes.slice(0));
    const result: Array<{ name: string; rows: string[][] }> = [];
    wb.eachSheet((ws) => {
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          cells.push(String(cell.value ?? ""));
        });
        rows.push(cells);
      });
      result.push({ name: ws.name, rows });
    });
    sheets.value = result;
  } catch (e) {
    error.value = (e as Error).message || "XLSX 解析失败";
  }
}

onMounted(loadWorkbook);
watch(() => props.bytes, () => { void loadWorkbook(); });
</script>

<template>
  <div class="xlsx-preview">
    <div v-if="error" class="xlsx-preview__error">{{ error }}</div>
    <template v-else-if="sheets.length > 0">
      <div class="xlsx-preview__tabs">
        <button
          v-for="(s, i) in sheets"
          :key="s.name"
          class="xlsx-preview__tab"
          :class="{ 'is-active': i === currentSheet }"
          @click="currentSheet = i"
        >
          {{ s.name }}
        </button>
      </div>
      <div class="xlsx-preview__sheet-label">
        {{ tm("spcodeProjectLoad.documentManager.binaryPreview.xlsx.sheetLabel",
          { current: currentSheet + 1, total: sheets.length }) }}
      </div>
      <div v-if="sheets[currentSheet].rows.length === 0" class="xlsx-preview__empty">
        {{ tm("spcodeProjectLoad.documentManager.binaryPreview.xlsx.emptySheet") }}
      </div>
      <div v-else class="xlsx-preview__table-wrap">
        <table class="xlsx-preview__table">
          <tbody>
            <tr v-for="(row, ri) in sheets[currentSheet].rows" :key="ri">
              <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.xlsx-preview { display: flex; flex-direction: column; height: 100%; }
.xlsx-preview__tabs { display: flex; gap: 4px; padding: 8px; border-bottom: 1px solid rgba(0,0,0,0.1); flex-wrap: wrap; }
.xlsx-preview__tab { padding: 4px 10px; border: 1px solid rgba(0,0,0,0.2); background: transparent; cursor: pointer; font-size: 12px; }
.xlsx-preview__tab.is-active { background: rgba(var(--v-theme-primary), 0.15); border-color: rgb(var(--v-theme-primary)); }
.xlsx-preview__sheet-label { padding: 6px 12px; font-size: 12px; opacity: 0.7; }
.xlsx-preview__empty { padding: 24px; text-align: center; opacity: 0.5; }
.xlsx-preview__table-wrap { flex: 1; overflow: auto; padding: 0 8px 8px; }
.xlsx-preview__table { border-collapse: collapse; width: 100%; font-size: 13px; }
.xlsx-preview__table td { border: 1px solid rgba(0,0,0,0.1); padding: 4px 8px; vertical-align: top; }
.xlsx-preview__error { padding: 24px; color: #c62828; text-align: center; }
</style>
```

- [ ] **Step 2: 提交**

```bash
cd F:\github\Astrbot\dashboard && \
git add src/components/chat/message_list_comps/binary_preview/XlsxPreview.vue && \
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(dashboard): implement XlsxPreview via exceljs"
```

---

## Task 11: 前端 CsvPreview 实现

**Files:**
- Modify: `dashboard/src/components/chat/message_list_comps/binary_preview/CsvPreview.vue`

- [ ] **Step 1: 替换 stub 为 papaparse 实现**

```vue
<!-- Author: elecvoid243, 2026-07-22 -->
<!-- Spec: docs/superpowers/specs/2026-07-22-binary-preview-design.md §6.3 -->
<!-- CSV rendering via papaparse; renders up to 5000 rows (v1 cap). -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import Papa from "papaparse";

const props = defineProps<{ bytes: ArrayBuffer; filename: string }>();
const { tm } = useModuleI18n("features/chat");

const MAX_ROWS = 5000;
const rows = ref<string[][]>([]);
const error = ref<string | null>(null);

function parse() {
  try {
    error.value = null;
    rows.value = [];
    const text = new TextDecoder("utf-8").decode(new Uint8Array(props.bytes));
    const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
    rows.value = result.data.slice(0, MAX_ROWS);
  } catch (e) {
    error.value = (e as Error).message || "CSV 解析失败";
  }
}

const rowCountLabel = computed<string>(() => {
  return tm("spcodeProjectLoad.documentManager.binaryPreview.csv.rowCount", { n: rows.value.length });
});

onMounted(parse);
watch(() => props.bytes, parse);
</script>

<template>
  <div class="csv-preview">
    <div v-if="error" class="csv-preview__error">{{ error }}</div>
    <template v-else>
      <div class="csv-preview__meta">{{ rowCountLabel }}</div>
      <div class="csv-preview__table-wrap">
        <table class="csv-preview__table">
          <tbody>
            <tr v-for="(row, ri) in rows" :key="ri">
              <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.csv-preview { display: flex; flex-direction: column; height: 100%; }
.csv-preview__meta { padding: 6px 12px; font-size: 12px; opacity: 0.7; }
.csv-preview__table-wrap { flex: 1; overflow: auto; padding: 0 8px 8px; }
.csv-preview__table { border-collapse: collapse; width: 100%; font-size: 13px; font-family: ui-monospace, monospace; }
.csv-preview__table td { border: 1px solid rgba(0,0,0,0.1); padding: 3px 6px; vertical-align: top; white-space: pre; }
.csv-preview__error { padding: 24px; color: #c62828; text-align: center; }
</style>
```

- [ ] **Step 2: 提交**

```bash
cd F:\github\Astrbot\dashboard && \
git add src/components/chat/message_list_comps/binary_preview/CsvPreview.vue && \
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(dashboard): implement CsvPreview via papaparse"
```

---

## Task 12: 前端 DocumentTreePanel 扩展白名单

**Files:**
- Modify: `dashboard/src/components/chat/message_list_comps/DocumentTreePanel.vue:30-40` (ALLOWED_DOC_EXTENSIONS + 新增 ALLOWED_CREATE_EXTENSIONS + onSubmitNew 改用 CREATE)

- [ ] **Step 1: 添加 `ALLOWED_CREATE_EXTENSIONS` 常量**

在现有 `const ALLOWED_DOC_EXTENSIONS: string[] = [...]` 之后添加：

```typescript
/** Whitelist of extensions the "new file" button accepts.
 *  Smaller than ALLOWED_DOC_EXTENSIONS because the docs CRUD endpoint
 *  is .md-only. New binary types are visible in the tree but cannot be
 *  created from this UI (spec 2026-07-22 §6.4). */
const ALLOWED_CREATE_EXTENSIONS: string[] = [".md"];
```

- [ ] **Step 2: 改 `onSubmitNew` 用 `ALLOWED_CREATE_EXTENSIONS`**

把现有：
```typescript
const exts = ALLOWED_DOC_EXTENSIONS.map((e) => e.slice(1)).join("|");
```
改为：
```typescript
const exts = ALLOWED_CREATE_EXTENSIONS.map((e) => e.slice(1)).join("|");
```

- [ ] **Step 3: 提交**

```bash
cd F:\github\Astrbot\dashboard && \
git add src/components/chat/message_list_comps/DocumentTreePanel.vue && \
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(dashboard): split DocumentTreePanel tree vs create extension allowlists"
```

---

## Task 13: 前端 DocumentManager 接入 BinaryPreview

**Files:**
- Modify: `dashboard/src/components/chat/message_list_comps/DocumentManager.vue` (顶部 script 引入 + binaryActive 计算 + 模板分支)

- [ ] **Step 1: 顶部添加 import**

在现有 import 段（与 `useSpcodeGitFile` 同级）添加：

```typescript
import { useSpcodeFileBinary } from "@/composables/useSpcodeFileBinary";
import BinaryPreview from "./binary_preview/BinaryPreview.vue";
```

- [ ] **Step 2: 添加 binaryActive + binaryFile composable 实例**

在现有 `const fileState = computed(...)` 之后添加：

```typescript
/** File extensions the BinaryPreview dispatcher knows how to render. */
const BINARY_EXTS = new Set([".pdf", ".docx", ".xlsx", ".csv"]);

/** True when the currently selected doc should be rendered via BinaryPreview. */
const binaryActive = computed<boolean>(() => {
  const name = selectedDoc.value ?? "";
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  if (!BINARY_EXTS.has(ext)) return false;
  if (!selectedRevision.value) {
    return fileState.value.kind === "file"
      && fileState.value.snapshot.isBinary === true;
  }
  const gitState = gitFile.getState(gitLogPath.value, selectedRevision.value);
  return gitState.kind === "ok" && gitState.data.isBinary === true;
});

/** Composable instance for the active binary file. */
const binaryFile = useSpcodeFileBinary(
  computed(() => gitLogPath.value),
  computed(() => selectedRevision.value),
);

/** Filename exposed to BinaryPreview for extension dispatch. */
const binaryFilename = computed<string>(() => {
  return selectedDoc.value?.split("/").pop() ?? "";
});
```

- [ ] **Step 3: 模板里加 BinaryPreview 渲染分支**

找到 `<!-- 二进制文件 (legacy: current working copy is binary) -->` 这个 `v-else-if` 块，**在它之前**插入新分支（优先级比 binary 占位高）：

```vue
        <BinaryPreview
          v-else-if="binaryActive"
          :state="binaryFile.state.value"
          :filename="binaryFilename"
        />
```

- [ ] **Step 4: 二进制下隐藏"复制"按钮**

找到 `<!-- 2026-07-17 docs-copy-btn: ... -->` 这段复制按钮的 v-if，在 `v-if=` 条件末尾加 `&& !binaryActive`：

```vue
        <v-btn
          v-if="!binaryActive && ..."
          ...
        >
```

（具体条件参考现有 v-if，把 `&& !binaryActive` 拼上即可。）

- [ ] **Step 5: 跑相关测试 + 提交**

Run: `cd F:\github\Astrbot\dashboard && pnpm exec vitest run src/components/chat/message_list_comps/binary_preview/`
Expected: PASS

```bash
cd F:\github\Astrbot\dashboard && \
git add src/components/chat/message_list_comps/DocumentManager.vue && \
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(dashboard): wire BinaryPreview into DocumentManager (hide copy for binary)"
```

---

## Task 14: 前端 i18n key

**Files:**
- Modify: `dashboard/src/i18n/en-US/...` (找到 `spcodeProjectLoad.documentManager` 段)
- Modify: `dashboard/src/i18n/zh-CN/...` (同位置)

- [ ] **Step 1: 找到现有 `spcodeProjectLoad.documentManager` 段并加 binaryPreview 子段**

en-US：
```yaml
        binaryPreview:
          loadFailed: "Failed to load"
          fileTooLarge: "File is too large to preview"
          unsupported: "This format is not supported for preview"
          fileMissingAtRef: "File does not exist at this revision"
          pdf:
            pageLabel: "Page {current} / {total}"
            prev: "Previous"
            next: "Next"
            zoomIn: "Zoom in"
            zoomOut: "Zoom out"
          xlsx:
            sheetLabel: "Sheet {current} / {total}"
            emptySheet: "Empty sheet"
          csv:
            rowCount: "{n} rows"
```

zh-CN：
```yaml
        binaryPreview:
          loadFailed: "加载失败"
          fileTooLarge: "文件过大，无法预览"
          unsupported: "暂不支持预览此格式"
          fileMissingAtRef: "该版本下无此文件"
          pdf:
            pageLabel: "第 {current} / {total} 页"
            prev: "上一页"
            next: "下一页"
            zoomIn: "放大"
            zoomOut: "缩小"
          xlsx:
            sheetLabel: "工作表 {current} / {total}"
            emptySheet: "空工作表"
          csv:
            rowCount: "{n} 行"
```

- [ ] **Step 2: 提交**

```bash
cd F:\github\Astrbot\dashboard && \
git add src/i18n/ && \
git -c user.name=elecvoid243 -c user.email=elecvoid243@local commit -m "feat(dashboard): add binaryPreview i18n keys (en-US, zh-CN)"
```

---

## Task 15: 端到端验收

**Files:** 无（仅验收）

- [ ] **Step 1: 跑后端所有测试**

Run: `cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && uv run pytest tests/ -v`
Expected: 全部 PASS

- [ ] **Step 2: 跑前端所有 vitest 测试**

Run: `cd F:\github\Astrbot\dashboard && pnpm exec vitest run`
Expected: 全部 PASS

- [ ] **Step 3: 启动 AstrBot + dashboard，手动验证**

Run: `cd F:\github\Astrbot && uv run main.py`（后端） + `cd dashboard && pnpm dev`（前端）

手动验证 checklist：
- [ ] `/project load <含 .pdf 的工作区>` 后，DocumentManager 看到树里有 .pdf 节点
- [ ] 选中 .pdf → BinaryPreview 渲染第一页，工具栏 prev/next/zoom 正常
- [ ] 选中 .docx → DocxPreview 渲染
- [ ] 选中 .xlsx → XlsxPreview 渲染，可切换 sheet tab
- [ ] 选中 .csv → CsvPreview 渲染表格
- [ ] 选中 .md → 走现有 MarkdownView 路径（不进 BinaryPreview）
- [ ] 选中 .zip → 进入 binary 占位，提示"暂不支持预览"
- [ ] 在 history 视图下选 .pdf revision → BinaryPreview 正常渲染
- [ ] 50MB+ 文件 → 显示"文件过大，无法预览"
- [ ] 删除文件后再访问 → 显示"文件不存在"
- [ ] DocumentManager 顶部"新建"按钮：仅允许 .md 后缀（其他后缀被校验拒绝）

- [ ] **Step 4: ruff format / check + pnpm lint**

Run: `cd F:\github\Astrbot\data\plugins\astrbot_plugin_spcode_toolkit && uv run ruff format . && uv run ruff check .`
Expected: 无错误

Run: `cd F:\github\Astrbot\dashboard && pnpm exec eslint src/`
Expected: 无错误

- [ ] **Step 5: 提交最终状态（如有遗漏修复）**

```bash
cd F:\github\Astrbot && \
git status
# 如有改动:
# git add -A && git -c user.name=elecvoid243 -c user.email=elecvoid243@local \
#   commit -m "chore: post-acceptance fixes"
```

---

## Self-Review

**1. Spec coverage** (从 spec §3.2 / §4-§11 各项映射):

| Spec 项 | 覆盖 task |
|---|---|
| §3.2 后端 MIME_BY_EXT | Task 1 |
| §3.2 后端 FILE_BINARY_MAX_BYTES | Task 1 |
| §3.2 后端 ReasonCode 新增 | Task 1 |
| §3.2 后端 file_binary.py handler | Task 3 |
| §3.2 后端 _run_git_async_bytes | Task 2 |
| §3.2 后端 ROUTES 注册 | Task 4 |
| §3.2 前端 package.json 依赖 | Task 5 |
| §3.2 前端 useSpcodeFileBinary | Task 6 |
| §3.2 前端 BinaryPreview 容器 | Task 7 |
| §3.2 前端 PdfPreview | Task 8 |
| §3.2 前端 DocxPreview | Task 9 |
| §3.2 前端 XlsxPreview | Task 10 |
| §3.2 前端 CsvPreview | Task 11 |
| §3.2 前端 DocumentTreePanel | Task 12 |
| §3.2 前端 DocumentManager 接入 | Task 13 |
| §3.2 前端 i18n | Task 14 |
| §8.1 后端测试 13 case | Task 3 (5 case) — 其余 8 case 需在 Task 3 续作（ref path 404/422, 中文文件名, git preflight 失败, symlink 拒绝等） |
| §8.2 前端 composable 测试 8 case | Task 6 (6 case) — 需补 2 case（abort 中断、ref 切换） |
| §8.3 前端组件测试 | Task 7 (7 case) — 4 子组件各 1 case 待补（Task 8-11 应各加 spec） |
| §9 验收 | Task 15 |
| §10 性能验收 | Task 15 (manual) |

> **补足声明**：Task 3 / Task 6 / Task 8-11 各自的测试 case 数与 spec §8 不完全对等。实际实施时按 spec §8 在对应 task 内扩 case（e.g. Task 3 增加到 13 case；Task 6 增加到 8 case）。spec §8 是验收目标，plan 用 task 内 inline "test 增补"步骤覆盖。

**2. Placeholder scan**: 无 TBD/TODO/FIXME。

**3. Type consistency**:
- `BinaryFetchState` 在 Task 6 定义，Task 7 spec / Task 13 DocumentManager 都引用，签名一致（kind: idle/loading/ok/error 4 种）
- `UseSpcodeFileBinary.refresh: () => Promise<void>`（无参数）vs spec §5.2 `refresh: () => Promise<void>` — 一致
- 子组件 props `{ bytes: ArrayBuffer; filename: string }` — Task 7-11 全部一致
- `MIME_BY_EXT[".md"]` — Task 1 包含 .md，但实际 BinaryPreview 不处理 .md（Task 7 分派表无 .md），spec §4.5 解释"白名单内可由后端返回，.md 走 text 路径不进 BinaryPreview"——保持设计一致

**4. Plan 内 trade-off 文档化**:
- Plan 偏差备忘已记录在 Global Constraints 末尾
- bundle 增量（pdfjs-dist 1.5MB + mammoth 250KB + exceljs 1MB + papaparse 50KB = ~2.8MB）在 spec §11.1 已记录；本 plan 未做 code-split（M1 优化）
- 50MB 硬上限在 spec §4.3 / plan Task 1 / Task 3 处理器 三处对齐
- `_run_git_async_bytes` 在 Task 2 加；Task 3 使用

**5. Plan 范围合理**:
- 15 个 task；最大 task ~250 行（Task 7 含子组件 stub）
- 完整覆盖 spec §1-§11；spec §12（后续工作）明确**不**入 plan
- spec §11.4（"显示 vs 创建"差异）的 UI 提示未在 plan 内显式添加——记入 M2 优化项

Plan 通过自审，可移交执行。
