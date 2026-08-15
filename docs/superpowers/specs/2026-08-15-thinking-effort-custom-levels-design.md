# Configurable Thinking-Effort Levels — Design

**Date:** 2026-08-15
**Author:** elecvoid243
**Status:** Approved (user) → implementation

## 1. Problem

The ChatUI thinking-effort selector currently ships a fixed enum
`auto | off | low | medium | high`, and the backend whitelist only accepts those
values. Different models / inference engines expose different `reasoning_effort`
value sets:

- `deepseek-v4-flash-0731` (official API): max intensity is `max`
- `Qwen3.8-27B` (llama.cpp): max intensity is `xhigh`

A fixed enum cannot express these, so users cannot tune reasoning intensity for
those models.

## 2. Goal

Make the thinking-effort levels **user-configurable in the ChatUI**: the user
can create N levels, each with a display name and a raw value. The selected
level's value is what gets sent as `thinking_effort` on each message.

## 3. Decisions (confirmed with user)

1. **Storage:** `localStorage` (frontend-only), key `thinkingEffortLevels`.
   Consistent with the existing `thinkingEffort` selection persistence. No
   backend API or settings plumbing.
2. **Value scope:** custom values pass through **only to the OpenAI family**
   (`reasoning_effort` free-form string). Anthropic / Gemini keep the strict
   mapping (`low/medium/high/off/auto`); unknown custom values are ignored there
   and fall back to the provider static config (never forwarded, never errors).
3. **Reserved values:** `auto` (do not override; provider static config) and
   `off` (disable thinking where the provider supports it) remain special and
   always present. They cannot be deleted or renamed.

## 4. Architecture

### 4.1 Frontend (`dashboard/src`)

- **`ChatInput.vue`**
  - Dropdown items come from a `computed` that merges the user-defined levels
    (`thinkingEffortLevels` from `localStorage`) with the two reserved entries
    (`auto`, `off`) pinned at the top.
  - `+` menu gains an entry "编辑思考强度档位…" (mdi-pencil) that opens the
    dialog.
  - `getThinkingEffort()` unchanged: returns the selected level's **value**
    string; send path unchanged (`thinking_effort` in SSE/WS payloads).
- **New `ThinkingEffortLevelsDialog.vue`**
  - Dialog with a row list: each row = name text field + value text field +
    delete button.
  - Footer: "添加档位", "恢复默认", Cancel / Save.
  - Validation: name non-empty, value non-empty, no duplicate values among
    user-defined levels; user-defined values must **not** be the reserved
    `auto` / `off`; reserved entries are not editable/deletable.
  - On save: write `thinkingEffortLevels` to `localStorage`; if the previously
    selected value no longer exists, reset selection to `auto`.
  - Subtitle hint (i18n): custom values only apply to OpenAI-compatible
    providers; Anthropic/Gemini use low/medium/high/off/auto.
- **Defaults** when no stored config: `[{auto}, {off}, {low}, {medium}, {high}]`
  (identical behavior to today).

### 4.2 Backend (`astrbot`)

The canonical `thinking_effort` field becomes a free-form string except for the
two reserved values:

| Layer | Change |
|---|---|
| `core/astr_main_agent.py` | Whitelist relaxed from `("off","low","medium","high")` to: non-empty and != `"auto"` → inject into `req.llm_params["thinking_effort"]` |
| `core/provider/sources/openai_source.py` | `_prepare_chat_payload`: set `payloads["reasoning_effort"]` for any non-empty value except `auto`/`off` (free-form passthrough) |
| `core/provider/sources/openai_responses_source.py` | Same free-form passthrough; existing `_query` converts to `reasoning: {effort}` |
| `core/provider/sources/anthropic_source.py` | **Unchanged** — maps only `low/medium/high` (+ `off`); unknown values fall through to static config |
| `core/provider/sources/gemini_source.py` | **Unchanged** — maps only `low/medium/high` (+ `off`); unknown values fall through to static config |

Security: the value is a scalar string (never a key), and each source only maps
known fields into its payload; arbitrary values cannot inject request structure.

### 4.3 Data flow

```
ChatInput dropdown (levels from localStorage)
  → selected level.value
  → SSE body / WS payload: thinking_effort=<value>
  → webchat queue → event extra → astr_main_agent (auto/empty filtered)
  → ProviderRequest.llm_params["thinking_effort"]
  → agent runner → provider text_chat(**kwargs)
  → openai*: reasoning_effort = value (free-form)
    anthropic/gemini: low/medium/high/off mapped; other values → static config
```

## 5. Testing

- Extend `tests/test_thinking_effort_mapping.py`:
  - OpenAI chat: `llm_params={"thinking_effort": "max"}` →
    `payloads["reasoning_effort"] == "max"`; same for `xhigh`, `none`.
  - Anthropic / Gemini: unknown value (`max`) → static config fallback (no
    thinking override, no error).
- Frontend: `vue-tsc --noEmit` passes; manual review of dialog CRUD.

## 6. Known Limitations

- Custom values have **no effect** on Anthropic / Gemini (silent fallback to
  provider static config). The dialog subtitle communicates this.
- `off` on OpenAI family still cannot hard-disable reasoning for o-series
  models (API limitation, unchanged).
- Levels are per-browser (localStorage); not synced across devices.
