// Author: elecvoid243
// Date: 2026-08-13
//
// Unit tests for the interactive-choice attention store that drives the
// ChatUI sidebar highlight and browser badge count.

import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useInteractiveChoiceAttentionStore } from "./interactiveChoiceAttention";

describe("interactiveChoiceAttention store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("adds session ids and dedups duplicates", () => {
    const store = useInteractiveChoiceAttentionStore();
    store.add("s1");
    store.add("s1");
    store.add("s2");

    expect(store.sessionIds).toEqual(["s1", "s2"]);
    expect(store.count).toBe(2);
    expect(store.hasAttention("s1")).toBe(true);
    expect(store.hasAttention("s2")).toBe(true);
    expect(store.hasAttention("s3")).toBe(false);
  });

  it("clears a single session and keeps the others", () => {
    const store = useInteractiveChoiceAttentionStore();
    store.add("s1");
    store.add("s2");

    store.clear("s1");

    expect(store.hasAttention("s1")).toBe(false);
    expect(store.hasAttention("s2")).toBe(true);
    expect(store.count).toBe(1);
  });

  it("clears by umo (last :/!-separated segment is the session id)", () => {
    const store = useInteractiveChoiceAttentionStore();
    store.add("cid-123");
    store.add("other");

    store.clearByUmo("webchat:FriendMessage:webchat!user!cid-123");

    expect(store.hasAttention("cid-123")).toBe(false);
    expect(store.hasAttention("other")).toBe(true);
  });

  it("ignores an empty session id on add", () => {
    const store = useInteractiveChoiceAttentionStore();
    store.add("");

    expect(store.count).toBe(0);
  });
});
