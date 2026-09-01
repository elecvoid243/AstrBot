// Author: elecvoid243
// Date: 2026-09-01
//
// Regression tests for the run-finished notice: a session the user is
// currently viewing must produce no marker at all (the arriving output is
// the reminder), and a background session's title flash must be bounded —
// it restores the original title by itself instead of nagging forever.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useRunFinishedAttentionStore } from "@/stores/runFinishedAttention";
import { markRunFinishedAttention } from "./useChoiceReminder";

describe("markRunFinishedAttention", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.title = "AstrBot";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records nothing when the finished run is the session being viewed", () => {
    markRunFinishedAttention("sess-1", "Reply finished", true);

    expect(useRunFinishedAttentionStore().hasFinished("sess-1")).toBe(false);
    expect(document.title).toBe("AstrBot");
  });

  it("marks a background session and flashes the title boundedly", () => {
    markRunFinishedAttention("sess-1", "Reply finished", false);

    expect(useRunFinishedAttentionStore().hasFinished("sess-1")).toBe(true);
    // First toggle shows the notice...
    vi.advanceTimersByTime(800);
    expect(document.title).toBe("Reply finished");
    // ...and after 3 flashes (6 toggles) the original title is restored.
    vi.advanceTimersByTime(800 * 5);
    expect(document.title).toBe("AstrBot");
    // The interval is gone — advancing further keeps the title stable.
    vi.advanceTimersByTime(800 * 10);
    expect(document.title).toBe("AstrBot");
  });
});
