from __future__ import annotations

import json
import traceback
from dataclasses import asdict, dataclass
from datetime import datetime
from io import BytesIO

from astrbot.core import logger
from astrbot.core.core_lifecycle import AstrBotCoreLifecycle
from astrbot.core.db import BaseDatabase
from astrbot.core.umo_alias import build_umo_alias_map, parse_umo, serialize_umo_alias


class ConversationServiceError(Exception):
    pass


@dataclass
class ConversationExport:
    file_obj: BytesIO
    filename: str
    mimetype: str = "application/jsonl"


class ConversationService:
    def __init__(
        self,
        db_helper: BaseDatabase,
        core_lifecycle: AstrBotCoreLifecycle,
    ) -> None:
        self.db_helper = db_helper
        self.conv_mgr = core_lifecycle.conversation_manager

    async def list_conversations(
        self,
        *,
        page: int,
        page_size: int,
        platforms: str,
        message_types: str,
        search_query: str,
        exclude_ids: str,
        exclude_platforms: str,
    ) -> dict:
        platform_list = platforms.split(",") if platforms else []
        message_type_list = message_types.split(",") if message_types else []
        exclude_id_list = exclude_ids.split(",") if exclude_ids else []
        exclude_platform_list = (
            exclude_platforms.split(",") if exclude_platforms else []
        )

        page = max(page, 1)
        if page_size < 1:
            page_size = 20
        page_size = min(page_size, 100)

        try:
            conversations, total_count = await self.conv_mgr.get_filtered_conversations(
                page=page,
                page_size=page_size,
                platforms=platform_list,
                message_types=message_type_list,
                search_query=search_query,
                exclude_ids=exclude_id_list,
                exclude_platforms=exclude_platform_list,
            )
        except Exception as exc:
            logger.error(f"数据库查询出错: {exc!s}\n{traceback.format_exc()}")
            raise ConversationServiceError(f"数据库查询出错: {exc!s}") from exc

        total_pages = (
            (total_count + page_size - 1) // page_size if total_count > 0 else 1
        )
        umos = sorted({conv.user_id for conv in conversations if conv.user_id})
        alias_map = build_umo_alias_map(await self.db_helper.get_umo_aliases(umos))

        return {
            "conversations": [
                self._serialize_conversation(conversation, alias_map)
                for conversation in conversations
            ],
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total_count,
                "total_pages": total_pages,
            },
        }

    async def search_messages(
        self,
        *,
        q: str,
        page: int,
        page_size: int,
    ) -> dict:
        """Search message content across webchat conversations.

        Args:
            q: Search keyword (required, min 1 char).
            page: Page number (1-based).
            page_size: Items per page.

        Returns:
            Dict with 'results' (list of conversation groups with matches)
            and 'pagination' metadata.
        """
        q = q.strip()
        if not q:
            return {
                "results": [],
                "pagination": {
                    "page": 1,
                    "page_size": page_size,
                    "total": 0,
                    "total_pages": 1,
                },
            }

        page = max(page, 1)
        page_size = max(1, min(page_size, 50))

        all_conversations = []
        search_page = 1
        scan_limit = 1000
        while len(all_conversations) < scan_limit:
            # 2026-07-28 fix message search (elecvoid243): use the verified
            # get_filtered_conversations accessor (returns
            # (list[Conversation], total)) instead of the non-existent
            # ConversationManager.get_all_conversations, and read Conversation
            # fields as attributes. Business-ify DB errors so the route maps
            # them to ApiError instead of a generic HTTP 500.
            try:
                batch, _total = await self.conv_mgr.get_filtered_conversations(
                    page=search_page,
                    page_size=200,
                )
            except Exception as exc:
                logger.error(f"消息搜索查询出错: {exc!s}\n{traceback.format_exc()}")
                raise ConversationServiceError(f"消息搜索查询出错: {exc!s}") from exc
            webchat_batch = [
                c for c in batch if c and (c.user_id or "").startswith("webchat:")
            ]
            all_conversations.extend(webchat_batch)
            if len(batch) < 200:
                break
            search_page += 1

        lower_q = q.lower()
        grouped_results = {}

        for conv in all_conversations:
            cid = conv.cid
            if not cid:
                continue
            history_str = conv.history or "[]"
            try:
                history = json.loads(history_str) if history_str else []
            except json.JSONDecodeError:
                continue
            if not isinstance(history, list):
                continue

            conv_matches = []
            for idx, msg in enumerate(history):
                if not isinstance(msg, dict):
                    continue
                role = msg.get("role", "")
                if role not in ("user", "assistant"):
                    continue

                text_parts = []
                content = msg.get("content", "")
                if isinstance(content, str):
                    text_parts.append(content)
                elif isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            text_parts.append(part.get("text", ""))

                full_text = " ".join(text_parts)
                if not full_text:
                    continue

                lower_text = full_text.lower()
                pos = lower_text.find(lower_q)
                if pos == -1:
                    continue

                ctx_len = 50
                start = max(0, pos - ctx_len)
                end = min(len(full_text), pos + len(q) + ctx_len)
                snippet = full_text[start:end]

                if start > 0 and snippet[0] != " ":
                    space = snippet.find(" ", 10)
                    if space != -1:
                        snippet = snippet[space + 1 :]
                if end < len(full_text) and snippet[-1] != " ":
                    space = snippet.rfind(" ", -20)
                    if space != -1:
                        snippet = snippet[: space + 1]

                if start > 0:
                    snippet = "..." + snippet
                if end < len(full_text):
                    snippet = snippet + "..."

                match_offset = snippet.lower().find(lower_q)
                conv_matches.append(
                    {
                        "message_index": idx,
                        "role": role,
                        "snippet": snippet,
                        "match_offset": max(0, match_offset),
                    }
                )

            if conv_matches:
                safe_cid = str(cid) if cid else "unknown"
                display_cid = safe_cid[:8] if len(safe_cid) >= 8 else safe_cid
                grouped_results[cid] = {
                    "session_id": cid,
                    "title": conv.title or f"对话 {display_cid}",
                    "updated_at": conv.updated_at or 0,
                    "matches": conv_matches,
                }

        sorted_results = sorted(
            grouped_results.values(),
            key=lambda x: x["updated_at"],
            reverse=True,
        )

        total = len(sorted_results)
        total_pages = (total + page_size - 1) // page_size if total > 0 else 1
        offset = (page - 1) * page_size
        page_results = sorted_results[offset : offset + page_size]

        return {
            "results": page_results,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": total_pages,
            },
        }

    async def get_conversation_detail(self, data: object) -> dict:
        payload = self._payload(data)
        user_id, cid = self._require_user_and_cid(payload)

        conversation = await self.conv_mgr.get_conversation(
            unified_msg_origin=user_id,
            conversation_id=cid,
        )
        if not conversation:
            raise ConversationServiceError("对话不存在")

        alias_map = build_umo_alias_map(await self.db_helper.get_umo_aliases([user_id]))
        return {
            "user_id": user_id,
            "cid": cid,
            "title": conversation.title,
            "persona_id": conversation.persona_id,
            "history": conversation.history,
            "created_at": conversation.created_at,
            "updated_at": conversation.updated_at,
            "umo_info": self._build_umo_info(user_id, alias_map),
        }

    async def update_conversation(self, data: object) -> dict:
        payload = self._payload(data)
        user_id, cid = self._require_user_and_cid(payload)
        title = payload.get("title")

        conversation = await self.conv_mgr.get_conversation(
            unified_msg_origin=user_id,
            conversation_id=cid,
        )
        if not conversation:
            raise ConversationServiceError("对话不存在")

        persona_id = payload.get("persona_id", conversation.persona_id)

        if title is not None or persona_id is not None:
            await self.conv_mgr.update_conversation(
                unified_msg_origin=user_id,
                conversation_id=cid,
                title=title,
                persona_id=persona_id,
            )
        return {"message": "对话信息更新成功"}

    async def delete_conversation(self, data: object) -> dict:
        payload = self._payload(data)
        if "conversations" in payload:
            return await self._delete_conversations(payload.get("conversations", []))

        user_id, cid = self._require_user_and_cid(payload)
        await self.conv_mgr.delete_conversation(
            unified_msg_origin=user_id,
            conversation_id=cid,
        )
        return {"message": "对话删除成功"}

    async def update_history(self, data: object) -> dict:
        payload = self._payload(data)
        user_id, cid = self._require_user_and_cid(payload)
        history = payload.get("history")

        if history is None:
            raise ConversationServiceError("缺少必要参数: history")

        history = self._normalize_history(history)

        conversation = await self.conv_mgr.get_conversation(
            unified_msg_origin=user_id,
            conversation_id=cid,
        )
        if not conversation:
            raise ConversationServiceError("对话不存在")

        await self.conv_mgr.update_conversation(
            unified_msg_origin=user_id,
            conversation_id=cid,
            history=history,
        )

        return {"message": "对话历史更新成功"}

    async def export_conversations(self, data: object) -> ConversationExport:
        payload = self._payload(data)
        conversations_to_export = payload.get("conversations", [])

        if not conversations_to_export:
            raise ConversationServiceError("导出列表不能为空")

        jsonl_lines = []
        exported_count = 0
        failed_items = []

        for conv_info in conversations_to_export:
            user_id = conv_info.get("user_id")
            cid = conv_info.get("cid")

            if not user_id or not cid:
                failed_items.append(f"user_id:{user_id}, cid:{cid} - 缺少必要参数")
                continue

            try:
                conversation = await self.conv_mgr.get_conversation(
                    unified_msg_origin=user_id,
                    conversation_id=cid,
                )

                if not conversation:
                    failed_items.append(f"user_id:{user_id}, cid:{cid} - 对话不存在")
                    continue

                content = json.loads(conversation.history)
                export_record = {
                    "cid": cid,
                    "user_id": user_id,
                    "platform_id": conversation.platform_id,
                    "title": conversation.title,
                    "persona_id": conversation.persona_id,
                    "created_at": conversation.created_at,
                    "updated_at": conversation.updated_at,
                    "content": content,
                }
                jsonl_lines.append(json.dumps(export_record, ensure_ascii=False))
                exported_count += 1
            except Exception as exc:
                failed_items.append(f"user_id:{user_id}, cid:{cid} - {exc!s}")
                logger.error(
                    f"导出对话失败: user_id={user_id}, cid={cid}, error={exc!s}"
                )

        if exported_count == 0:
            raise ConversationServiceError("没有成功导出任何对话")

        jsonl_content = "\n".join(jsonl_lines)
        file_obj = BytesIO(jsonl_content.encode("utf-8"))
        file_obj.seek(0)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return ConversationExport(
            file_obj=file_obj,
            filename=f"astrbot_conversations_export_{timestamp}.jsonl",
        )

    async def _delete_conversations(self, conversations: object) -> dict:
        if not isinstance(conversations, list) or not conversations:
            raise ConversationServiceError("批量删除时conversations参数不能为空")

        deleted_count = 0
        failed_items = []

        for conv in conversations:
            if not isinstance(conv, dict):
                failed_items.append(f"{conv!r} - 格式错误")
                continue
            user_id = conv.get("user_id")
            cid = conv.get("cid")

            if not user_id or not cid:
                failed_items.append(f"user_id:{user_id}, cid:{cid} - 缺少必要参数")
                continue

            try:
                await self.conv_mgr.delete_conversation(
                    unified_msg_origin=user_id,
                    conversation_id=cid,
                )
                deleted_count += 1
            except Exception as exc:
                failed_items.append(f"user_id:{user_id}, cid:{cid} - {exc!s}")

        message = f"成功删除 {deleted_count} 个对话"
        if failed_items:
            message += f"，失败 {len(failed_items)} 个"

        return {
            "message": message,
            "deleted_count": deleted_count,
            "failed_count": len(failed_items),
            "failed_items": failed_items,
        }

    def _serialize_conversation(self, conversation, alias_map: dict) -> dict:
        return {
            **asdict(conversation),
            "umo_info": self._build_umo_info(conversation.user_id, alias_map),
        }

    @staticmethod
    def _build_umo_info(umo: str | None, alias_map: dict) -> dict:
        umo_str = umo or ""
        return {
            "umo": umo_str,
            **parse_umo(umo_str),
            **serialize_umo_alias(alias_map.get(umo_str), umo_str),
        }

    @staticmethod
    def _require_user_and_cid(payload: dict) -> tuple[str, str]:
        user_id = payload.get("user_id")
        cid = payload.get("cid")
        if not user_id or not cid:
            raise ConversationServiceError("缺少必要参数: user_id 和 cid")
        return user_id, cid

    @staticmethod
    def _normalize_history(history):
        try:
            if isinstance(history, list):
                history = json.dumps(history)
            else:
                json.loads(history)
        except json.JSONDecodeError as exc:
            raise ConversationServiceError(
                "history 必须是有效的 JSON 字符串或数组"
            ) from exc

        return json.loads(history) if isinstance(history, str) else history

    @staticmethod
    def _payload(data: object) -> dict:
        return data if isinstance(data, dict) else {}
