// Author: elecvoid243
// Date: 2026-09-01
//
// Tracks chat sessions whose LLM run finished while the user was looking
// at a different session, so the ChatUI sidebar can surface a calm
// "finished" marker. Deliberately separate from the pending-choice store:
// this state is informational (steady green dot, bounded title flash) and
// is cleared as soon as the user opens the session, whereas a pending
// choice (pulsing amber) persists until answered.

import { defineStore } from "pinia";

export const useRunFinishedAttentionStore = defineStore(
  "runFinishedAttention",
  {
    state: () => ({
      // Bare conversation session ids whose run ended unseen.
      sessionIds: [] as string[],
    }),
    getters: {
      count: (state) => state.sessionIds.length,
    },
    actions: {
      hasFinished(sessionId: string): boolean {
        return this.sessionIds.includes(sessionId);
      },
      add(sessionId: string): void {
        if (!sessionId || this.sessionIds.includes(sessionId)) return;
        this.sessionIds.push(sessionId);
      },
      clear(sessionId: string): void {
        this.sessionIds = this.sessionIds.filter((id) => id !== sessionId);
      },
    },
  },
);
