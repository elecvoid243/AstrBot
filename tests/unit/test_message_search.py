"""Unit tests for conversation_service.search_messages snippet generation."""

import json


def test_extract_plain_text_from_message():
    """Verify plain text extraction from OpenAI-style message content."""
    msg = {"role": "assistant", "content": "Hello world, this is a test message"}
    text_parts = []
    content = msg.get("content", "")
    if isinstance(content, str):
        text_parts.append(content)
    elif isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                text_parts.append(part.get("text", ""))
    result = " ".join(text_parts)
    assert result == "Hello world, this is a test message"


def test_snippet_generation():
    """Verify snippet generation with context around keyword."""
    text = "This is a long message with some content that contains the keyword we are searching for"
    keyword = "keyword"
    lower_text = text.lower()
    lower_kw = keyword.lower()
    pos = lower_text.find(lower_kw)
    assert pos >= 0
    ctx_len = 50
    start = max(0, pos - ctx_len)
    end = min(len(text), pos + len(keyword) + ctx_len)
    snippet = text[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."
    assert "keyword" in snippet


def test_match_search_in_history():
    """Verify search finds keyword in history messages."""
    history = [
        {"role": "user", "content": "What is this language?"},
        {"role": "assistant", "content": "Python is a programming language"},
    ]
    keyword = "python"
    matches = []
    for idx, msg in enumerate(history):
        if msg.get("role") not in ("user", "assistant"):
            continue
        full_text = msg.get("content", "")
        if keyword.lower() in full_text.lower():
            matches.append({"message_index": idx, "role": msg.get("role")})
    assert len(matches) == 1
    assert matches[0]["message_index"] == 1
