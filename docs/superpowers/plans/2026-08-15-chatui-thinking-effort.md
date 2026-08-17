# ChatUI Thinking Effort Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users adjust the LLM "thinking effort" (reasoning intensity) per-message from the ChatUI input menu, threaded end-to-end from the Vue frontend to each provider's native request parameter.

**Architecture:** A canonical `thinking_effort` value (`auto | off | low | medium | high`) travels from the chat input → send payload → webchat adapter event extra → `ProviderRequest.llm_params` → agent runner → provider `text_chat(**kwargs)`. Each provider source maps `llm_params["thinking_effort"]` to its native field (OpenAI `reasoning_effort`, Anthropic `thinking={type:adaptive, effort}`, Gemini `thinking_level`/`thinking_budget`). `auto` (default) and missing values keep the existing provider-level static config untouched.

**Tech Stack:** Vue 3 (dashboard), FastAPI (dashboard api), Python 3.10+ (astrbot core), OpenAI/Anthropic/Gemini SDKs.

## Global Constraints

- Comments and logs in English; Chinese docstrings allowed where existing files use them (existing `entities.py` / `astr_main_agent.py` use Chinese docstrings — follow file-local style).
- No new dependencies. Follow ruff formatting (`ruff format` + `ruff check`).
- Conventional commit messages (e.g. `feat(chat): support per-message thinking effort`).
- Backward compatible: `thinking_effort` absent → identical behavior to today.
- Whitelist `thinking_effort` values at the backend boundary; never forward unknown keys to upstream APIs.
- Worktree: `F:\github\Astrbot\.worktrees\feat-chatui-thinking-effort` (branch `feat/chatui-thinking-effort`).
- Local commits only; no push, no PR (elecvoid243, 2026-08-15).

---

### Task 1: Backend data model — `ProviderRequest.llm_params`

**Files:**
- Modify: `astrbot/core/provider/entities.py` (ProviderRequest dataclass, after `model` field)

**Interfaces:**
- Produces: `ProviderRequest.llm_params: dict` (default `{}`) — canonical per-request LLM overrides; source-specific mapping happens in each provider source.

- [ ] **Step 1: Add field**

```python
    model: str | None = None
    """模型名称，为 None 时使用提供商的默认模型"""
    llm_params: dict = field(default_factory=dict)
    """逐条请求的额外 LLM 参数（如 thinking_effort 思考强度），会覆盖提供商级静态配置。"""
```

- [ ] **Step 2: Verify** — `ruff check astrbot/core/provider/entities.py`

- [ ] **Step 3: Commit** — `git add astrbot/core/provider/entities.py && git commit -m "feat(provider): add llm_params field to ProviderRequest"`

---

### Task 2: Agent runner passes `llm_params` to provider

**Files:**
- Modify: `astrbot/core/agent/runners/tool_loop_agent_runner.py` (`_iter_llm_responses`, payload dict)

**Interfaces:**
- Consumes: `self.req.llm_params` (Task 1)
- Produces: provider `text_chat`/`text_chat_stream` receives `llm_params` kwarg.

- [ ] **Step 1: Add to payload dict**

```python
        payload = {
            "contexts": self._sanitize_contexts_for_provider(self.run_context.messages),
            "func_tool": self._func_tool_for_provider(),
            "session_id": self.req.session_id,
            "extra_user_content_parts": self.req.extra_user_content_parts,  # list[ContentPart]
            "abort_signal": self._abort_signal,
            "request_max_retries": self.request_max_retries,
            "llm_params": self.req.llm_params,
        }
```

- [ ] **Step 2: Verify** — `ruff check astrbot/core/agent/runners/tool_loop_agent_runner.py`

- [ ] **Step 3: Commit** — `git commit -am "feat(agent): forward req.llm_params to provider text_chat"`

---

### Task 3: Main agent reads `thinking_effort` event extra

**Files:**
- Modify: `astrbot/core/astr_main_agent.py` (fresh `ProviderRequest` build branch, near `req.model = sel_model`)

**Interfaces:**
- Consumes: `event.get_extra("thinking_effort")` (set by webchat adapter, Task 5)
- Produces: `req.llm_params["thinking_effort"]` for the runner (Task 2)

