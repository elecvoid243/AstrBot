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


def strip_directive_blocks(text: str) -> str:
    """Remove every collab-route fenced block from text (protocol hygiene).

    Members must never see the routing directive protocol; their replies are
    routed by the moderator instead of by themselves.

    Args:
        text: Raw text that may contain directive fences.

    Returns:
        Text with all collab-route fences removed and blank lines collapsed.
    """
    text = DIRECTIVE_BLOCK_RE.sub("", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def build_member_body(sender_label: str, text: str) -> str:
    """Build the persisted body line for a member or moderator turn.

    Only the sender label and the (directive-stripped) content go into the
    session history; collaborative framing lives in the per-turn context
    header (build_*_context) instead.
    """
    return f"[来自 {sender_label}]: {strip_directive_blocks(text)}"


def _roster_line(
    members: list[dict], moderator_session_id: str, recipient_alias: str | None = None
) -> str:
    """Render the participant roster, marking the moderator and (optionally)
    the recipient of the current turn."""
    parts = []
    for m in members:
        label = m["alias"]
        if m["session_id"] == moderator_session_id:
            label += "（主持人）"
        if recipient_alias is not None and m["alias"] == recipient_alias:
            label += "（你）"
        parts.append(label)
    return "、".join(parts)


def build_member_context(
    *,
    recipient_alias: str,
    topic: str,
    members: list[dict],
    moderator_session_id: str,
) -> str:
    """Build the per-turn context header for a member session.

    Injected as a temp extra (provider-facing only, not persisted) on every
    delivery to a member so the session always knows it is part of a group
    discussion, who else participates, and what its role is.

    Args:
        recipient_alias: Alias of the session receiving this header.
        topic: The discussion topic.
        members: Group members, each {"session_id": str, "alias": str}.
        moderator_session_id: The moderator's session id.
    """
    roster = _roster_line(members, moderator_session_id, recipient_alias)
    return (
        f"[协作讨论] 你正在参与一场多会话协作讨论，主题：{topic}\n"
        f"[协作讨论] 参与者：{roster}\n"
        "[协作讨论] 你的回复将由主持人转达给其他参与者，请直接针对当前内容作答。"
    )


def build_moderator_context(members: list[dict], moderator_session_id: str) -> str:
    """Build the per-turn context header for the moderator (>2 members)."""
    roster = _roster_line(members, moderator_session_id)
    return (
        f"[协作讨论] 你是本场讨论的主持人，成员名册：{roster}\n"
        "[协作讨论] 收到成员回复后，你必须在回复末尾输出一个路由指令块（且只能有一个）：\n"
        "```collab-route\n"
        '{"action": "route", "target": "<成员别名>", "mode": "forward"}\n'
        "```\n"
        "  mode=forward: 把该成员回复的原文直接转给 target（content 字段可填你的补充说明）\n"
        "  mode=literal: 把 content 字段中你加工后的内容转给 target\n"
        '  结束讨论则输出: {"action": "end", "summary": "<总结>"}'
    )


def build_moderator_pair_context(other_alias: str) -> str:
    """Build the per-turn context header for the moderator in a 2-member group."""
    return (
        f"[协作讨论] 你在与 {other_alias} 进行连续讨论，需要结束时在回复末尾输出一个指令块：\n"
        "```collab-route\n"
        '{"action": "end", "summary": "<总结>"}\n'
        "```"
    )
