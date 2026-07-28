"""Message search API routes for ChatUI."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from astrbot.dashboard.responses import ApiError, ok
from astrbot.dashboard.services.conversation_service import (
    ConversationService,
    ConversationServiceError,
)

from .auth import AuthContext, require_scope

router = APIRouter(tags=["Messages"])


def get_service(request: Request) -> ConversationService:
    """Get ConversationService from app state."""
    return request.app.state.services.conversations


async def require_chat_scope(request: Request) -> AuthContext:
    """Require chat scope for authentication."""
    return await require_scope(request, "chat")


@router.get("/messages/search")
async def search_messages(
    q: str = Query(min_length=1, description="Search keyword"),
    page: int = Query(default=1, ge=1, description="Page number"),
    page_size: int = Query(default=20, ge=1, le=50, description="Items per page"),
    _auth: AuthContext = Depends(require_chat_scope),
    service: ConversationService = Depends(get_service),
):
    """Search message content across webchat conversations.

    Returns results grouped by conversation with snippet previews.
    """
    try:
        result = await service.search_messages(
            q=q,
            page=page,
            page_size=page_size,
            username=_auth.username,
        )
        return ok(result)
    except ConversationServiceError as exc:
        # 2026-07-28 (elecvoid243): map to ApiError (which has a handler) so
        # the message reaches the client, mirroring conversations.py, instead
        # of falling into the catch-all 500 handler.
        raise ApiError(str(exc)) from exc
