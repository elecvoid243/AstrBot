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
    m = build_moderator_injection(["编程agent", "文档agent"], "用户alice", "讨论主题")
    assert "编程agent" in m and "collab-route" in m and "讨论主题" in m
    p = build_moderator_pair_injection("对方", "你好")
    # pair groups only teach the end action; the route action must not appear
    assert '"action": "end"' in p and '"action": "route"' not in p
    assert build_member_injection("编程agent", "内容") == "[来自 编程agent]: 内容"
