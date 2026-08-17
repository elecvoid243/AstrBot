# Agent Collab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

- Author: elecvoid243
- Date: 2026-08-12
- Spec: `docs/superpowers/specs/2026-08-12-agent-collab-design.md`
- Branch: `feat/agent-collab` (worktree: `F:\github\Astrbot\.worktrees\feat-agent-collab`)

**Goal:** 在 dashboard 实现跨 webchat 会话的 agent 协作：绑定组 + 主持人路由讨论 + 聚合时间线实时可见。

**Architecture:** 新增 `AgentCollabService`（路由状态机），投递复用 webchat 输入队列契约（orphan turn 路径，各会话页零改动实时可见），观察复用 `webchat_queue_mgr.subscribe_system` + `BotMessageAccumulator`。指令协议为 fenced `collab-route` JSON 块。前端新增协作面板/绑定对话框/路由卡片。

**Tech Stack:** Python 3.10+ (FastAPI/Starlette dashboard), asyncio, pytest; Vue 3 + Vuetify + TypeScript。

## Global Constraints

- 仅 webchat 会话可绑定；UMO 格式 `webchat:FriendMessage:{session_id}`。
- 主持人路由（星型）；2 人组退化为一问一答，仅识别 `{"action": "end"}`。
- 路由指令 = fenced ` ```collab-route ` JSON 块，必须在回复末尾且至多一个；schema 严格校验。
- `target` 两级匹配：别名精确（归一化）→ 会话 ID 末尾 8 位后缀兜底。
- hop_limit 默认 50；回复收集超时 180s；busy 轮询间隔 2s。
- busy = `chat_runs_by_session` 非空 或 该会话有进行中 collab turn → 消息 pending，空闲自动投递。
- **存储偏离声明**：绑定组持久化用 `sp`（`sp.get/sp.put`，key=`agent_collab_groups`），沿用 `session_management_service` 的 `session_groups` 先例，替代 spec 中的 sqlite 新表——零迁移、同形态数据既有模式。
- API 走 legacy_router 模式（`/api/agent_collab/*`），不进 OpenAPI schema，无需 `pnpm generate:api`。
- 所有注释/日志用英文；docstring 用 Google 格式；提交用 conventional commits；只本地提交，不推送。
- Python 代码完成后 `ruff format` + `ruff check` 必须通过。

---

### Task 1: 路由指令解析器（纯函数模块）

**Files:**
- Create: `astrbot/dashboard/services/agent_collab_directive.py`
- Test: `tests/unit/test_agent_collab_directive.py`

**Interfaces:**
- Consumes: nothing (pure stdlib)
- Produces:
  - `RouteDirective(target: str, mode: Literal["forward","literal"], content: str | None)`
  - `EndDirective(summary: str)`
  - `DirectiveParseResult(directive: RouteDirective | EndDirective | None, error: str | None)`
  - `extract_directive(reply: str) -> DirectiveParseResult` — `error=None, directive=None` 表示回复中没有指令块
  - `resolve_target(target: str, members: list[dict]) -> str | None` — members 元素为 `{"session_id": str, "alias": str}`；返回命中的 session_id
  - `build_moderator_injection(aliases: list[str], sender_label: str, text: str) -> str`（>2 人组）
  - `build_moderator_pair_injection(sender_label: str, text: str) -> str`（2 人组）
  - `build_member_injection(sender_label: str, text: str) -> str`

- [x] **Step 1: Write the failing test**

```python
# tests/unit/test_agent_collab_directive.py
from astrbot.dashboard.services.agent_collab_directive import (
    EndDirective,
    RouteDirective,
    build_member_injection,
    build_moderator_injection,
    build_moderator_pair_injection,
    extract_directive,
    resolve_target,
)

MEMBERS = [
    {"session_id": "webchat!alice!aaaaaaaa1111", "alias": "编程agent"},
    {"session_id": "webchat!alice!bbbbbbbb2222", "alias": "文档agent"},
    {"session_id": "webchat!alice!cccccccc3333", "alias": "cccccccc"},  # default alias
]


def _route_reply(target: str, mode: str = "forward", content: str | None = None) -> str:
    import json

    payload = {"action": "route", "target": target, "mode": mode}
    if content is not None:
        payload["content"] = content
    return f"好的，我来安排。\n```collab-route\n{json.dumps(payload, ensure_ascii=False)}\n```"


def test_extract_route_forward():
    r = extract_directive(_route_reply("编程agent"))
    assert r.error is None
    assert isinstance(r.directive, RouteDirective)
    assert r.directive.target == "编程agent"
    assert r.directive.mode == "forward"
    assert r.directive.content is None


def test_extract_route_literal_requires_content():
    r = extract_directive(_route_reply("编程agent", mode="literal"))
    assert r.directive is None
    assert r.error is not None


def test_extract_end():
    r = extract_directive('总结如下。\n```collab-route\n{"action": "end", "summary": "done"}\n```')
    assert r.error is None
    assert isinstance(r.directive, EndDirective)
    assert r.directive.summary == "done"


def test_no_block_is_not_error():
    r = extract_directive("普通回复，没有指令。")
    assert r.directive is None and r.error is None


def test_multiple_blocks_is_error():
    r = extract_directive(_route_reply("a") + "\n" + _route_reply("b"))
    assert r.directive is None and r.error is not None


def test_block_not_trailing_is_error():
    r = extract_directive(_route_reply("编程agent") + "\n还有话要说。")
    assert r.directive is None and r.error is not None


def test_invalid_json_is_error():
    r = extract_directive("x\n```collab-route\n{not json}\n```")
    assert r.directive is None and r.error is not None


def test_unknown_field_rejected():
    r = extract_directive(
        'x\n```collab-route\n{"action": "route", "target": "编程agent", "mode": "forward", "evil": 1}\n```'
    )
    assert r.directive is None and r.error is not None


def test_resolve_target_alias_exact_normalized():
    assert resolve_target(" 编程AGENT ", MEMBERS) is None  # case-sensitive for CJK, but whitespace trimmed
    assert resolve_target("编程agent", MEMBERS) == "webchat!alice!aaaaaaaa1111"


def test_resolve_target_suffix_fallback():
    assert resolve_target("bbbbbbbb2222"[-8:], MEMBERS) == "webchat!alice!bbbbbbbb2222"
    assert resolve_target("bbbb2222", MEMBERS) == "webchat!alice!bbbbbbbb2222"


def test_resolve_target_miss():
    assert resolve_target("不存在", MEMBERS) is None


def test_injection_builders():
    m = build_moderator_injection(["编程agent", "文档agent"], "用户alice", "讨论主题")
    assert "编程agent" in m and "collab-route" in m and "讨论主题" in m
    p = build_moderator_pair_injection("对方", "你好")
    assert "end" in p and "route" not in p
    assert build_member_injection("编程agent", "内容") == "[来自 编程agent]: 内容"
```

- [x] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_agent_collab_directive.py -v`
Expected: FAIL (ModuleNotFoundError)

- [x] **Step 3: Write the implementation**

```python
# astrbot/dashboard/services/agent_collab_directive.py
"""Routing directive protocol for agent collab discussions.

Directive carrier: a fenced ```collab-route code block containing one JSON
object, placed as the last non-empty block of the moderator's reply.
"""

import json
import re
from dataclasses import dataclass
from typing import Literal

DIRECTIVE_BLOCK_RE = re.compile(r"```collab-route[ \t]*\n(.*?)```", re.DOTALL)

_ROUTE_KEYS = {"action", "target", "mode", "content"}
_END_KEYS = {"action", "summary"}


@dataclass
class RouteDirective:
    target: str
    mode: Literal["forward", "literal"]
    content: str | None = None


@dataclass
class EndDirective:
    summary: str


@dataclass
class DirectiveParseResult:
    directive: RouteDirective | EndDirective | None
    error: str | None  # None together with directive=None means: no block found


def extract_directive(reply: str) -> DirectiveParseResult:
    """Extract the trailing collab-route directive block from a reply.

    Args:
        reply: The moderator's full reply text.

    Returns:
        DirectiveParseResult; error is set when a block exists but is invalid
        (multiple blocks, not trailing, bad JSON, schema violation).
    """
    blocks = list(DIRECTIVE_BLOCK_RE.finditer(reply))
    if not blocks:
        return DirectiveParseResult(None, None)
    if len(blocks) > 1:
        return DirectiveParseResult(None, "multiple collab-route blocks")
    block = blocks[0]
    if reply[block.end() :].strip():
        return DirectiveParseResult(None, "collab-route block is not trailing")
    try:
        data = json.loads(block.group(1))
    except json.JSONDecodeError as e:
        return DirectiveParseResult(None, f"invalid JSON: {e}")
    if not isinstance(data, dict):
        return DirectiveParseResult(None, "directive is not a JSON object")
    action = data.get("action")
    if action == "route":
        if set(data) - _ROUTE_KEYS:
            return DirectiveParseResult(None, "unknown fields in route directive")
        target = data.get("target")
        mode = data.get("mode")
        content = data.get("content")
        if not isinstance(target, str) or not target.strip():
            return DirectiveParseResult(None, "route.target missing")
        if mode not in ("forward", "literal"):
            return DirectiveParseResult(None, "route.mode must be forward|literal")
        if mode == "literal" and (not isinstance(content, str) or not content.strip()):
            return DirectiveParseResult(None, "route.content required for literal mode")
        if content is not None and not isinstance(content, str):
            return DirectiveParseResult(None, "route.content must be a string")
        return DirectiveParseResult(RouteDirective(target.strip(), mode, content), None)
    if action == "end":
        if set(data) - _END_KEYS:
            return DirectiveParseResult(None, "unknown fields in end directive")
        summary = data.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            return DirectiveParseResult(None, "end.summary missing")
        return DirectiveParseResult(EndDirective(summary.strip()), None)
    return DirectiveParseResult(None, "unknown action")


def resolve_target(target: str, members: list[dict]) -> str | None:
    """Resolve a route target to a session id.

    Two-level matching: exact alias match (whitespace-trimmed), then fallback
    to the trailing 8 characters of the session id.

    Args:
        target: The target string from the directive.
        members: Group members, each {"session_id": str, "alias": str}.

    Returns:
        The matched session id, or None.
    """
    needle = target.strip()
    for m in members:
        if m["alias"] == needle:
            return m["session_id"]
    if len(needle) == 8:
        lowered = needle.lower()
        for m in members:
            if m["session_id"][-8:].lower() == lowered:
                return m["session_id"]
    return None


def build_moderator_injection(aliases: list[str], sender_label: str, text: str) -> str:
    """Build the injected message for the moderator session (>2 members)."""
    roster = ", ".join(aliases)
    return (
        f"[协作讨论] 成员名册: {roster}\n"
        "[协作讨论] 你是本场讨论的主持人。收到成员回复后，你必须在回复末尾输出一个路由指令块（且只能有一个）：\n"
        "```collab-route\n"
        '{"action": "route", "target": "<成员别名>", "mode": "forward"}\n'
        "```\n"
        "  mode=forward: 把该成员回复的原文直接转给 target（content 字段可填你的补充说明）\n"
        "  mode=literal: 把 content 字段中你加工后的内容转给 target\n"
        '  结束讨论则输出: {"action": "end", "summary": "<总结>"}\n'
        f"[来自 {sender_label}]: {text}"
    )


def build_moderator_pair_injection(sender_label: str, text: str) -> str:
    """Build the injected message for the moderator in a 2-member group."""
    return (
        "[协作讨论] 你在与对方进行连续讨论，需要结束时在回复末尾输出一个指令块：\n"
        "```collab-route\n"
        '{"action": "end", "summary": "<总结>"}\n'
        "```\n"
        f"[来自 {sender_label}]: {text}"
    )


def build_member_injection(sender_label: str, text: str) -> str:
    """Build the injected message for a member session."""
    return f"[来自 {sender_label}]: {text}"
```

- [x] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_agent_collab_directive.py -v`
Expected: PASS (12 tests)

- [x] **Step 5: Commit**

```bash
git add astrbot/dashboard/services/agent_collab_directive.py tests/unit/test_agent_collab_directive.py
git commit -m "feat: add collab-route directive parser and injection builders"
```

---

### Task 2: 绑定组 CRUD（AgentCollabService 第一部分）

**Files:**
- Create: `astrbot/dashboard/services/agent_collab_service.py`
- Test: `tests/unit/test_agent_collab_groups.py`

**Interfaces:**
- Consumes: `astrbot.core.sp`（同步 `sp.get`/`sp.put`，先例见 `session_management_service.py`）
- Produces:
  - `AgentCollabServiceError(Exception)`
  - `AgentCollabService.create_group(username, payload) -> dict` / `update_group(username, group_id, payload)` / `delete_group(username, group_id)` / `list_groups(username) -> dict`
  - 组 dict 结构：`{"id", "name", "owner_username", "members": [{"session_id", "alias"}], "moderator_session_id", "created_at"}`
  - `default_alias(session_id: str) -> str`（末尾 8 位）

- [x] **Step 1: Write the failing test**

```python
# tests/unit/test_agent_collab_groups.py
import pytest

from astrbot.core import sp
from astrbot.dashboard.services.agent_collab_service import (
    AgentCollabService,
    AgentCollabServiceError,
    default_alias,
)


@pytest.fixture
def service():
    sp.put("agent_collab_groups", {})
    yield AgentCollabService()
    sp.put("agent_collab_groups", {})


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


def test_create_and_list(service):
    g = service.create_group("alice", _payload())
    assert g["members"][0]["alias"] == "编程agent"
    groups = service.list_groups("alice")["groups"]
    assert len(groups) == 1 and groups[0]["id"] == g["id"]


def test_alias_defaults_to_suffix(service):
    g = service.create_group(
        "alice",
        _payload(members=[{"session_id": "webchat!u!aaaaaaaa11"},
                          {"session_id": "webchat!u!bbbbbbbb22", "alias": "文档agent"}]),
    )
    assert g["members"][0]["alias"] == "aaaaaa11"


def test_create_requires_two_members(service):
    with pytest.raises(AgentCollabServiceError):
        service.create_group("alice", _payload(members=[{"session_id": "x123456789"}]))


def test_moderator_must_be_member(service):
    with pytest.raises(AgentCollabServiceError):
        service.create_group("alice", _payload(moderator_session_id="webchat!u!zzzzzzzz99"))


def test_alias_must_be_unique(service):
    with pytest.raises(AgentCollabServiceError):
        service.create_group(
            "alice",
            _payload(members=[{"session_id": "webchat!u!aaaaaaaa11", "alias": "same"},
                              {"session_id": "webchat!u!bbbbbbbb22", "alias": " same "}]),
        )


def test_suffix_collision_rejected(service):
    with pytest.raises(AgentCollabServiceError):
        service.create_group(
            "alice",
            _payload(members=[{"session_id": "webchat!u!xxaaaaaa11"},
                              {"session_id": "webchat!u!yyaaaaaa11"}]),
        )


def test_update_alias_and_moderator(service):
    g = service.create_group("alice", _payload())
    updated = service.update_group("alice", g["id"], {
        "members": [{"session_id": "webchat!u!aaaaaaaa11", "alias": "coder"},
                    {"session_id": "webchat!u!bbbbbbbb22", "alias": "docs"}],
        "moderator_session_id": "webchat!u!bbbbbbbb22",
    })
    assert updated["moderator_session_id"] == "webchat!u!bbbbbbbb22"


def test_delete_group(service):
    g = service.create_group("alice", _payload())
    service.delete_group("alice", g["id"])
    assert service.list_groups("alice")["groups"] == []


def test_other_user_isolated(service):
    service.create_group("alice", _payload())
    assert service.list_groups("bob")["groups"] == []
    with pytest.raises(AgentCollabServiceError):
        service.delete_group("bob", "whatever")
```

- [x] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_agent_collab_groups.py -v`
Expected: FAIL (ModuleNotFoundError)

- [x] **Step 3: Write the implementation**

```python
# astrbot/dashboard/services/agent_collab_service.py
"""Agent collab service: session binding groups and moderated discussions."""

import uuid
from datetime import datetime, timezone

from astrbot.core import sp

_GROUPS_KEY = "agent_collab_groups"
_ALIAS_MAX_LEN = 32


class AgentCollabServiceError(Exception):
    """Raised for agent collab service errors."""


def default_alias(session_id: str) -> str:
    """Return the default alias: trailing 8 chars of the session id."""
    return session_id[-8:]


class AgentCollabService:
    """Manages collab groups (persisted via sp) and discussion runners."""

    def __init__(self) -> None:
        self.discussions: dict[str, dict] = {}  # discussion runtime state (Task 3+)

    # ---------- group persistence ----------

    def _load(self) -> dict:
        return sp.get(_GROUPS_KEY, {})

    def _save(self, groups: dict) -> None:
        sp.put(_GROUPS_KEY, groups)

    def _validate_members(self, members: list, moderator_session_id: str) -> list[dict]:
        """Validate and normalize the member list.

        Args:
            members: Raw member dicts with session_id and optional alias.
            moderator_session_id: Must be one of the member session ids.

        Returns:
            Normalized members with aliases filled.

        Raises:
            AgentCollabServiceError: On any validation failure.
        """
        if not isinstance(members, list) or len(members) < 2:
            raise AgentCollabServiceError("至少需要绑定 2 个会话")
        normalized = []
        aliases: set[str] = set()
        suffixes: set[str] = set()
        for m in members:
            sid = str(m.get("session_id") or "").strip()
            if not sid:
                raise AgentCollabServiceError("session_id 不能为空")
            alias = str(m.get("alias") or "").strip() or default_alias(sid)
            if len(alias) > _ALIAS_MAX_LEN:
                raise AgentCollabServiceError(f"别名过长（>{_ALIAS_MAX_LEN} 字符）: {alias}")
            key = alias.lower()
            if key in aliases:
                raise AgentCollabServiceError(f"别名重复: {alias}")
            aliases.add(key)
            suffix = sid[-8:].lower()
            if suffix in suffixes:
                raise AgentCollabServiceError("会话 ID 末尾 8 位冲突，请更换会话组合")
            suffixes.add(suffix)
            normalized.append({"session_id": sid, "alias": alias})
        if moderator_session_id not in {m["session_id"] for m in normalized}:
            raise AgentCollabServiceError("主持人必须是组内成员")
        return normalized

    def create_group(self, username: str, payload: dict) -> dict:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise AgentCollabServiceError("分组名称不能为空")
        members = self._validate_members(
            payload.get("members") or [],
            str(payload.get("moderator_session_id") or ""),
        )
        groups = self._load()
        group_id = uuid.uuid4().hex[:8]
        group = {
            "id": group_id,
            "name": name,
            "owner_username": username,
            "members": members,
            "moderator_session_id": str(payload["moderator_session_id"]),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        groups[group_id] = group
        self._save(groups)
        return group

    def list_groups(self, username: str) -> dict:
        return {
            "groups": [
                g for g in self._load().values() if g["owner_username"] == username
            ]
        }

    def _get_owned(self, username: str, group_id: str) -> dict:
        groups = self._load()
        group = groups.get(group_id)
        if not group or group["owner_username"] != username:
            raise AgentCollabServiceError(f"分组 '{group_id}' 不存在")
        return group

    def update_group(self, username: str, group_id: str, payload: dict) -> dict:
        groups = self._load()
        group = self._get_owned(username, group_id)
        if "name" in payload:
            name = str(payload["name"] or "").strip()
            if not name:
                raise AgentCollabServiceError("分组名称不能为空")
            group["name"] = name
        if "members" in payload or "moderator_session_id" in payload:
            members = payload.get("members", group["members"])
            moderator = str(
                payload.get("moderator_session_id") or group["moderator_session_id"]
            )
            group["members"] = self._validate_members(members, moderator)
            group["moderator_session_id"] = moderator
        groups[group_id] = group
        self._save(groups)
        return group

    def delete_group(self, username: str, group_id: str) -> dict:
        self._get_owned(username, group_id)
        if any(d.get("group_id") == group_id and d.get("status") == "running"
               for d in self.discussions.values()):
            raise AgentCollabServiceError("该分组有进行中的讨论，无法解散")
        groups = self._load()
        del groups[group_id]
        self._save(groups)
        return {"message": "分组已解散"}
```

- [x] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_agent_collab_groups.py -v`
Expected: PASS (10 tests)

- [x] **Step 5: Commit**

```bash
git add astrbot/dashboard/services/agent_collab_service.py tests/unit/test_agent_collab_groups.py
git commit -m "feat: add agent collab group CRUD with alias and moderator support"
```

---

### Task 3: 讨论路由状态机（DiscussionRunner）

**Files:**
- Modify: `astrbot/dashboard/services/agent_collab_service.py`（追加）
- Test: `tests/unit/test_agent_collab_runner.py`

**Interfaces:**
- Consumes: Task 1 的 `extract_directive` / `resolve_target` / `RouteDirective` / `EndDirective` / injection builders；Task 2 的组 dict
- Produces:
  - `RunnerPorts` dataclass：`deliver: Callable[[str, str], Awaitable[str]]`（(session_id, text) → message_id）、`collect: Callable[[str, str], Awaitable[str]]`（(session_id, message_id) → 回复纯文本，超时抛 `asyncio.TimeoutError`）、`is_busy: Callable[[str], bool]`、`emit: Callable[[dict], None]`、`reply_timeout: float = 180.0`、`busy_poll_interval: float = 2.0`
  - `DiscussionRunner(group: dict, topic: str, username: str, ports: RunnerPorts)`，属性 `state: dict`（id/group_id/topic/status/hop_count/hop_limit/last_member_reply/pending/current_turn），方法 `async run()`、`stop()`、`resume(reset_hops: bool = False)`、`manual_route(target_session_id: str, message: str)`
  - `AgentCollabService.start_discussion(username, group_id, topic, ports) -> dict` / `stop_discussion(id)` / `resume_discussion(id, reset_hops)` / `route_discussion(id, target_session_id, message)`

- [x] **Step 1: Write the failing test（fake ports 驱动全流程）**

```python
# tests/unit/test_agent_collab_runner.py
import asyncio
import json

import pytest

from astrbot.dashboard.services.agent_collab_service import (
    AgentCollabService,
    DiscussionRunner,
    RunnerPorts,
)


def _group(n=3):
    members = [{"session_id": f"s{i:08d}x", "alias": f"agent{i}"} for i in range(n)]
    return {
        "id": "g1", "name": "g", "owner_username": "alice",
        "members": members, "moderator_session_id": members[0]["session_id"],
        "created_at": "2026-08-12T00:00:00+00:00",
    }


class FakeWorld:
    """Scripted fake: deliver() records; collect() returns scripted replies."""

    def __init__(self, replies: dict[str, list[str]]):
        self.replies = {k: list(v) for k, v in replies.items()}
        self.delivered: list[tuple[str, str]] = []
        self.events: list[dict] = []
        self.busy: set[str] = set()

    def ports(self) -> RunnerPorts:
        async def deliver(session_id: str, text: str) -> str:
            self.delivered.append((session_id, text))
            return f"mid{len(self.delivered)}"

        async def collect(session_id: str, message_id: str) -> str:
            if not self.replies[session_id]:
                raise asyncio.TimeoutError
            return self.replies[session_id].pop(0)

        return RunnerPorts(
            deliver=deliver,
            collect=collect,
            is_busy=lambda sid: sid in self.busy,
            emit=self.events.append,
            reply_timeout=0.2,
            busy_poll_interval=0.01,
        )


def _route(target, mode="forward", content=None):
    payload = {"action": "route", "target": target, "mode": mode}
    if content is not None:
        payload["content"] = content
    return f"安排如下。\n```collab-route\n{json.dumps(payload, ensure_ascii=False)}\n```"


@pytest.mark.asyncio
async def test_forward_chain_and_end():
    world = FakeWorld({
        "s00000000x": [_route("agent1"), _route("agent1"), '```collab-route\n{"action": "end", "summary": "搞定"}\n```'],
        "s00000001x": ["A 的方案", "A 的补充"],
    })
    r = DiscussionRunner(_group(3), "设计一个功能", "alice", world.ports())
    await r.run()
    assert r.state["status"] == "stopped"
    # topic -> moderator; "A 的方案" forwarded verbatim -> member; back to moderator ...
    assert world.delivered[0][0] == "s00000000x" and "设计一个功能" in world.delivered[0][1]
    assert world.delivered[1][0] == "s00000001x" and "A 的方案" in world.delivered[1][1]
    assert r.state["hop_count"] == 5


@pytest.mark.asyncio
async def test_literal_mode_uses_content():
    world = FakeWorld({
        "s00000000x": [_route("agent1", mode="literal", content="加工后的任务"),
                       '```collab-route\n{"action": "end", "summary": "s"}\n```'],
        "s00000001x": ["回复"],
    })
    r = DiscussionRunner(_group(3), "topic", "alice", world.ports())
    await r.run()
    assert "加工后的任务" in world.delivered[1][1]
    assert "回复" not in world.delivered[1][1]


@pytest.mark.asyncio
async def test_pair_group_plain_forward_and_end():
    g = _group(2)
    world = FakeWorld({
        g["members"][0]["session_id"]: ["主持人的回答", '```collab-route\n{"action": "end", "summary": "bye"}\n```'],
        g["members"][1]["session_id"]: ["成员的回应"],
    })
    r = DiscussionRunner(g, "topic", "alice", world.ports())
    await r.run()
    # moderator plain reply forwarded verbatim to the sole member
    assert "主持人的回答" in world.delivered[1][1]
    assert r.state["status"] == "stopped"


@pytest.mark.asyncio
async def test_parse_failure_pauses_then_manual_route():
    g = _group(3)
    world = FakeWorld({
        "s00000000x": ["我忘了输出指令", '```collab-route\n{"action": "end", "summary": "s"}\n```'],
        "s00000001x": ["成员回复"],
    })
    r = DiscussionRunner(g, "topic", "alice", world.ports())
    task = asyncio.create_task(r.run())
    await asyncio.sleep(0.1)
    assert r.state["status"] == "paused"
    assert any(e.get("type") == "route_parse_failed" for e in world.events)
    r.manual_route("s00000001x", "人工指定：请回应")
    r.resume()
    await task
    assert r.state["status"] == "stopped"
    assert any("人工指定" in t for _, t in world.delivered)


@pytest.mark.asyncio
async def test_busy_pending_then_deliver():
    g = _group(2)
    world = FakeWorld({
        g["members"][0]["session_id"]: ['```collab-route\n{"action": "end", "summary": "s"}\n```'],
        g["members"][1]["session_id"]: ["ok"],
    })
    world.busy.add(g["members"][0]["session_id"])
    r = DiscussionRunner(g, "topic", "alice", world.ports())

    async def release():
        await asyncio.sleep(0.05)
        world.busy.clear()

    await asyncio.gather(r.run(), release())
    assert world.delivered[0][0] == g["members"][0]["session_id"]


@pytest.mark.asyncio
async def test_hop_limit_pauses():
    g = _group(2)
    endless = ["继续讨论"] * 60
    world = FakeWorld({
        g["members"][0]["session_id"]: endless,
        g["members"][1]["session_id"]: list(endless),
    })
    r = DiscussionRunner(g, "topic", "alice", world.ports())
    r.state["hop_limit"] = 4
    task = asyncio.create_task(r.run())
    await asyncio.sleep(0.2)
    assert r.state["status"] == "paused"
    assert any(e.get("type") == "hop_limit_reached" for e in world.events)
    r.stop()
    await task
    assert r.state["status"] == "stopped"


@pytest.mark.asyncio
async def test_collect_timeout_pauses():
    g = _group(2)
    world = FakeWorld({g["members"][0]["session_id"]: [], g["members"][1]["session_id"]: []})
    r = DiscussionRunner(g, "topic", "alice", world.ports())
    task = asyncio.create_task(r.run())
    await asyncio.sleep(0.4)
    assert r.state["status"] == "paused"
    assert any(e.get("type") == "error" for e in world.events)
    r.stop()
    await task
```

- [x] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_agent_collab_runner.py -v`
Expected: FAIL（`DiscussionRunner`/`RunnerPorts` 不存在）

- [x] **Step 3: Write the implementation（追加到 `agent_collab_service.py`）**

```python
# ---- 追加到 astrbot/dashboard/services/agent_collab_service.py ----
import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from astrbot.core import logger
from astrbot.dashboard.services.agent_collab_directive import (
    EndDirective,
    RouteDirective,
    build_member_injection,
    build_moderator_injection,
    build_moderator_pair_injection,
    extract_directive,
    resolve_target,
)


@dataclass
class RunnerPorts:
    """I/O ports for a DiscussionRunner; injected for testability."""

    deliver: Callable[[str, str], Awaitable[str]]  # (session_id, text) -> message_id
    collect: Callable[[str, str], Awaitable[str]]  # (session_id, message_id) -> reply text
    is_busy: Callable[[str], bool]
    emit: Callable[[dict], None]
    reply_timeout: float = 180.0
    busy_poll_interval: float = 2.0


class DiscussionRunner:
    """Moderated star-topology routing state machine for one discussion."""

    def __init__(self, group: dict, topic: str, username: str, ports: RunnerPorts) -> None:
        self.group = group
        self.ports = ports
        self.state: dict = {
            "id": uuid.uuid4().hex[:12],
            "group_id": group["id"],
            "topic": topic,
            "status": "running",
            "hop_count": 0,
            "hop_limit": 50,
            "current_turn": None,
            "last_member_reply": topic,
            "pending": [],
        }
        self._username = username
        self._moderator = group["moderator_session_id"]
        self._members = group["members"]
        self._pair = len(self._members) == 2
        self._sole_member = next(
            (m["session_id"] for m in self._members if m["session_id"] != self._moderator),
            None,
        )
        self._wake = asyncio.Event()
        self._user_route: tuple[str, str] | None = None

    # ---------- user controls ----------

    def stop(self) -> None:
        self.state["status"] = "stopping"
        self._wake.set()

    def resume(self, reset_hops: bool = False) -> None:
        if reset_hops:
            self.state["hop_count"] = 0
        if self.state["status"] == "paused":
            self.state["status"] = "running"
        self._wake.set()

    def manual_route(self, target_session_id: str, message: str) -> None:
        self._user_route = (target_session_id, message)

    # ---------- helpers ----------

    def _alias(self, session_id: str) -> str:
        return next(
            (m["alias"] for m in self._members if m["session_id"] == session_id),
            session_id[-8:],
        )

    def _moderator_text(self, sender_label: str, text: str) -> str:
        if self._pair:
            return build_moderator_pair_injection(sender_label, text)
        return build_moderator_injection(
            [m["alias"] for m in self._members if m["session_id"] != self._moderator],
            sender_label,
            text,
        )

    async def _wait_if_busy(self, session_id: str) -> None:
        while self.ports.is_busy(session_id) and self.state["status"] in ("running",):
            self.ports.emit({"type": "busy", "session_id": session_id})
            await asyncio.sleep(self.ports.busy_poll_interval)

    async def _pause_until_resumed(self, event: dict) -> None:
        self.state["status"] = "paused"
        self.ports.emit(event)
        self._wake.clear()
        await self._wake.wait()

    async def _turn(self, session_id: str, text: str) -> str | None:
        """Deliver text and collect the reply. Returns None when stopped mid-way."""
        await self._wait_if_busy(session_id)
        if self.state["status"] != "running":
            return None
        self.state["hop_count"] += 1
        self.ports.emit({"type": "hop", "count": self.state["hop_count"],
                         "limit": self.state["hop_limit"]})
        message_id = await self.ports.deliver(session_id, text)
        self.state["current_turn"] = {"session_id": session_id, "message_id": message_id}
        try:
            reply = await asyncio.wait_for(
                self.ports.collect(session_id, message_id),
                timeout=self.ports.reply_timeout,
            )
        except (asyncio.TimeoutError, Exception) as e:  # noqa: BLE001
            self.state["current_turn"] = None
            await self._pause_until_resumed({"type": "error", "reason": str(e)})
            return "" if self.state["status"] == "running" else None
        self.state["current_turn"] = None
        return reply

    # ---------- main loop ----------

    async def run(self) -> None:
        next_target = self._moderator
        next_text = self._moderator_text(self._username, self.state["topic"])
        while self.state["status"] in ("running", "stopping"):
            if self.state["hop_count"] >= self.state["hop_limit"]:
                await self._pause_until_resumed({
                    "type": "hop_limit_reached",
                    "count": self.state["hop_count"],
                    "limit": self.state["hop_limit"],
                })
                if self.state["status"] != "running":
                    break
            reply = await self._turn(next_target, next_text)
            if reply is None or self.state["status"] == "stopping":
                break
            if self._user_route:
                target, message = self._user_route
                self._user_route = None
                self.ports.emit({"type": "route", "from": "user", "to": target})
                next_target, next_text = target, build_member_injection(self._username, message)
                continue
            if next_target == self._moderator:
                outcome = await self._handle_moderator_reply(reply)
                if outcome is None:  # discussion ended or paused->stopped
                    break
                if outcome == "paused":
                    continue
                next_target, next_text = outcome
            else:
                self.state["last_member_reply"] = reply
                self.ports.emit({"type": "route", "from": next_target, "to": self._moderator})
                next_target = self._moderator
                next_text = self._moderator_text(self._alias(next_target), reply)
        self.state["status"] = "stopped"
        self.ports.emit({"type": "stopped", "reason": "done"})

    async def _handle_moderator_reply(self, reply: str):
        """Route based on the moderator's reply. Returns (target, text),
        'paused', or None (discussion over)."""
        result = extract_directive(reply)
        if self._pair:
            if isinstance(result.directive, EndDirective):
                self.ports.emit({"type": "stopped", "reason": result.directive.summary})
                return None
            return (self._sole_member, build_member_injection(
                self._alias(self._moderator), reply))
        if result.error or result.directive is None:
            await self._pause_until_resumed({
                "type": "route_parse_failed", "raw_reply": reply,
                "reason": result.error or "no directive block",
            })
            return "paused" if self.state["status"] == "running" else None
        if isinstance(result.directive, EndDirective):
            self.ports.emit({"type": "stopped", "reason": result.directive.summary})
            return None
        d: RouteDirective = result.directive
        target = resolve_target(d.target, self._members)
        if target is None or target == self._moderator:
            await self._pause_until_resumed({
                "type": "route_parse_failed", "raw_reply": reply,
                "reason": f"unresolvable target: {d.target}",
            })
            return "paused" if self.state["status"] == "running" else None
        if d.mode == "forward":
            text = f"[来自 {self._alias(self._last_member())}]: {self.state['last_member_reply']}"
            if d.content:
                text += f"\n\n[主持人补充]: {d.content}"
        else:
            text = build_member_injection(self._alias(self._moderator), d.content or "")
        self.ports.emit({"type": "route", "from": self._moderator, "to": target})
        return (target, text)

    def _last_member(self) -> str:
        return next(
            (m["session_id"] for m in self._members if m["session_id"] != self._moderator),
            self._moderator,
        ) if self._pair else self.state.get("_last_member_sid", self._moderator)
```

注意实现时修正一处：`_last_member` 在 >2 人组需要跟踪——在 `run()` 的成员分支里加 `self.state["_last_member_sid"] = next_target`（投递给成员前记录）。上述 forward 文本也可以直接复用 `build_member_injection` 保持一致。

`AgentCollabService` 追加：

```python
    # ---------- discussions ----------

    def start_discussion(self, username: str, group_id: str, topic: str,
                         ports: RunnerPorts) -> dict:
        group = self._get_owned(username, group_id)
        topic = topic.strip()
        if not topic:
            raise AgentCollabServiceError("讨论主题不能为空")
        runner = DiscussionRunner(group, topic, username, ports)
        self.discussions[runner.state["id"]] = {
            "group_id": group_id,
            "status": "running",
            "runner": runner,
        }
        runner.state["task"] = None  # set by caller via asyncio.create_task
        return runner.state

    def _get_runner(self, discussion_id: str) -> DiscussionRunner:
        d = self.discussions.get(discussion_id)
        if not d:
            raise AgentCollabServiceError(f"讨论 '{discussion_id}' 不存在")
        return d["runner"]

    def stop_discussion(self, discussion_id: str) -> dict:
        runner = self._get_runner(discussion_id)
        runner.stop()
        return {"message": "讨论停止中"}

    def resume_discussion(self, discussion_id: str, reset_hops: bool = False) -> dict:
        runner = self._get_runner(discussion_id)
        runner.resume(reset_hops=reset_hops)
        return {"message": "讨论已恢复"}

    def route_discussion(self, discussion_id: str, target_session_id: str,
                         message: str) -> dict:
        runner = self._get_runner(discussion_id)
        runner.manual_route(target_session_id, message)
        runner.resume()
        return {"message": "已指定下一站"}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/unit/test_agent_collab_runner.py -v`
Expected: PASS（7 tests；如有失败按断言修正时序等待）

- [x] **Step 5: Commit**

```bash
git add astrbot/dashboard/services/agent_collab_service.py tests/unit/test_agent_collab_runner.py
git commit -m "feat: add moderated discussion routing state machine"
```

---

### Task 4: Webchat 接线（真实 ports）+ 集成测试

**Files:**
- Modify: `astrbot/dashboard/services/agent_collab_service.py`（追加 `build_webchat_ports` 工厂）
- Test: `tests/test_agent_collab_integration.py`

**Interfaces:**
- Consumes: `webchat_queue_mgr`（`get_or_create_queue`/`subscribe_system`/`unsubscribe_system`）、`ChatService.build_user_message_parts`、`ChatService.chat_runs_by_session`、`BotMessageAccumulator`、`resolve_webchat_request_flags`
- Produces: `AgentCollabService.build_ports(chat_service, username) -> RunnerPorts`；讨论 SSE 事件总线 `subscribe_events(discussion_id) -> asyncio.Queue` / `unsubscribe_events(discussion_id, queue)`

- [x] **Step 1: Write the failing integration test（真实 WebChatQueueMgr + fake listener）**

```python
# tests/test_agent_collab_integration.py
import asyncio
import json

import pytest

from astrbot.core.platform.sources.webchat.webchat_queue_mgr import WebChatQueueMgr
from astrbot.dashboard.services.agent_collab_service import (
    AgentCollabService,
    DiscussionRunner,
    RunnerPorts,
)


@pytest.mark.asyncio
async def test_end_to_end_with_real_queue_mgr():
    """Inject via the real input-queue contract; a fake listener simulates the
    adapter by mirroring a scripted agent reply to system subscribers."""
    mgr = WebChatQueueMgr()
    group = {
        "id": "g1", "name": "g", "owner_username": "alice",
        "members": [
            {"session_id": "conv-mod-0001", "alias": "主持人"},
            {"session_id": "conv-mem-0002", "alias": "成员"},
        ],
        "moderator_session_id": "conv-mod-0001",
        "created_at": "2026-08-12T00:00:00+00:00",
    }
    scripted = {
        "conv-mod-0001": [
            "回答如下",
            f'```collab-route\n{json.dumps({"action": "end", "summary": "done"})}\n```',
        ],
        "conv-mem-0002": ["成员的见解"],
    }

    async def fake_listener(data):
        username, conv_id, payload = data
        mid = payload["message_id"]
        reply = scripted[conv_id].pop(0)
        for chunk, t in ((reply, "plain"), ("", "end")):
            await mgr.put_system_event(conv_id, {
                "type": t, "message_id": mid, "data": chunk,
                "streaming": False, "chain_type": "normal",
            })

    mgr.set_listener(fake_listener)
    events: list[dict] = []

    service = AgentCollabService()
    ports = service.build_ports_for_test(mgr, username="alice", emit=events.append,
                                         reply_timeout=2.0, busy_poll_interval=0.01)
    runner = DiscussionRunner(group, "评审这个设计", "alice", ports)
    await asyncio.wait_for(runner.run(), timeout=5)

    assert runner.state["status"] == "stopped"
    assert runner.state["hop_count"] == 3
    # member received the moderator's plain reply verbatim
    # (pair group: full forward)
    mgr.clear_listener()


@pytest.mark.asyncio
async def test_busy_blocks_delivery():
    mgr = WebChatQueueMgr()
    mgr.set_listener(lambda data: asyncio.sleep(0))
    service = AgentCollabService()
    ports = service.build_ports_for_test(
        mgr, username="alice", emit=lambda e: None,
        reply_timeout=0.5, busy_poll_interval=0.01,
        is_busy_override=lambda sid: True,
    )
    group = {
        "id": "g", "name": "g", "owner_username": "alice",
        "members": [{"session_id": "c00000001x", "alias": "a"},
                    {"session_id": "c00000002x", "alias": "b"}],
        "moderator_session_id": "c00000001x",
        "created_at": "2026-08-12T00:00:00+00:00",
    }
    runner = DiscussionRunner(group, "t", "alice", ports)
    task = asyncio.create_task(runner.run())
    await asyncio.sleep(0.1)
    assert runner.state["hop_count"] == 0  # nothing delivered while busy
    runner.stop()
    await task
    mgr.clear_listener()
```

- [x] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_agent_collab_integration.py -v`
Expected: FAIL（`build_ports_for_test` 不存在）

- [x] **Step 3: Write the implementation（追加到 `agent_collab_service.py`）**

```python
# ---- 追加到 astrbot/dashboard/services/agent_collab_service.py ----
from astrbot.core.platform.sources.webchat.request_flags import (
    resolve_webchat_request_flags,
)
from astrbot.core.platform.sources.webchat.webchat_queue_mgr import webchat_queue_mgr


def _make_collect(mgr) -> Callable[[str, str], Awaitable[str]]:
    """Build a collect() port over the system-event subscriber queue.

    Accumulates payloads by message_id with BotMessageAccumulator and returns
    the plain reply text when the turn ends.
    """
    async def collect(session_id: str, message_id: str) -> str:
        from astrbot.dashboard.services.chat_service import BotMessageAccumulator

        queue = mgr.subscribe_system(session_id)
        acc = BotMessageAccumulator()
        try:
            while True:
                payload = await queue.get()
                if not isinstance(payload, dict) or payload.get("message_id") != message_id:
                    continue
                msg_type = payload.get("type")
                if msg_type == "plain":
                    acc.add_plain(
                        payload.get("data", ""),
                        chain_type=payload.get("chain_type"),
                        streaming=bool(payload.get("streaming")),
                    )
                elif msg_type in ("complete", "end"):
                    if msg_type == "complete" and not payload.get("streaming") and payload.get("data"):
                        acc.add_plain(payload["data"], chain_type=payload.get("chain_type"),
                                      streaming=False)
                    return acc.plain_text()
        finally:
            mgr.unsubscribe_system(session_id, queue)

    return collect


class AgentCollabService:  # 以下为类内方法，合并进既有类
    def build_ports_for_test(
        self,
        mgr,
        username: str,
        emit: Callable[[dict], None],
        reply_timeout: float = 180.0,
        busy_poll_interval: float = 2.0,
        is_busy_override: Callable[[str], bool] | None = None,
    ) -> RunnerPorts:
        """Build RunnerPorts over a given WebChatQueueMgr (test seam)."""
        async def deliver(session_id: str, text: str) -> str:
            message_id = uuid.uuid4().hex
            queue = mgr.get_or_create_queue(session_id)
            await queue.put(
                (
                    username,
                    session_id,
                    {
                        "message": [{"type": "plain", "text": text}],
                        "selected_provider": None,
                        "selected_model": None,
                        "flags": resolve_webchat_request_flags({}),
                        "message_id": message_id,
                        "llm_checkpoint_id": uuid.uuid4().hex,
                        "thread_selected_text": None,
                        "_api_key_allow_admin_role": None,
                    },
                )
            )
            return message_id

        return RunnerPorts(
            deliver=deliver,
            collect=_make_collect(mgr),
            is_busy=is_busy_override or (lambda sid: False),
            emit=emit,
            reply_timeout=reply_timeout,
            busy_poll_interval=busy_poll_interval,
        )

    def build_ports(self, chat_service, username: str,
                    emit: Callable[[dict], None]) -> RunnerPorts:
        """Build production RunnerPorts bound to the real ChatService.

        Args:
            chat_service: The dashboard ChatService (for message parts and
                busy detection via chat_runs_by_session).
            username: Discussion owner, used as the sender of injected turns.
            emit: Router event sink (SSE multiplexer).
        """
        test_ports = self.build_ports_for_test(webchat_queue_mgr, username, emit)
        test_ports.is_busy = lambda sid: bool(
            chat_service.chat_runs_by_session.get(sid)
        )
        return test_ports
```

注意：`deliver` 中 `"message": [{"type": "plain", "text": text}]` 的形状以 `ChatService.build_user_message_parts("纯文本")` 的实际输出为准——实现第一步先跑 `uv run python -c "import asyncio; from astrbot.core.platform.sources.webchat.message_parts_helper import build_webchat_message_parts; print(asyncio.run(build_webchat_message_parts('hi', None, strict=False)))"` 校准 part 结构，以实际输出为准修正。

- [x] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_agent_collab_integration.py -v`
Expected: PASS（2 tests）

- [x] **Step 5: Commit**

```bash
git add astrbot/dashboard/services/agent_collab_service.py tests/test_agent_collab_integration.py
git commit -m "feat: wire collab runner to webchat queue manager"
```

---

### Task 5: REST + SSE API 路由

**Files:**
- Create: `astrbot/dashboard/api/agent_collab.py`
- Modify: `astrbot/dashboard/api/app.py`（加一行 import + 一行 `app.include_router(agent_collab_router)`）
- Test: `tests/unit/test_agent_collab_api.py`

**Interfaces:**
- Consumes: Task 2/3 的 service 方法；`.auth` 的 `AuthContext`、`require_dashboard_user`；`request.app.state.services` 的服务定位模式（先 grep `app.state.services` 找到服务注册处，把 `AgentCollabService` 实例挂在同一处）
- Produces: legacy_router `prefix="/api/agent_collab"`；端点与 spec §3.4 一致

- [x] **Step 1: 找到服务挂载点**

Run: `rg "chat_service" astrbot/dashboard/api/app.py astrbot/dashboard/services/__init__.py -n`
确认 `services` 对象的定义文件，在其中追加 `self.agent_collab = AgentCollabService()`（紧挨 chat_service 初始化处）。

- [x] **Step 2: Write the failing test**

```python
# tests/unit/test_agent_collab_api.py
"""Route-level tests: exercise the view functions with a stubbed service."""
import asyncio

import pytest

from astrbot.dashboard.api.agent_collab import _get_service, router
from astrbot.dashboard.services.agent_collab_service import AgentCollabServiceError


def test_routes_registered():
    paths = {r.path for r in router.routes}
    assert "/groups" in paths
    assert "/groups/{group_id}" in paths
    assert "/groups/{group_id}/discussions" in paths
    assert "/discussions/{discussion_id}/stop" in paths
    assert "/discussions/{discussion_id}/resume" in paths
    assert "/discussions/{discussion_id}/route" in paths
    assert "/discussions/{discussion_id}/stream" in paths
```

- [x] **Step 3: Run test to verify it fails** → `uv run pytest tests/unit/test_agent_collab_api.py -v` → FAIL（模块不存在）

- [x] **Step 4: Write the implementation**

```python
# astrbot/dashboard/api/agent_collab.py
"""Agent collab dashboard routes (legacy /api/agent_collab/*)."""

import asyncio
import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from astrbot.core import logger
from astrbot.dashboard.services.agent_collab_service import (
    AgentCollabService,
    AgentCollabServiceError,
)

from .auth import AuthContext, require_dashboard_user
from .response import error, ok  # 以既有模块实际名为准, 参考 cron.py 的 import

router = APIRouter(tags=["Agent Collab"])
legacy_router = APIRouter(prefix="/api/agent_collab", tags=["Dashboard Agent Collab"])


def _get_service(request: Request) -> AgentCollabService:
    return request.app.state.services.agent_collab


def _err(e: AgentCollabServiceError):
    return error(str(e))


@legacy_router.get("/groups")
async def list_groups(request: Request, auth: AuthContext = Depends(require_dashboard_user)):
    return ok(_get_service(request).list_groups(auth.username))


@legacy_router.post("/groups")
async def create_group(request: Request, auth: AuthContext = Depends(require_dashboard_user)):
    try:
        return ok(_get_service(request).create_group(auth.username, await request.json()))
    except AgentCollabServiceError as e:
        return _err(e)


@legacy_router.put("/groups/{group_id}")
async def update_group(group_id: str, request: Request,
                       auth: AuthContext = Depends(require_dashboard_user)):
    try:
        return ok(_get_service(request).update_group(auth.username, group_id, await request.json()))
    except AgentCollabServiceError as e:
        return _err(e)


@legacy_router.delete("/groups/{group_id}")
async def delete_group(group_id: str, request: Request,
                       auth: AuthContext = Depends(require_dashboard_user)):
    try:
        return ok(_get_service(request).delete_group(auth.username, group_id))
    except AgentCollabServiceError as e:
        return _err(e)


@legacy_router.post("/groups/{group_id}/discussions")
async def start_discussion(group_id: str, request: Request,
                           auth: AuthContext = Depends(require_dashboard_user)):
    svc = _get_service(request)
    services = request.app.state.services
    payload = await request.json()
    topic = str(payload.get("topic") or "")
    queue: asyncio.Queue = asyncio.Queue(maxsize=512)

    def emit(event: dict) -> None:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.debug("collab event queue full, dropping event")

    try:
        state = svc.start_discussion(
            auth.username, group_id, topic,
            svc.build_ports(services.chat, auth.username, emit),
        )
    except AgentCollabServiceError as e:
        return _err(e)
    runner = svc.discussions[state["id"]]["runner"]
    svc.discussions[state["id"]]["event_queue"] = queue
    state["task"] = asyncio.create_task(runner.run(), name=f"collab_{state['id']}")
    return ok({"discussion_id": state["id"]})


@legacy_router.post("/discussions/{discussion_id}/stop")
async def stop_discussion(discussion_id: str, request: Request,
                          auth: AuthContext = Depends(require_dashboard_user)):
    try:
        return ok(_get_service(request).stop_discussion(discussion_id))
    except AgentCollabServiceError as e:
        return _err(e)


@legacy_router.post("/discussions/{discussion_id}/resume")
async def resume_discussion(discussion_id: str, request: Request,
                            auth: AuthContext = Depends(require_dashboard_user)):
    payload = await request.json() if await request.body() else {}
    try:
        return ok(_get_service(request).resume_discussion(
            discussion_id, reset_hops=bool(payload.get("reset_hops"))))
    except AgentCollabServiceError as e:
        return _err(e)


@legacy_router.post("/discussions/{discussion_id}/route")
async def route_discussion(discussion_id: str, request: Request,
                           auth: AuthContext = Depends(require_dashboard_user)):
    payload = await request.json()
    try:
        return ok(_get_service(request).route_discussion(
            discussion_id,
            str(payload.get("target_session_id") or ""),
            str(payload.get("message") or ""),
        ))
    except AgentCollabServiceError as e:
        return _err(e)


@legacy_router.get("/discussions/{discussion_id}/stream")
async def stream_discussion(discussion_id: str, request: Request,
                            auth: AuthContext = Depends(require_dashboard_user)):
    svc = _get_service(request)
    d = svc.discussions.get(discussion_id)
    if not d:
        return error(f"讨论 '{discussion_id}' 不存在")
    queue = d.get("event_queue")
    if queue is None:
        return error("该讨论无事件流")

    async def gen():
        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(queue.get(), timeout=15)
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
```

同时在 `astrbot/dashboard/api/app.py` 的 legacy include 区块追加：

```python
from .agent_collab import legacy_router as legacy_agent_collab_router
# ...
app.include_router(legacy_agent_collab_router)
```

鉴权依赖与响应包装（`ok`/`error` 的来源模块、`require_dashboard_user` 的签名）以 `cron.py` 的实际写法为准对齐。

- [x] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_agent_collab_api.py -v`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add astrbot/dashboard/api/agent_collab.py astrbot/dashboard/api/app.py tests/unit/test_agent_collab_api.py
git commit -m "feat: add agent collab dashboard routes"
```

---

### Task 6: 前端 API 段 + composable

**Files:**
- Modify: `dashboard/src/api/v1.ts`（追加 `agentCollabApi` 段，用 `httpClient` 直连 legacy 端点，参考既有 legacy fallback 写法但无需 fallback）
- Create: `dashboard/src/composables/useAgentCollab.ts`
- Test: `dashboard/src/composables/__tests__/useAgentCollab.spec.ts`（若仓库无前端测试基建则跳过测试文件，以 typecheck 代替）

**Interfaces:**
- Produces:
  - `agentCollabApi.{listGroups, createGroup, updateGroup, deleteGroup, startDiscussion, stopDiscussion, resumeDiscussion, routeDiscussion, streamUrl(id)}`
  - `useAgentCollab()` 返回 `{ groups, activeDiscussion, timeline, status, hopInfo, busySessions, loadGroups, createGroup, startDiscussion, stop, resume, manualRoute, connectStream, disconnectStream }`

- [x] **Step 1: v1.ts 追加**

```typescript
export const agentCollabApi = {
  listGroups() {
    return httpClient.get<ApiEnvelope<any>>('/api/agent_collab/groups');
  },
  createGroup(payload: { name: string; members: Array<{ session_id: string; alias?: string }>; moderator_session_id: string }) {
    return httpClient.post<ApiEnvelope<any>>('/api/agent_collab/groups', payload);
  },
  updateGroup(groupId: string, payload: any) {
    return httpClient.put<ApiEnvelope<any>>(`/api/agent_collab/groups/${groupId}`, payload);
  },
  deleteGroup(groupId: string) {
    return httpClient.delete<ApiEnvelope<any>>(`/api/agent_collab/groups/${groupId}`);
  },
  startDiscussion(groupId: string, topic: string) {
    return httpClient.post<ApiEnvelope<any>>(`/api/agent_collab/groups/${groupId}/discussions`, { topic });
  },
  stopDiscussion(id: string) {
    return httpClient.post<ApiEnvelope<any>>(`/api/agent_collab/discussions/${id}/stop`);
  },
  resumeDiscussion(id: string, resetHops = false) {
    return httpClient.post<ApiEnvelope<any>>(`/api/agent_collab/discussions/${id}/resume`, { reset_hops: resetHops });
  },
  routeDiscussion(id: string, targetSessionId: string, message: string) {
    return httpClient.post<ApiEnvelope<any>>(`/api/agent_collab/discussions/${id}/route`, { target_session_id: targetSessionId, message });
  },
  streamUrl(id: string) {
    return `/api/agent_collab/discussions/${id}/stream`;
  },
};
```

- [x] **Step 2: useAgentCollab.ts**

```typescript
// dashboard/src/composables/useAgentCollab.ts
import { onBeforeUnmount, reactive, ref } from 'vue';
import { agentCollabApi } from '@/api/v1';

export interface CollabGroup {
  id: string;
  name: string;
  members: Array<{ session_id: string; alias: string }>;
  moderator_session_id: string;
}

export interface TimelineItem {
  session_id?: string;
  type: string;
  data?: unknown;
  [key: string]: unknown;
}

export function useAgentCollab() {
  const groups = ref<CollabGroup[]>([]);
  const activeDiscussion = ref<string | null>(null);
  const timeline = ref<TimelineItem[]>([]);
  const status = ref<'idle' | 'running' | 'paused' | 'stopped'>('idle');
  const hopInfo = reactive({ count: 0, limit: 50 });
  const busySessions = ref<Set<string>>(new Set());
  let source: EventSource | null = null;

  async function loadGroups() {
    const res = await agentCollabApi.listGroups();
    groups.value = res.data.data?.groups ?? [];
  }

  async function startDiscussion(groupId: string, topic: string) {
    const res = await agentCollabApi.startDiscussion(groupId, topic);
    activeDiscussion.value = res.data.data?.discussion_id ?? null;
    if (activeDiscussion.value) {
      status.value = 'running';
      connectStream(activeDiscussion.value);
    }
  }

  function connectStream(id: string) {
    disconnectStream();
    source = new EventSource(agentCollabApi.streamUrl(id));
    source.onmessage = (e) => {
      const event = JSON.parse(e.data);
      timeline.value.push(event);
      if (event.type === 'hop') {
        hopInfo.count = event.count;
        hopInfo.limit = event.limit;
      } else if (event.type === 'busy') {
        busySessions.value = new Set(busySessions.value).add(event.session_id);
      } else if (event.type === 'route') {
        const next = new Set(busySessions.value);
        next.delete(event.from);
        busySessions.value = next;
      } else if (event.type === 'paused' || event.type === 'route_parse_failed'
        || event.type === 'hop_limit_reached' || event.type === 'error') {
        status.value = 'paused';
      } else if (event.type === 'stopped') {
        status.value = 'stopped';
      }
    };
  }

  function disconnectStream() {
    source?.close();
    source = null;
  }

  async function stop() {
    if (activeDiscussion.value) await agentCollabApi.stopDiscussion(activeDiscussion.value);
  }

  async function resume(resetHops = false) {
    if (activeDiscussion.value) {
      await agentCollabApi.resumeDiscussion(activeDiscussion.value, resetHops);
      status.value = 'running';
    }
  }

  async function manualRoute(targetSessionId: string, message: string) {
    if (activeDiscussion.value) {
      await agentCollabApi.routeDiscussion(activeDiscussion.value, targetSessionId, message);
      status.value = 'running';
    }
  }

  onBeforeUnmount(disconnectStream);

  return { groups, activeDiscussion, timeline, status, hopInfo, busySessions,
    loadGroups, startDiscussion, stop, resume, manualRoute, connectStream, disconnectStream };
}
```

- [x] **Step 3: 校验**

Run: `cd dashboard && pnpm typecheck`（或 `pnpm build`）
Expected: 无类型错误

- [x] **Step 4: Commit**

```bash
git add dashboard/src/api/v1.ts dashboard/src/composables/useAgentCollab.ts
git commit -m "feat(dashboard): add agent collab api client and composable"
```

---

### Task 7: CollabRouteCard + markdown 渲染规则

**Files:**
- Create: `dashboard/src/components/chat/CollabRouteCard.vue`
- Modify: markdown 渲染管线文件（先定位：`rg -l "markdown-it|marked" dashboard/src --glob '*.ts' --glob '*.vue'`，常见为 `dashboard/src/utils/markdown.ts` 或消息组件内的渲染器）

**Interfaces:**
- Produces: `CollabRouteCard`（props: `{ payload: { action, target?, mode?, content?, summary? }, aliasOf?: (label: string) => string }`）；markdown 管线新增 `collab-route` 围栏语言 → 渲染占位 `<div class="collab-route-card" data-payload="...">`，或在组件层用自定义 rule 直接输出卡片 HTML。若现有管线用 markdown-it，实现为一个 `md.block.ruler` 规则；非法 JSON 降级为普通代码块（默认 fence 渲染）。

- [x] **Step 1: CollabRouteCard.vue**

```vue
<template>
  <div class="collab-route-card">
    <template v-if="payload.action === 'route'">
      <v-icon size="small" class="mr-1">mdi-arrow-right-bold</v-icon>
      <span>路由至 <b>{{ displayTarget }}</b></span>
      <v-chip size="x-small" class="ml-2" variant="tonal">
        {{ payload.mode === 'forward' ? '引用转发' : '转述' }}
      </v-chip>
      <div v-if="payload.content" class="text-caption mt-1">{{ payload.content }}</div>
    </template>
    <template v-else-if="payload.action === 'end'">
      <v-icon size="small" class="mr-1">mdi-flag-checkered</v-icon>
      <span>讨论结束</span>
      <div v-if="payload.summary" class="text-caption mt-1">{{ payload.summary }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  payload: { action: string; target?: string; mode?: string; content?: string; summary?: string };
  aliasOf?: (label: string) => string;
}>();

const displayTarget = computed(() =>
  props.aliasOf && props.payload.target ? props.aliasOf(props.payload.target) : props.payload.target,
);
</script>

<style scoped>
.collab-route-card {
  border-left: 3px solid rgb(var(--v-theme-primary));
  padding: 8px 12px;
  margin: 8px 0;
  background: rgba(var(--v-theme-primary), 0.06);
  border-radius: 4px;
  font-size: 0.875rem;
}
</style>
```

- [x] **Step 2: 定位并扩展 markdown 管线**

Run: `rg -l "markdown-it|marked|md.render" dashboard/src --glob '!**/node_modules/**'`
在定位到的渲染器初始化处注册规则（markdown-it 示例）：

```typescript
md.block.ruler.before('fence', 'collab_route', (state, startLine, endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  if (!state.src.startsWith('```collab-route', start)) return false;
  // 找到结束围栏, 产出 token
  let nextLine = startLine + 1;
  while (nextLine < endLine) {
    const pos = state.bMarks[nextLine] + state.tShift[nextLine];
    if (state.src.startsWith('```', pos)) break;
    nextLine++;
  }
  if (nextLine >= endLine) return false;
  if (silent) return true;
  const content = state.src.slice(state.bMarks[startLine + 1], state.bMarks[nextLine]);
  const token = state.push('collab_route', '', 0);
  token.content = content;
  state.line = nextLine + 1;
  return true;
});

md.renderer.rules.collab_route = (tokens, idx) => {
  try {
    const payload = JSON.parse(tokens[idx].content);
    const escaped = JSON.stringify(payload).replace(/"/g, '&quot;');
    return `<div class="collab-route" data-payload="${escaped}"></div>`;
  } catch {
    return `<pre><code>${tokens[idx].content}</code></pre>`; // 非法 JSON 降级
  }
};
```

消息组件挂载点：在渲染完成后的容器里把 `div.collab-route` 替换/增强为 `CollabRouteCard`（用 `createApp`/`h()` 挂载，或更简单：消息组件检测 part 文本含 ```` ```collab-route ```` 时拆段渲染）。取最简单可行方案：**在消息渲染组件中按围栏拆段**，指令段直接用 `CollabRouteCard`，其余段走原 markdown 渲染——这样不动全局管线。

- [x] **Step 3: 校验** → `cd dashboard && pnpm typecheck` 通过

- [x] **Step 4: Commit**

```bash
git add dashboard/src/components/chat/CollabRouteCard.vue <markdown 管线文件>
git commit -m "feat(dashboard): render collab-route directives as cards"
```

---

### Task 8: 绑定对话框 + 协作面板 + Chat 页挂载

**Files:**
- Create: `dashboard/src/components/chat/CollabBindDialog.vue`
- Create: `dashboard/src/components/chat/CollabPanel.vue`
- Modify: chat 页组件（定位：`rg -l "useSessions" dashboard/src/views dashboard/src/components | head`，预期为 `dashboard/src/views/Chat.vue`；仅加按钮 + 面板引用）

**Interfaces:**
- Consumes: Task 6 的 `useAgentCollab`、`agentCollabApi`；`useSessions` 的会话列表（`Session.session_id/display_name`）；Task 7 的 `CollabRouteCard`
- Produces: `CollabBindDialog`（emits `saved`）；`CollabPanel`（props: `{ group: CollabGroup }`）

- [x] **Step 1: CollabBindDialog.vue**

```vue
<template>
  <v-dialog v-model="dialog" max-width="640">
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">绑定协作会话</v-card-title>
      <v-card-text>
        <v-text-field v-model="name" label="分组名称" density="compact" class="mb-2" />
        <div v-for="(m, i) in members" :key="m.session_id" class="d-flex align-center mb-2">
          <span class="text-body-2 flex-grow-1">{{ displayOf(m.session_id) }}</span>
          <v-text-field v-model="m.alias" label="别名" density="compact" hide-details
                        style="max-width: 180px" class="mr-2" />
          <v-radio-group v-model="moderator" hide-details density="compact">
            <v-radio :value="m.session_id" label="主持人" />
          </v-radio-group>
          <v-btn icon="mdi-close" variant="text" size="small" @click="members.splice(i, 1)" />
        </div>
        <v-select v-model="picked" :items="availableSessions" item-title="title" item-value="value"
                  label="添加会话" density="compact" @update:model-value="addMember" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog = false">取消</v-btn>
        <v-btn variant="tonal" :disabled="members.length < 2 || !moderator || !name"
               @click="save">保存</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { agentCollabApi } from '@/api/v1';

const props = defineProps<{ sessions: Array<{ session_id: string; display_name: string | null }> }>();
const emit = defineEmits<{ saved: [] }>();

const dialog = defineModel<boolean>({ default: false });
const name = ref('');
const members = ref<Array<{ session_id: string; alias: string }>>([]);
const moderator = ref<string | null>(null);
const picked = ref<string | null>(null);

const availableSessions = computed(() =>
  props.sessions
    .filter((s) => !members.value.some((m) => m.session_id === s.session_id))
    .map((s) => ({ title: s.display_name || s.session_id, value: s.session_id })),
);

function displayOf(sid: string) {
  return props.sessions.find((s) => s.session_id === sid)?.display_name || sid;
}

function addMember(sid: string | null) {
  if (!sid) return;
  members.value.push({ session_id: sid, alias: sid.slice(-8) });
  if (!moderator.value) moderator.value = sid;
  picked.value = null;
}

async function save() {
  await agentCollabApi.createGroup({
    name: name.value,
    members: members.value,
    moderator_session_id: moderator.value!,
  });
  dialog.value = false;
  emit('saved');
}

watch(dialog, (open) => {
  if (open) { name.value = ''; members.value = []; moderator.value = null; }
});
</script>
```

- [x] **Step 2: CollabPanel.vue**

```vue
<template>
  <div class="collab-panel">
    <div class="d-flex align-center pa-3 pb-1">
      <span class="text-subtitle-1 flex-grow-1">{{ group.name }}</span>
      <v-chip v-for="m in group.members" :key="m.session_id" size="x-small" class="ml-1"
              :color="busySessions.has(m.session_id) ? 'warning' : undefined" variant="tonal">
        {{ m.alias }}{{ m.session_id === group.moderator_session_id ? ' · 主持' : '' }}
      </v-chip>
      <span class="text-caption ml-2">{{ hopInfo.count }}/{{ hopInfo.limit }}</span>
    </div>
    <div class="px-3 pb-2 d-flex">
      <template v-if="status === 'idle'">
        <v-text-field v-model="topic" label="讨论主题" density="compact" hide-details class="mr-2" />
        <v-btn variant="tonal" :disabled="!topic.trim()" @click="start">发起讨论</v-btn>
      </template>
      <template v-else>
        <v-btn v-if="status === 'running'" variant="tonal" color="error" @click="stop">停止</v-btn>
        <v-btn v-if="status === 'paused'" variant="tonal" @click="resume()">继续</v-btn>
      </template>
    </div>
    <div v-if="status === 'paused'" class="px-3 pb-2 d-flex align-center">
      <v-select v-model="manualTarget" :items="memberItems" density="compact" hide-details
                label="人工指定下一站" class="mr-2" />
      <v-text-field v-model="manualMessage" density="compact" hide-details label="转述内容" class="mr-2" />
      <v-btn variant="tonal" :disabled="!manualTarget" @click="sendManual">发送</v-btn>
    </div>
    <div class="collab-timeline px-3 pb-3">
      <div v-for="(item, i) in timeline" :key="i" class="text-body-2">
        <template v-if="item.type === 'route'">→ {{ aliasOf(item.from) }} 转给 {{ aliasOf(item.to) }}</template>
        <template v-else-if="item.type === 'busy'">⏳ {{ aliasOf(item.session_id) }} 忙碌中，消息已挂起</template>
        <template v-else-if="item.type === 'stopped'">■ 讨论结束：{{ item.reason }}</template>
        <template v-else-if="item.type === 'route_parse_failed'">⚠ 主持人未输出合法指令，请人工指定下一站</template>
        <template v-else-if="item.type === 'hop_limit_reached'">⚠ 已达跳数上限</template>
        <template v-else-if="item.type === 'error'">⚠ 错误：{{ item.reason }}</template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAgentCollab, type CollabGroup } from '@/composables/useAgentCollab';

const props = defineProps<{ group: CollabGroup }>();
const { timeline, status, hopInfo, busySessions,
  startDiscussion, stop, resume, manualRoute } = useAgentCollab();

const topic = ref('');
const manualTarget = ref<string | null>(null);
const manualMessage = ref('');

const memberItems = computed(() =>
  props.group.members.map((m) => ({ title: m.alias, value: m.session_id })),
);

function aliasOf(sid?: string) {
  return props.group.members.find((m) => m.session_id === sid)?.alias || sid || '';
}

async function start() {
  await startDiscussion(props.group.id, topic.value.trim());
}

async function sendManual() {
  if (manualTarget.value) await manualRoute(manualTarget.value, manualMessage.value);
}
</script>

<style scoped>
.collab-panel { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.collab-timeline { max-height: 240px; overflow-y: auto; }
</style>
```

注意：`useAgentCollab()` 当前实现每次调用创建独立状态——若 CollabPanel 与其他组件共享状态，把 composable 改为模块级单例（把 `groups/timeline/...` 定义移到函数外）。实现时按实际挂载结构选择，推荐模块级单例。

- [x] **Step 3: Chat 页挂载（仅挂载点）**

在 chat 页模板头部工具区加：

```vue
<v-btn icon="mdi-account-multiple" variant="text" @click="collabDialog = true" />
<CollabBindDialog v-model="collabDialog" :sessions="sessions" @saved="onCollabSaved" />
<CollabPanel v-if="activeGroup" :group="activeGroup" />
```

script 中 `import CollabBindDialog from '@/components/chat/CollabBindDialog.vue'` 等，并接 `sessions`（来自既有 `useSessions`）。`onCollabSaved` 重新 `loadGroups()` 并选中最新组。

- [x] **Step 4: 校验** → `cd dashboard && pnpm typecheck && pnpm build` 通过

- [x] **Step 5: Commit**

```bash
git add dashboard/src/components/chat/CollabBindDialog.vue dashboard/src/components/chat/CollabPanel.vue dashboard/src/views/Chat.vue
git commit -m "feat(dashboard): add collab bind dialog and panel to chat page"
```

---

### Task 9: 收尾

- [x] **Step 1:** `uv run ruff format astrbot/dashboard tests && uv run ruff check astrbot/dashboard tests` — 全绿
- [x] **Step 2:** `uv run pytest tests/unit/test_agent_collab_directive.py tests/unit/test_agent_collab_groups.py tests/unit/test_agent_collab_runner.py tests/test_agent_collab_integration.py tests/test_agent_collab_api.py -v` — 全 PASS
- [x] **Step 3:** `uv run pytest tests/test_webchat_system_stream.py tests/unit/test_session_lock.py -v` — 既有相关测试无回归
- [x] **Step 4:** `cd dashboard && pnpm typecheck && pnpm build` — 通过
- [x] **Step 5:** 手工冒烟：`uv run main.py` 启动，创建两个 webchat 会话 → 绑定成组 → 发起讨论，确认两会话页实时可见、面板时间线正常、`end` 指令终止
- [x] **Step 6:** Commit（如有改动）

---

## Self-Review 记录

- **Spec 覆盖**：绑定组 CRUD(T2)/别名与后缀校验(T2)/指令协议(T1)/状态机含 2 人组退化、busy-pending、hop 上限、超时、stop(T3)/webchat 投递与观察(T4)/REST+SSE(T5)/聚合面板与路由卡片(T6-8)/增量挂载(T8) ✔
- **偏离声明**：组存储用 `sp` 替代 sqlite（见 Global Constraints）✔
- **类型一致性**：`RunnerPorts`/`DiscussionRunner.state`/`build_ports*` 签名在 T3/T4/T5 间一致；`emit` 事件名与 spec §3.4 一致 ✔
