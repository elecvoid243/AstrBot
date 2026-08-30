"""Tests for judge prompt building and response parsing (ported from the
astrbot_plugin_goal plugin)."""

import pytest

from astrbot.core.goal.goal_judge import (
    build_continuation_prompt,
    build_judge_messages,
    judge_goal,
    parse_judge_response,
)

pytestmark = pytest.mark.asyncio


def test_parse_plain_json():
    done, reason, failed = parse_judge_response('{"done": true, "reason": "ok"}')
    assert (done, reason, failed) == (True, "ok", False)


def test_parse_fenced_json():
    raw = '```json\n{"done": false, "reason": "not yet"}\n```'
    done, reason, failed = parse_judge_response(raw)
    assert (done, failed) == (False, False)
    assert reason == "not yet"


def test_parse_prose_wrapped_json():
    raw = 'Sure! {"done": "true", "reason": "finished"} hope that helps'
    done, reason, failed = parse_judge_response(raw)
    assert done is True and failed is False


def test_parse_empty_and_garbage():
    assert parse_judge_response("") == (False, "judge returned empty response", True)
    _, _, failed = parse_judge_response("I think the goal is done")
    assert failed is True


def test_build_continuation_prompt_plain():
    p = build_continuation_prompt("write report", None)
    assert "write report" in p
    assert "额外标准" not in p


def test_build_continuation_prompt_with_subgoals():
    p = build_continuation_prompt("g", ["a", "b"])
    assert "- 1. a" in p and "- 2. b" in p


def test_build_judge_messages_variants():
    msgs = build_judge_messages("g", "resp", None, "2026-07-25 00:00:00 CST")
    assert msgs[0]["role"] == "system" and msgs[1]["role"] == "user"
    assert "Additional criteria" not in msgs[1]["content"]
    msgs2 = build_judge_messages("g", "resp", ["crit"], "now")
    assert "crit" in msgs2[1]["content"]


async def _caller_ok(system, user):
    return '{"done": true, "reason": "all finished"}'


async def _caller_transport_error(system, user):
    return None


async def _caller_garbage(system, user):
    return "I cannot decide"


async def test_judge_goal_done():
    verdict, reason, failed = await judge_goal(
        llm_caller=_caller_ok, goal="g", last_response="resp"
    )
    assert (verdict, failed) == ("done", False)
    assert reason == "all finished"


async def test_judge_goal_transport_error_fails_open():
    verdict, _, failed = await judge_goal(
        llm_caller=_caller_transport_error, goal="g", last_response="resp"
    )
    assert verdict == "continue"
    assert failed is False  # transport errors must NOT count as parse failures


async def test_judge_goal_garbage_counts_parse_failure():
    verdict, _, failed = await judge_goal(
        llm_caller=_caller_garbage, goal="g", last_response="resp"
    )
    assert verdict == "continue"
    assert failed is True


async def test_judge_goal_skips_empty_inputs():
    verdict, _, failed = await judge_goal(
        llm_caller=_caller_ok, goal="  ", last_response="resp"
    )
    assert (verdict, failed) == ("skipped", False)
