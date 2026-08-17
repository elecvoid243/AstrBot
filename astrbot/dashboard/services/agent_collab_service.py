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
            d.get("group_id") == group_id and d.get("status") == "running"
            for d in self.discussions.values()
        ):
            raise AgentCollabServiceError("该分组有进行中的讨论，无法解散")
        del groups[group_id]
        await self._save(groups)
        return {"message": "分组已解散"}
