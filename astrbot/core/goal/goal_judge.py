# Author: elecvoid243 · Created: 2026-07-25
"""Judge prompts, continuation prompts, and judge-response parsing.

Stdlib-only. Prompt contracts mirror Hermes `hermes_cli/goals.py`, which
has production-hardened these templates.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone

DEFAULT_JUDGE_MAX_TOKENS = 4096
JUDGE_RESPONSE_SNIPPET_CHARS = 4000

CONTINUATION_PROMPT_TEMPLATE = (
    "[继续推进你的常驻目标]\n"
    "目标：{goal}\n\n"
    "请继续朝这个目标工作，采取下一个具体步骤。"
    "如果你认为目标已经完成，请明确说明并停止。"
    "如果你被阻塞、需要用户输入，请清楚说明并停止。"
)

CONTINUATION_PROMPT_WITH_SUBGOALS_TEMPLATE = (
    "[继续推进你的常驻目标]\n"
    "目标：{goal}\n\n"
    "用户在循环中途追加的额外标准：\n"
    "{subgoals_block}\n\n"
    "请继续朝目标以及全部额外标准工作，采取下一个具体步骤。"
    "如果你认为目标和每条额外标准都已完成，请明确说明并停止。"
    "如果你被阻塞、需要用户输入，请清楚说明并停止。"
)

JUDGE_SYSTEM_PROMPT = (
    "You are a strict judge evaluating whether an autonomous agent has "
    "achieved a user's stated goal. You receive the goal text and the "
    "agent's most recent response. Your only job is to decide whether "
    "the goal is fully satisfied based on that response.\n\n"
    "A goal is DONE only when:\n"
    "- The response explicitly confirms the goal was completed, OR\n"
    "- The response clearly shows the final deliverable was produced, OR\n"
    "- The response explains the goal is unachievable / blocked / needs "
    "user input (treat this as DONE with reason describing the block).\n\n"
    "Otherwise the goal is NOT done — CONTINUE.\n\n"
    "Reply ONLY with a single JSON object on one line:\n"
    '{"done": <true|false>, "reason": "<one-sentence rationale>"}'
)

JUDGE_USER_PROMPT_TEMPLATE = (
    "Goal:\n{goal}\n\n"
    "Agent's most recent response:\n{response}\n\n"
    "Current time: {current_time}\n\n"
    "Is the goal satisfied?"
)

JUDGE_USER_PROMPT_WITH_SUBGOALS_TEMPLATE = (
    "Goal:\n{goal}\n\n"
    "Additional criteria the user added mid-loop (all must also be "
    "satisfied for the goal to be DONE):\n{subgoals_block}\n\n"
    "Agent's most recent response:\n{response}\n\n"
    "Current time: {current_time}\n\n"
    "Decision: For each numbered criterion above, find concrete "
    "evidence in the agent's response that the criterion is "
    "satisfied. Do not accept generic phrases like 'all requirements "
    "met' — require specific evidence. If ANY criterion lacks "
    "specific evidence, return CONTINUE.\n\n"
    "Is the goal AND every additional criterion satisfied?"
)

_JSON_OBJECT_RE = re.compile(r"\{.*?\}", re.DOTALL)


def _truncate(text: str, limit: int) -> str:
    if not text:
        return ""
    return text if len(text) <= limit else text[:limit] + "… [truncated]"


def parse_judge_response(raw: str) -> tuple[bool, str, bool]:
    """Parse the judge's reply, fail-open to (False, reason, parse_failed).

    Args:
        raw: Raw text returned by the judge model.

    Returns:
        Tuple of (done, reason, parse_failed). parse_failed is True when
        the output could not be interpreted as the expected JSON verdict.
    """
    if not raw:
        return False, "judge returned empty response", True
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        nl = text.find("\n")
        if nl != -1:
            text = text[nl + 1 :]
    data = None
    try:
        data = json.loads(text)
    except Exception:
        match = _JSON_OBJECT_RE.search(text)
        if match:
            try:
                data = json.loads(match.group(0))
            except Exception:
                data = None
    if not isinstance(data, dict):
        return False, f"judge reply was not JSON: {_truncate(raw, 200)!r}", True
    done_val = data.get("done")
    if isinstance(done_val, str):
        done = done_val.strip().lower() in {"true", "yes", "1", "done"}
    else:
        done = bool(done_val)
    reason = str(data.get("reason") or "").strip() or "no reason provided"
    return done, reason, False


def build_continuation_prompt(goal: str, subgoals: list[str] | None) -> str:
    """Build the user-role message fed back into the session."""
    clean = [s.strip() for s in (subgoals or []) if s and s.strip()]
    if clean:
        block = "\n".join(f"- {i}. {t}" for i, t in enumerate(clean, 1))
        return CONTINUATION_PROMPT_WITH_SUBGOALS_TEMPLATE.format(
            goal=goal, subgoals_block=block
        )
    return CONTINUATION_PROMPT_TEMPLATE.format(goal=goal)


def build_judge_messages(
    goal: str, response: str, subgoals: list[str] | None, now_str: str
) -> list[dict]:
    """Build the [system, user] message pair for the judge call."""
    clean = [s.strip() for s in (subgoals or []) if s and s.strip()]
    if clean:
        block = "\n".join(f"- {i}. {t}" for i, t in enumerate(clean, 1))
        user = JUDGE_USER_PROMPT_WITH_SUBGOALS_TEMPLATE.format(
            goal=_truncate(goal, 2000),
            subgoals_block=_truncate(block, 2000),
            response=_truncate(response, JUDGE_RESPONSE_SNIPPET_CHARS),
            current_time=now_str,
        )
    else:
        user = JUDGE_USER_PROMPT_TEMPLATE.format(
            goal=_truncate(goal, 2000),
            response=_truncate(response, JUDGE_RESPONSE_SNIPPET_CHARS),
            current_time=now_str,
        )
    return [
        {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


async def judge_goal(
    *,
    llm_caller: Callable[[str, str], Awaitable[str | None]],
    goal: str,
    last_response: str,
    subgoals: list[str] | None = None,
) -> tuple[str, str, bool]:
    """Ask the judge model whether the goal is satisfied.

    Deliberately fail-open: any transport error returns
    ("continue", ..., False) so a broken judge never wedges the loop —
    the turn budget and the parse-failure backstop are the guards.

    Args:
        llm_caller: Async callable (system_prompt, user_prompt) -> raw text,
            returning None on transport/API errors.
        goal: The standing goal text.
        last_response: The agent's final assistant text for this turn.
        subgoals: Optional user-added criteria (from /subgoal).

    Returns:
        Tuple of (verdict, reason, parse_failed) where verdict is
        "done" | "continue" | "skipped".
    """
    if not goal.strip():
        return "skipped", "empty goal", False
    if not last_response.strip():
        return "continue", "empty response (nothing to evaluate)", False

    now_str = (
        datetime.now(tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
    )
    messages = build_judge_messages(goal, last_response, subgoals, now_str)
    raw = await llm_caller(messages[0]["content"], messages[1]["content"])
    if raw is None:
        return "continue", "judge unavailable (transport error)", False

    done, reason, parse_failed = parse_judge_response(raw)
    return ("done" if done else "continue"), reason, parse_failed