- [ ] **Step 1: Inject + whitelist**

```python
            if sel_model := event.get_extra("selected_model"):
                req.model = sel_model
            if thinking_effort := event.get_extra("thinking_effort"):
                if thinking_effort in ("off", "low", "medium", "high"):
                    req.llm_params["thinking_effort"] = thinking_effort
```

- [ ] **Step 2: Verify** — `ruff check astrbot/core/astr_main_agent.py`

- [ ] **Step 3: Commit** — `git commit -am "feat(agent): accept thinking_effort event extra into ProviderRequest"`

---

### Task 4: Provider sources map `thinking_effort`

**Files:**
- Modify: `astrbot/core/provider/sources/openai_source.py` (`_prepare_chat_payload`)
- Modify: `astrbot/core/provider/sources/openai_responses_source.py` (`_prepare_chat_payload`)
- Modify: `astrbot/core/provider/sources/anthropic_source.py` (`_apply_thinking_config`, `_query`, `_query_stream`, `text_chat`, `text_chat_stream`)
- Modify: `astrbot/core/provider/sources/gemini_source.py` (`_prepare_query_config`, `_query`, `_query_stream`, `text_chat`, `text_chat_stream`)

**Interfaces:**
- Consumes: `llm_params` kwarg (Task 2)
- Produces: native provider request fields.

- [ ] **Step 1: openai_source** — in `_prepare_chat_payload`, merge `llm_params` and map effort:

```python
        payloads = {"messages": context_query, "model": model}

        # per-request overrides (e.g. thinking_effort) win over static config
        llm_params = kwargs.pop("llm_params", None)
        if isinstance(llm_params, dict):
            effort = llm_params.get("thinking_effort")
            if effort in ("low", "medium", "high"):
                payloads["reasoning_effort"] = effort
            # "off" / "auto" → leave the provider default

        self._finally_convert_payload(payloads)
```

- [ ] **Step 2: openai_responses_source** — same merge in its `_prepare_chat_payload` (before `return payloads, context_query`); its `_query` already converts `reasoning_effort` → `reasoning: {effort}`.

- [ ] **Step 3: anthropic_source** — thread `llm_params` into `_apply_thinking_config`:

```python
    def _apply_thinking_config(self, payloads: dict, llm_params: dict | None = None) -> None:
        # per-request override takes precedence over static provider config
        if llm_params and (effort := llm_params.get("thinking_effort")):
            if effort == "off":
                payloads.pop("thinking", None)
                payloads.pop("output_config", None)
                return
            if effort in ("low", "medium", "high"):
                payloads["thinking"] = {"type": "adaptive"}
                output_cfg = dict(payloads.get("output_config", {}))
                output_cfg["effort"] = effort
                payloads["output_config"] = output_cfg
                return
        thinking_type = self.thinking_config.get("type", "")
        # ... existing static logic unchanged
```

Add `llm_params: dict | None = None` keyword to `_query`/`_query_stream`, pass to `_apply_thinking_config(payloads, llm_params)`; in `text_chat`/`text_chat_stream` pop `llm_params = kwargs.pop("llm_params", None)` and forward to `_query`/`_query_stream`.

- [ ] **Step 4: gemini_source** — add `llm_params: dict | None = None` to `_prepare_query_config`; in the thinking-config block:

```python
        effort = (llm_params or {}).get("thinking_effort")
        thinking_config = None
        if model_name in [...gemini-2.5 list...]:
            thinking_budget = self.provider_config.get("gm_thinking_config", {}).get("budget", 0)
            if effort == "off":
                thinking_budget = 0
            if thinking_budget is not None:
                thinking_config = types.ThinkingConfig(thinking_budget=thinking_budget)
        elif any(model_name.startswith(p) for p in ("gemini-3-", "gemini-3.")):
            thinking_level = self.provider_config.get("gm_thinking_config", {}).get("level", "HIGH")
            if effort in ("low", "medium", "high"):
                thinking_level = effort.upper()
            elif effort == "off":
                thinking_level = "MINIMAL"
            # ... existing validation + ThinkingConfig build unchanged
```

