from astrbot.dashboard.services.agent_collab_directive import (
    EndDirective,
    RouteDirective,
    build_member_body,
    build_member_context,
    build_moderator_context,
    build_moderator_pair_context,
    extract_directive,
    resolve_target,
    strip_directive_blocks,
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
    r = extract_directive(
        '总结如下。\n```collab-route\n{"action": "end", "summary": "done"}\n```'
    )
    assert r.error is None
    assert isinstance(r.directive, EndDirective)
    assert r.directive.summary == "done"


def test_no_block_is_not_error():
    r = extract_directive("普通回复，没有指令。")
    assert r.directive is None and r.error is None


def test_multiple_blocks_is_error():
    r = extract_directive(_route_reply("a") + "\n" + _route_reply("b"))
    assert r.directive is None
    assert r.error is not None


def test_block_not_trailing_is_error():
    r = extract_directive(_route_reply("编程agent") + "\n还有话要说。")
    assert r.directive is None
    assert r.error is not None


def test_invalid_json_is_error():
    r = extract_directive("x\n```collab-route\n{not json}\n```")
    assert r.directive is None
    assert r.error is not None


def test_unknown_field_rejected():
    r = extract_directive(
        'x\n```collab-route\n{"action": "route", "target": "编程agent", "mode": "forward", "evil": 1}\n```'
    )
    assert r.directive is None
    assert r.error is not None


def test_resolve_target_alias_exact_normalized():
    assert (
        resolve_target(" 编程AGENT ", MEMBERS) is None
    )  # case-sensitive for CJK, but whitespace trimmed
    assert resolve_target("编程agent", MEMBERS) == "webchat!alice!aaaaaaaa1111"


def test_resolve_target_suffix_fallback():
    assert resolve_target("bbbbbbbb2222"[-8:], MEMBERS) == "webchat!alice!bbbbbbbb2222"
    assert resolve_target("bbbb2222", MEMBERS) == "webchat!alice!bbbbbbbb2222"


def test_resolve_target_miss():
    assert resolve_target("不存在", MEMBERS) is None


def test_injection_builders():
    m = build_moderator_context(MEMBERS, "webchat!alice!aaaaaaaa1111")
    assert "编程agent" in m and "collab-route" in m and "主持人" in m
    p = build_moderator_pair_context("编程agent")
    # pair groups only teach the end action; the route action must not appear
    assert '"action": "end"' in p and '"action": "route"' not in p
    assert "编程agent" in p  # counterpart is named, not anonymous "对方"
    assert build_member_body("编程agent", "内容") == "[来自 编程agent]: 内容"


def test_member_context_contains_roster_topic_and_roles():
    ctx = build_member_context(
        recipient_alias="文档agent",
        topic="讨论主题",
        members=MEMBERS,
        moderator_session_id="webchat!alice!aaaaaaaa1111",
    )
    assert "讨论主题" in ctx
    assert "编程agent（主持人）" in ctx
    assert "文档agent（你）" in ctx
    assert "转达给其他参与者" in ctx


def test_moderator_context_marks_moderator_in_roster():
    m = build_moderator_context(MEMBERS, "webchat!alice!aaaaaaaa1111")
    assert "编程agent（主持人）" in m
    assert "文档agent" in m


def test_strip_directive_blocks():
    assert strip_directive_blocks("普通文本") == "普通文本"
    s = strip_directive_blocks(
        'x\n```collab-route\n{"action": "end", "summary": "s"}\n```\ny'
    )
    assert "collab-route" not in s and "x" in s and "y" in s
    # multiple fences all removed
    s2 = strip_directive_blocks(
        'a\n```collab-route\n{"a":1}\n```\n```collab-route\n{"b":2}\n```'
    )
    assert "collab-route" not in s2


def test_member_body_strips_fences():
    body = build_member_body(
        "主持人", '答复\n```collab-route\n{"action": "end", "summary": "s"}\n```'
    )
    assert body.startswith("[来自 主持人]:")
    assert "collab-route" not in body
    assert "答复" in body
