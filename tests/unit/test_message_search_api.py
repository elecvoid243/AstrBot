"""Basic tests for message search API imports and structure."""


def test_messages_route_imports():
    """Verify messages.py can be imported without errors."""
    from astrbot.dashboard.api import messages

    assert hasattr(messages, "router")
    assert hasattr(messages, "get_service")
    assert hasattr(messages, "search_messages")


def test_messages_route_config():
    """Verify the router has the correct endpoint."""
    from astrbot.dashboard.api.messages import router

    routes = [r.path for r in router.routes]
    assert "/messages/search" in routes