Thread `llm_params` through `_query`/`_query_stream` (keyword) → `_prepare_query_config`, and from `text_chat`/`text_chat_stream` (`kwargs.pop("llm_params", None)`).

- [ ] **Step 5: Verify** — `ruff check` all four source files.

- [ ] **Step 6: Commit** — `git commit -am "feat(provider): map per-request thinking_effort in openai/anthropic/gemini sources"`

---

### Task 5: API chain pass-through

**Files:**
- Modify: `astrbot/dashboard/services/chat_service.py` (`build_chat_stream` + `prepare_regenerate_message_payload`)
- Modify: `astrbot/dashboard/services/live_chat_service.py` (WS `send` handler)
- Modify: `astrbot/dashboard/services/open_api_service.py` (openapi WS send)
- Modify: `astrbot/core/platform/sources/webchat/webchat_adapter.py` (`create_event`)

**Interfaces:**
- Consumes: frontend `thinking_effort` field (Task 6-7)
- Produces: `event.get_extra("thinking_effort")` for Task 3

- [ ] **Step 1: chat_service** — read `thinking_effort = post_data.get("thinking_effort")`; add `"thinking_effort": thinking_effort` to the queue dict; same key in `prepare_regenerate_message_payload` return dict (`data.get("thinking_effort")`).

- [ ] **Step 2: live_chat_service / open_api_service** — same read + queue-dict entry.

- [ ] **Step 3: webchat_adapter** — `message_event.set_extra("thinking_effort", payload.get("thinking_effort"))`.

- [ ] **Step 4: Verify** — `ruff check` on the four files.

- [ ] **Step 5: Commit** — `git commit -am "feat(api): pass thinking_effort through webchat request chain"`

---

### Task 6: Frontend — ChatInput control + expose getter

**Files:**
- Modify: `dashboard/src/components/chat/ChatInput.vue` (menu template + script + `defineExpose`)

**Interfaces:**
- Produces: `getThinkingEffort(): "auto" | "off" | "low" | "medium" | "high"` exposed method; `thinkingEffortOptions` list.

- [ ] **Step 1: Template** — add menu item between ConfigSelector and streaming toggle:

```vue
            <!-- Thinking Effort Selector in Menu -->
            <v-list-item class="styled-menu-item" rounded="md">
              <template v-slot:prepend>
                <v-icon icon="mdi-brain" size="small"></v-icon>
              </template>
              <v-list-item-title>{{ tm("input.thinkingEffort") }}</v-list-item-title>
              <template v-slot:append>
                <v-select
                  v-model="thinkingEffort"
                  :items="thinkingEffortOptions"
                  density="compact"
                  variant="plain"
                  hide-details
                  style="max-width: 120px"
                  class="thinking-effort-select"
                />
              </template>
            </v-list-item>
```

- [ ] **Step 2: Script** — state, options, persistence, getter:

```ts
type ThinkingEffort = "auto" | "off" | "low" | "medium" | "high";

const thinkingEffortOptions: { title: string; value: ThinkingEffort }[] = [
  { title: "自动", value: "auto" },
  { title: "关闭", value: "off" },
  { title: "低", value: "low" },
  { title: "中", value: "medium" },
  { title: "高", value: "high" },
];

const thinkingEffort = ref<ThinkingEffort>(
  (typeof localStorage !== "undefined" &&
    (localStorage.getItem("thinkingEffort") as ThinkingEffort)) ||
    "auto",
);
watch(thinkingEffort, (value) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("thinkingEffort", value);
  }
});

function getThinkingEffort(): ThinkingEffort {
  return thinkingEffort.value;
}
```

Add `getThinkingEffort` to `defineExpose`.

- [ ] **Step 3: Commit** — `git commit -am "feat(chatui): add thinking effort selector to chat input menu"`

---

### Task 7: Frontend — thread through send path

**Files:**
- Modify: `dashboard/src/composables/useMessages.ts` (`SendMessageStreamOptions`, `startSseStream`, `startWebSocketStream`, `continueEditedMessage`, `regenerateMessage`)
- Modify: `dashboard/src/components/chat/Chat.vue` (send / system command / continue / regenerate call sites)

