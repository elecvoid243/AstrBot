"""Agent collab service: session binding groups and moderated discussions."""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from astrbot.core import sp
from astrbot.core.platform.sources.webchat.request_flags import (
    resolve_webchat_request_flags,
)
from astrbot.core.platform.sources.webchat.webchat_queue_mgr import (
    _extract_conversation_id,
    webchat_queue_mgr,
)
from astrbot.core.umo_alias import parse_umo
from astrbot.dashboard.services.agent_collab_directive import (
    EndDirective,
    RouteDirective,
    build_member_injection,
    build_moderator_injection,
    build_moderator_pair_injection,
    extract_directive,
    resolve_target,
)

_GROUPS_KEY = "agent_collab_groups"
_ALIAS_MAX_LEN = 32


def _conversation_id(session_id: str) -> str:
    """Map a group member session id (UMO or webchat event id) to the raw
    webchat conversation id used by the queue manager."""
    if session_id.startswith("webchat!"):
        return _extract_conversation_id(session_id)
    parsed = parse_umo(session_id)
    if parsed["platform"] == "webchat":
        return parsed["session_id"]
    return session_id


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

    async def _load(self) -> dict:
        return await sp.get_async("unknown", "unknown", _GROUPS_KEY, {}) or {}

    async def _save(self, groups: dict) -> None:
        await sp.put_async("unknown", "unknown", _GROUPS_KEY, groups)

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
                raise AgentCollabServiceError(
                    f"别名过长（>{_ALIAS_MAX_LEN} 字符）: {alias}"
                )
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

    async def create_group(self, username: str, payload: dict) -> dict:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise AgentCollabServiceError("分组名称不能为空")
        members = self._validate_members(
            payload.get("members") or [],
            str(payload.get("moderator_session_id") or ""),
        )
        groups = await self._load()
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
        await self._save(groups)
        return group

    async def list_groups(self, username: str) -> dict:
        return {
            "groups": [
                g
                for g in (await self._load()).values()
                if g["owner_username"] == username
            ]
        }

    async def _get_owned(self, username: str, group_id: str, groups: dict) -> dict:
        group = groups.get(group_id)
        if not group or group["owner_username"] != username:
            raise AgentCollabServiceError(f"分组 '{group_id}' 不存在")
        return group

    async def update_group(self, username: str, group_id: str, payload: dict) -> dict:
        groups = await self._load()
        group = await self._get_owned(username, group_id, groups)
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
        await self._save(groups)
        return group

    async def delete_group(self, username: str, group_id: str) -> dict:
        groups = await self._load()
        await self._get_owned(username, group_id, groups)
        if any(
            d.get("group_id") == group_id
            and d["runner"].state.get("status") in ("running", "paused", "stopping")
            for d in self.discussions.values()
        ):
            raise AgentCollabServiceError("该分组有进行中的讨论，无法解散")
        del groups[group_id]
        await self._save(groups)
        return {"message": "分组已解散"}

    # ---------- discussions ----------

    async def start_discussion(
        self, username: str, group_id: str, topic: str, ports: "RunnerPorts"
    ) -> dict:
        groups = await self._load()
        group = await self._get_owned(username, group_id, groups)
        topic = topic.strip()
        if not topic:
            raise AgentCollabServiceError("讨论主题不能为空")
        runner = DiscussionRunner(group, topic, username, ports)
        self.discussions[runner.state["id"]] = {
            "group_id": group_id,
            "runner": runner,
        }
        runner.state["task"] = None  # set by caller via asyncio.create_task
        return runner.state

    def _get_runner(self, discussion_id: str) -> "DiscussionRunner":
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

    def route_discussion(
        self, discussion_id: str, target_session_id: str, message: str
    ) -> dict:
        runner = self._get_runner(discussion_id)
        runner.manual_route(target_session_id, message)
        runner.resume()
        return {"message": "已指定下一站"}

    # ---------- webchat wiring ----------

    def build_ports_for_test(
        self,
        mgr,
        username: str,
        emit: Callable[[dict], None],
        reply_timeout: float = 180.0,
        busy_poll_interval: float = 2.0,
        is_busy_override: Callable[[str], bool] | None = None,
    ) -> "RunnerPorts":
        """Build RunnerPorts over a given WebChatQueueMgr (test seam)."""

        # One system-event subscription per conversation, created in deliver()
        # BEFORE the input item is queued. Subscribing after delivery would
        # race the adapter listener and drop the first reply chunks.
        subscriptions: dict[str, asyncio.Queue] = {}

        async def deliver(session_id: str, text: str) -> str:
            cid = _conversation_id(session_id)
            message_id = uuid.uuid4().hex
            queue = mgr.get_or_create_queue(cid)
            subscriptions.setdefault(cid, mgr.subscribe_system(cid))
            await queue.put(
                (
                    username,
                    cid,
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

        async def collect(session_id: str, message_id: str) -> str:
            from astrbot.dashboard.services.chat_service import BotMessageAccumulator

            cid = _conversation_id(session_id)
            queue = subscriptions.get(cid)
            if queue is None:
                raise asyncio.TimeoutError(
                    f"no subscription for {cid}; deliver() must run first"
                )
            acc = BotMessageAccumulator()
            while True:
                payload = await queue.get()
                if (
                    not isinstance(payload, dict)
                    or payload.get("message_id") != message_id
                ):
                    continue
                msg_type = payload.get("type")
                if msg_type == "plain":
                    acc.add_plain(
                        payload.get("data", ""),
                        chain_type=payload.get("chain_type"),
                        streaming=bool(payload.get("streaming")),
                    )
                elif msg_type in ("complete", "end"):
                    if (
                        msg_type == "complete"
                        and not payload.get("streaming")
                        and payload.get("data")
                    ):
                        acc.add_plain(
                            payload["data"],
                            chain_type=payload.get("chain_type"),
                            streaming=False,
                        )
                    return acc.plain_text()

        return RunnerPorts(
            deliver=deliver,
            collect=collect,
            is_busy=is_busy_override or (lambda sid: False),
            emit=emit,
            reply_timeout=reply_timeout,
            busy_poll_interval=busy_poll_interval,
        )

    def build_ports(
        self, chat_service, username: str, emit: Callable[[dict], None]
    ) -> "RunnerPorts":
        """Build production RunnerPorts bound to the real ChatService.

        Args:
            chat_service: The dashboard ChatService (busy detection via
                chat_runs_by_session, keyed by webchat conversation id).
            username: Discussion owner, used as the sender of injected turns.
            emit: Router event sink (SSE multiplexer).

        Returns:
            RunnerPorts wired to the global webchat queue manager.
        """
        ports = self.build_ports_for_test(webchat_queue_mgr, username, emit)
        ports.is_busy = lambda sid: bool(
            chat_service.chat_runs_by_session.get(_conversation_id(sid))
        )
        return ports


@dataclass
class RunnerPorts:
    """I/O ports for a DiscussionRunner; injected for testability."""

    deliver: Callable[[str, str], Awaitable[str]]  # (session_id, text) -> message_id
    collect: Callable[
        [str, str], Awaitable[str]
    ]  # (session_id, message_id) -> reply text
    is_busy: Callable[[str], bool]
    emit: Callable[[dict], None]
    reply_timeout: float = 180.0
    busy_poll_interval: float = 2.0


class DiscussionRunner:
    """Moderated star-topology routing state machine for one discussion."""

    def __init__(
        self, group: dict, topic: str, username: str, ports: RunnerPorts
    ) -> None:
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
            (
                m["session_id"]
                for m in self._members
                if m["session_id"] != self._moderator
            ),
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
        while self.ports.is_busy(session_id) and self.state["status"] == "running":
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
        self.ports.emit(
            {
                "type": "hop",
                "count": self.state["hop_count"],
                "limit": self.state["hop_limit"],
            }
        )
        message_id = await self.ports.deliver(session_id, text)
        self.state["current_turn"] = {
            "session_id": session_id,
            "message_id": message_id,
        }
        try:
            reply = await asyncio.wait_for(
                self.ports.collect(session_id, message_id),
                timeout=self.ports.reply_timeout,
            )
        except Exception as e:  # noqa: BLE001
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
            # a manual route set while paused takes priority over stale loop state
            if self._user_route:
                target, message = self._user_route
                self._user_route = None
                self.ports.emit({"type": "route", "from": "user", "to": target})
                next_target = target
                next_text = build_member_injection(self._username, message)
            if self.state["hop_count"] >= self.state["hop_limit"]:
                await self._pause_until_resumed(
                    {
                        "type": "hop_limit_reached",
                        "count": self.state["hop_count"],
                        "limit": self.state["hop_limit"],
                    }
                )
                if self.state["status"] != "running":
                    break
            reply = await self._turn(next_target, next_text)
            if reply is None or self.state["status"] == "stopping":
                break
            if next_target != self._moderator:
                self.state["last_member_reply"] = reply
                self.state["_last_member_sid"] = next_target
                self.ports.emit(
                    {"type": "route", "from": next_target, "to": self._moderator}
                )
                next_text = self._moderator_text(self._alias(next_target), reply)
                next_target = self._moderator
                continue
            outcome = await self._handle_moderator_reply(reply)
            if outcome is None:  # discussion ended or paused->stopped
                break
            if outcome == "paused":
                continue
            next_target, next_text = outcome
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
            return (
                self._sole_member,
                build_member_injection(self._alias(self._moderator), reply),
            )
        if result.error or result.directive is None:
            await self._pause_until_resumed(
                {
                    "type": "route_parse_failed",
                    "raw_reply": reply,
                    "reason": result.error or "no directive block",
                }
            )
            return "paused" if self.state["status"] == "running" else None
        if isinstance(result.directive, EndDirective):
            self.ports.emit({"type": "stopped", "reason": result.directive.summary})
            return None
        d: RouteDirective = result.directive
        target = resolve_target(d.target, self._members)
        if target is None or target == self._moderator:
            await self._pause_until_resumed(
                {
                    "type": "route_parse_failed",
                    "raw_reply": reply,
                    "reason": f"unresolvable target: {d.target}",
                }
            )
            return "paused" if self.state["status"] == "running" else None
        if d.mode == "forward":
            origin = self.state.get("_last_member_sid")
            label = self._alias(origin) if origin else self._username
            text = build_member_injection(label, self.state["last_member_reply"])
            if d.content:
                text += f"\n\n[主持人补充]: {d.content}"
        else:
            text = build_member_injection(self._alias(self._moderator), d.content or "")
        self.ports.emit({"type": "route", "from": self._moderator, "to": target})
        return (target, text)
