"""Agent collab dashboard routes (legacy /api/agent_collab/*)."""

import asyncio
import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from astrbot import logger
from astrbot.dashboard.responses import error, ok
from astrbot.dashboard.services.agent_collab_service import (
    AgentCollabService,
    AgentCollabServiceError,
)

from .auth import require_dashboard_user

router = APIRouter(tags=["Agent Collab"])
legacy_router = APIRouter(
    prefix="/api/agent_collab",
    tags=["Dashboard Agent Collab"],
    include_in_schema=False,
)


def get_service(request: Request) -> AgentCollabService:
    return request.app.state.services.agent_collab


def _err(e: AgentCollabServiceError) -> dict:
    return error(str(e))


async def _json_body(request: Request) -> dict:
    try:
        payload = await request.json()
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


@legacy_router.get("/groups")
async def list_groups(
    username: str = Depends(require_dashboard_user),
    service: AgentCollabService = Depends(get_service),
):
    return ok(await service.list_groups(username))


@legacy_router.post("/groups")
async def create_group(
    request: Request,
    username: str = Depends(require_dashboard_user),
    service: AgentCollabService = Depends(get_service),
):
    try:
        return ok(await service.create_group(username, await _json_body(request)))
    except AgentCollabServiceError as e:
        return _err(e)


@legacy_router.put("/groups/{group_id}")
async def update_group(
    group_id: str,
    request: Request,
    username: str = Depends(require_dashboard_user),
    service: AgentCollabService = Depends(get_service),
):
    try:
        return ok(
            await service.update_group(username, group_id, await _json_body(request))
        )
    except AgentCollabServiceError as e:
        return _err(e)


@legacy_router.delete("/groups/{group_id}")
async def delete_group(
    group_id: str,
    username: str = Depends(require_dashboard_user),
    service: AgentCollabService = Depends(get_service),
):
    try:
        return ok(await service.delete_group(username, group_id))
    except AgentCollabServiceError as e:
        return _err(e)


@legacy_router.post("/groups/{group_id}/discussions")
async def start_discussion(
    group_id: str,
    request: Request,
    username: str = Depends(require_dashboard_user),
    service: AgentCollabService = Depends(get_service),
):
    payload = await _json_body(request)
    topic = str(payload.get("topic") or "")

    # Fan-out event bus: every emitted event is retained in entry["events"]
    # (replayed to each new SSE subscriber) and pushed to live subscribers.
    subscribers: list[asyncio.Queue] = []
    events: list[dict] = []

    def emit(event: dict) -> None:
        events.append(event)
        for sub in subscribers:
            try:
                sub.put_nowait(event)
            except asyncio.QueueFull:
                logger.debug("collab event subscriber queue full, dropping event")

    try:
        state = await service.start_discussion(
            username,
            group_id,
            topic,
            service.build_ports(request.app.state.services.chat, username, emit),
        )
    except AgentCollabServiceError as e:
        return _err(e)
    entry = service.discussions[state["id"]]
    entry["events"] = events
    entry["subscribers"] = subscribers
    state["task"] = asyncio.create_task(
        entry["runner"].run(), name=f"collab_{state['id']}"
    )
    return ok({"discussion_id": state["id"]})


@legacy_router.post("/discussions/{discussion_id}/stop")
async def stop_discussion(
    discussion_id: str,
    service: AgentCollabService = Depends(get_service),
):
    try:
        return ok(service.stop_discussion(discussion_id))
    except AgentCollabServiceError as e:
        return _err(e)


@legacy_router.post("/discussions/{discussion_id}/resume")
async def resume_discussion(
    discussion_id: str,
    request: Request,
    service: AgentCollabService = Depends(get_service),
):
    payload = await _json_body(request)
    try:
        return ok(
            service.resume_discussion(
                discussion_id, reset_hops=bool(payload.get("reset_hops"))
            )
        )
    except AgentCollabServiceError as e:
        return _err(e)


@legacy_router.post("/discussions/{discussion_id}/route")
async def route_discussion(
    discussion_id: str,
    request: Request,
    service: AgentCollabService = Depends(get_service),
):
    payload = await _json_body(request)
    try:
        return ok(
            service.route_discussion(
                discussion_id,
                str(payload.get("target_session_id") or ""),
                str(payload.get("message") or ""),
            )
        )
    except AgentCollabServiceError as e:
        return _err(e)


@legacy_router.get("/discussions/{discussion_id}/stream")
async def stream_discussion(
    discussion_id: str,
    request: Request,
    service: AgentCollabService = Depends(get_service),
):
    entry = service.discussions.get(discussion_id)
    if not entry:
        return error(f"讨论 '{discussion_id}' 不存在")
    subscribers = entry.get("subscribers")
    if subscribers is None:
        return error("该讨论无事件流")

    queue: asyncio.Queue = asyncio.Queue(maxsize=512)
    # Replay the full history first so late subscribers (e.g. the group
    # transcript panel opened mid-discussion) still see every turn.
    for event in entry.get("events", []):
        queue.put_nowait(event)
    subscribers.append(queue)

    async def gen():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            subscribers.remove(queue)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
