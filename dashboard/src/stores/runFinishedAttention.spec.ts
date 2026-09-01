// Author: elecvoid243
// Date: 2026-09-01
//
// Unit tests for the run-finished attention store that drives the calm
// sidebar marker for sessions whose LLM run ended unseen.

import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useRunFinishedAttentionStore } from "./runFinishedAttention";

describe("runFinishedAttention store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("adds session ids and dedups duplicates", () => {
    const store = useRunFinishedAttentionStore();
    store.add("s1");
    store.add("s1");
    store.add("s2");

    expect(store.sessionIds).toEqual(["s1", "s2"]);
    expect(store.count).toBe(2);
    expect(store.hasFinished("s1")).toBe(true);
    expect(store.hasFinished("s3")).toBe(false);
  });

  it("ignores empty session ids", () => {
    const store = useRunFinishedAttentionStore();
    store.add("");

    expect(store.sessionIds).toEqual([]);
  });

  it("clears a single session and keeps the others", () => {
    const store = useRunFinishedAttentionStore();
    store.add("s1");
    store.add("s2");

    store.clear("s1");

    expect(store.hasFinished("s1")).toBe(false);
    expect(store.hasFinished("s2")).toBe(true);
    expect(store.count).toBe(1);
  });
});