**Interfaces:**
- Consumes: `getThinkingEffort()` (Task 6)
- Produces: SSE body / WS payload `thinking_effort` field (Task 5)

- [ ] **Step 1: useMessages.ts** — add `thinkingEffort?: string` to `SendMessageStreamOptions` and `ContinueEditedMessageOptions`; add param to `startSseStream`/`startWebSocketStream`; include `thinking_effort: thinkingEffort` in both bodies; pass through in `continueEditedMessage` and `regenerateMessage` body.

- [ ] **Step 2: Chat.vue** — helper + pass at 4 call sites:

```ts
function getCurrentThinkingEffort() {
  return inputRef.value?.getThinkingEffort() ?? "auto";
}
```

Add `thinkingEffort: getCurrentThinkingEffort()` to `sendMessageStream`, `continueEditedMessage`, and `regenerateMessage` calls.

- [ ] **Step 3: Commit** — `git commit -am "feat(chatui): send thinking_effort with chat messages"`

---

### Task 8: i18n strings

**Files:**
- Modify: `dashboard/src/i18n/locales/zh-CN/features/chat.json`
- Modify: `dashboard/src/i18n/locales/en-US/features/chat.json`
- Modify: `dashboard/src/i18n/locales/ru-RU/features/chat.json`

- [ ] **Step 1: zh-CN** — under `"input"`: `"thinkingEffort": "思考强度"` and `"thinkingEffortOptions": { "auto": "自动", "off": "关闭", "low": "低", "medium": "中", "high": "高" }` (or inline option titles).

- [ ] **Step 2: en-US / ru-RU** — same keys translated.

- [ ] **Step 3: Commit** — `git commit -am "feat(i18n): add thinking effort strings"`

---

### Task 9: Verification & final commit

- [ ] **Step 1: Backend** — `ruff check` + `ruff format` on all modified Python files.
- [ ] **Step 2: Frontend** — run dashboard lint/type check (`pnpm --filter dashboard lint` or `vue-tsc`) if toolchain available in worktree; otherwise rely on manual review + existing test files.
- [ ] **Step 3: Smoke review** — grep the diff for `thinking_effort` / `llm_params` consistency across all layers.
- [ ] **Step 4: Final commit** — conventional message; verify `git status` clean.

---

## Review Follow-ups (code-review subagent, 2026-08-15)

Implemented after the review pass; the reviewer's test gap (Important #1) caught one real bug:

1. **Gemini 2.5 effort → budget mapping** (`gemini_source.py`): `low/medium/high` now map to `thinking_budget` 2048/8192/16384; `off` → 0. Previously only `off` was handled and the other levels silently fell back to the static config.
2. **Fixed pre-existing Gemini 3 `thinking_level` bug** (`gemini_source.py`): the code used `setattr(types.ThinkingConfig, "thinking_level", level)` guarded by `hasattr(...)`, but pydantic model fields are not class attributes, so the level silently never reached the API (static `gm_thinking_config.level` path included). Now assigned on the instance.
3. **Ollama override no longer clobbers explicit effort** (`openai_source.py`): `reasoning_effort="none"` is only forced as a fallback when no explicit per-request or `custom_extra_body` effort exists.
4. **Shared `ThinkingEffort` type** exported from `useMessages.ts`, used by `ChatInput.vue` and `Chat.vue` (previously a local union + `string`).
5. **Unit tests added**: `tests/test_thinking_effort_mapping.py` (7 tests) covering Anthropic override/off/static-fallback, OpenAI mapping + Ollama gate, Gemini 3 level and Gemini 2.5 budget mapping. All pass.

Known limitations (documented, not fixable at this layer):
- **OpenAI `off`** = provider default (o-series models cannot disable reasoning via `reasoning_effort`).
- **Gemini 3 `off`** maps to `thinking_level=MINIMAL` (no hard off exists for Gemini 3).
- **Anthropic `off` mid-conversation**: if assistant history carries thinking blocks with signatures, removing the `thinking` config may be rejected by the API. Same behavior as toggling the static config; stripping history thinking blocks is out of scope.
- `reasoning_effort` is forwarded to any OpenAI-compatible endpoint; non-reasoning endpoints may ignore or reject it (accepted per plan).

