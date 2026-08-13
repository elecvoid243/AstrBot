// Author: elecvoid243
// Date: 2026-08-13
//
// Tracks which chat sessions have an unanswered `ask_user_choice` prompt
// so the ChatUI sidebar can highlight them and the browser can surface an
// attention badge / title flash. Keyed by the bare conversation session id
// (`session.session_id`), the same value `useMessages` passes to the SSE
// stream consumers.

import { defineStore } from "pinia";

export const useInteractiveChoiceAttentionStore = defineStore(
  "interactiveChoiceAttention",
  {
    state: () => ({
      // Bare conversation session ids currently awaiting a user choice.
      sessionIds: [] as string[],
    }),
    getters: {
      count: (state) => state.sessionIds.length,
    },
    actions: {
      hasAttention(sessionId: string): boolean {
        return this.sessionIds.includes(sessionId);
      },
      add(sessionId: string): void {
        if (!sessionId || this.sessionIds.includes(sessionId)) return;
        this.sessionIds.push(sessionId);
      },
      clear(sessionId: string): void {
        this.sessionIds = this.sessionIds.filter((id) => id !== sessionId);
      },
      /**
       * Clear attention by the full unified_msg_origin (umo). The umo
       * format is `{platform}:{type}:{...}!{sessionId}`, so the bare
       * conversation id is its last `:`/`!`-separated segment — the same
       * value `session.session_id` uses. Used by the InteractiveChoiceBox
       * submit/cancel path, which only has the umo in scope.
       */
      clearByUmo(umo: string): void {
        if (!umo) return;
        const parts = umo.split(/[:!]/);
        const sessionId = parts[parts.length - 1] ?? "";
        if (sessionId) this.clear(sessionId);
      },
    },
  },
);
