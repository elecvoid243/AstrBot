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
