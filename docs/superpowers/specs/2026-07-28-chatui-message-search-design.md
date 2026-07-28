# ChatUI Message Search Feature Design

**Author:** elecvoid243  
**Date:** 2026-07-28  
**Status:** Draft

## 1. Overview

A lightweight message search feature integrated into the ChatUI sidebar, allowing users to search across all their webchat conversation history by keyword and quickly navigate to matching messages with context preview.

### Problem

- Users accumulate many conversations over time
- Finding a specific piece of information requires manually scrolling through conversation titles
- The existing /conversations?search=xxx API uses history LIKE which is imprecise and doesn't show message-level matches

### Goal

Enable users to recall information and navigate quickly by:
1. Typing a keyword
2. Seeing grouped results with snippet previews
3. Clicking a result to jump directly to the matching message

## 2. Requirements

### Functional

- Search across all ChatUI webchat sessions owned by the current user
- Search triggered by Enter key (not real-time/debounced)
- Results grouped by conversation, expandable to see all matches within
- Each match shows: conversation title + context snippet with highlighted keyword
- Clicking a match: closes dialog, navigates to conversation, scrolls to message, highlights keyword briefly
- ESC closes the dialog without navigation
- Pagination support for large result sets

### Non-functional

- Search response time: acceptable within 500-1000ms for typical data volumes
- Minimal visual footprint: overlay dialog that doesn't disrupt current chat context
- Clean UI: no gradients, no glassmorphism, consistent with existing ChatUI style

### Out of scope

- Real-time/debounced search (future optimization)
- Full-text search index (FTS5/FAISS) - simple string matching for now
- Cross-platform search (only ChatUI webchat sessions)
- Role-based filtering, date filtering, advanced operators

## 3. Backend Design

### API

**Endpoint:** GET /api/v1/messages/search

**Query parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| q | string | - | Search keyword (required, min 1 char) |
| page | int | 1 | Page number |
| page_size | int | 20 | Items per page |

**Response structure:**

- results: array of SearchConversation
  - session_id, title, updated_at, matches[]
- pagination: page, page_size, total, total_pages

Each match in matches[]:
- message_index: index in history JSON array
- role: "user" or "assistant"
- snippet: ~50 chars context before and after the match
- match_offset: character position of keyword in snippet

### Implementation

Located in astrbot/dashboard/services/conversation_service.py as search_messages method.

Logic:
1. Fetch all webchat conversations. Filter to current authenticated user's sessions only (use auth context from request). Only include conversations with platform_id='webchat'.
2. For each conversation, parse history JSON
3. For each user/assistant message, check if keyword exists in plain text parts
4. Generate snippet with ~50 chars context before/after match
5. Group results by conversation, sort by updated_at DESC
6. Apply pagination and return

Matching rules:
- Case-insensitive substring match
- Only match Plain/text parts of user and assistant messages (skip system/tool)
- Multiple matches in same message: return only the first match with its snippet
- Snippet generation: extract ~50 chars before and after the match position, trim at word boundaries

### Files to modify/create

- astrbot/dashboard/services/conversation_service.py: add search_messages method
- astrbot/dashboard/api/messages.py: new file with route definition

## 4. Frontend Design

### Entry point

A search icon button placed at the top of the session list section in the sidebar (Chat.vue), just above the session items.

### Dialog

- Type: Overlay dialog (not route-based), centered on screen
- Dimensions: ~480px wide, ~450px tall, max-height 80vh
- Structure:
  - Search input field with search icon, placeholder text, ESC close button
  - Result list area (scrollable)
  - Pagination footer

### Result list

Each conversation group:
- Conversation title with expand/collapse chevron
- Match snippets listed below when expanded
- Groups collapsed by default except first one

Clicking a snippet navigates to the message.

### Navigation behavior

When user clicks a match:
1. Close dialog
2. router.push to ChatDetail with conversationId
3. Wait for messages to load
4. Locate message DOM via data-message-index attribute
5. scrollIntoView({ block: 'center' })
6. Apply temporary highlight class to matched text, remove after 3 seconds

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| ChatMessageSearchDialog.vue | src/components/chat/ | Overlay search dialog |
| SearchResultGroup.vue | src/components/chat/ | Single conversation group with expand/collapse |
| SearchResultMatch.vue | src/components/chat/ | Single match snippet with highlight |

### Chat.vue modifications

- Add search button in sidebar session list header
- Add searchDialogOpen ref state
- Import and render ChatMessageSearchDialog

## 5. Error handling

- Empty search term: show inline hint "Please enter a search keyword"
- No results: show centered empty state icon + text
- Network error: show error message with retry button
- Message not found on navigation: silently scroll to message closest to target index

## 6. Testing

### Backend
- Unit test for search_messages: mock conversations with known history, verify match extraction and snippet generation
- Edge cases: empty history, no plain text parts, special characters in keyword

### Frontend
- Manual testing: search flow, navigation, scroll-to-highlight behavior
- Verify dialog opens/closes correctly, ESC handling, pagination works

## 7. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Slow search with many conversations | Limit page_size to 20; only load first page; add loading state |
| Keyword highlight not visible | Use subtle yellow background with rounded corners, ensure contrast |
| Message DOM not found after navigation | Fallback: scroll to bottom or nearest message |