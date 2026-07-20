// Author: elecvoid243, 2026-07-20
// 2026-07-20 recent-files-unify: the recent list is now a single
// global bucket (no per-worktree splitting), MAX_ENTRIES is 5, and
// the composable takes no parameters. These tests cover the new
// contract: shared bucket across instances, dedupe + LIFO, 5-row cap
// with the oldest dropped on overflow, persistence, remove, clear,
// and the empty-path guard.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRecentFiles } from "@/composables/useRecentFiles";

const STORAGE_KEY = "spcode.recentFiles.global";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function seeded(entries: { path: string; openedAt: number }[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries }));
}

describe("initial load", () => {
  it("returns an empty list when localStorage has no bucket", () => {
    const { entries } = useRecentFiles();
    expect(entries.value).toEqual([]);
  });

  it("returns prior entries when the bucket exists and parses correctly", () => {
    seeded([{ path: "/repo/src/main.py", openedAt: 1700000000000 }]);
    const { entries } = useRecentFiles();
    expect(entries.value).toEqual([
      { path: "/repo/src/main.py", openedAt: 1700000000000 },
    ]);
  });

  it("falls back to empty list when the stored JSON is malformed", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const { entries } = useRecentFiles();
    expect(entries.value).toEqual([]);
  });
});

describe("recordOpen", () => {
  it("appends a new entry to the head", () => {
    const { entries, recordOpen } = useRecentFiles();
    recordOpen("/repo/src/main.py");
    expect(entries.value).toHaveLength(1);
    expect(entries.value[0].path).toBe("/repo/src/main.py");
    expect(typeof entries.value[0].openedAt).toBe("number");
  });

  it("treats a repeat open of the same path as no new row, refreshed to head", () => {
    const { entries, recordOpen } = useRecentFiles();
    recordOpen("/repo/a.py");
    recordOpen("/repo/b.py");
    recordOpen("/repo/a.py"); // duplicate
    expect(entries.value.map((e) => e.path)).toEqual(["/repo/a.py", "/repo/b.py"]);
    // head 'a' should have a newer openedAt than the bottom 'b'
    expect(entries.value[0].openedAt).toBeGreaterThanOrEqual(
      entries.value[1].openedAt,
    );
  });

  it("orders latest-open first across three distinct paths", () => {
    const { entries, recordOpen } = useRecentFiles();
    recordOpen("/repo/a.py");
    recordOpen("/repo/b.py");
    recordOpen("/repo/c.py");
    expect(entries.value.map((e) => e.path)).toEqual([
      "/repo/c.py",
      "/repo/b.py",
      "/repo/a.py",
    ]);
  });

  it("rejects empty / whitespace-only paths", () => {
    const { entries, recordOpen } = useRecentFiles();
    recordOpen("");
    recordOpen("   ");
    expect(entries.value).toEqual([]);
  });

  it("trims to MAX_ENTRIES (5), dropping the oldest entry on the 6th open", () => {
    const { entries, recordOpen } = useRecentFiles();
    for (let i = 0; i < 6; i++) {
      recordOpen(`/repo/file-${i}.py`);
    }
    expect(entries.value).toHaveLength(5);
    // LIFO order: head = newest (file-5), tail = oldest survivor (file-1).
    // The very first open (file-0) should have been dropped.
    expect(entries.value.map((e) => e.path)).toEqual([
      "/repo/file-5.py",
      "/repo/file-4.py",
      "/repo/file-3.py",
      "/repo/file-2.py",
      "/repo/file-1.py",
    ]);
  });

  it("persists to localStorage on every recordOpen", () => {
    const { recordOpen } = useRecentFiles();
    recordOpen("/repo/main.py");
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].path).toBe("/repo/main.py");
  });
});

describe("shared bucket across composable instances", () => {
  it("two instances read the same storage key on mount", () => {
    // Simulate the user-visible "切换目录后列表不丢" regression: a
    // first instance writes to storage, then we throw it away and
    // mount a fresh instance (the analogue of switching worktrees /
    // project roots and re-rendering the sidebar). The new mount
    // must read the prior entries back.
    const first = useRecentFiles();
    first.recordOpen("/worktrees/A/a.py");
    first.recordOpen("/worktrees/B/b.py");

    // Discard the first instance and mount fresh. The new instance
    // must see the persisted entries from `first`.
    const second = useRecentFiles();
    expect(second.entries.value.map((e) => e.path)).toEqual([
      "/worktrees/B/b.py",
      "/worktrees/A/a.py",
    ]);
  });

  it("does not split buckets by path (regression: per-worktree splitting)", () => {
    // The user-visible bug: switching the active worktree / project
    // root used to remount the composable with a different bucket
    // key, leaving the old list behind. Under the new global-bucket
    // contract, paths from "different directories" coexist in the
    // same list.
    const { entries, recordOpen } = useRecentFiles();
    recordOpen("/worktrees/A/a.py");
    recordOpen("/worktrees/B/b.py");
    recordOpen("/repo/c.py");
    expect(entries.value.map((e) => e.path)).toEqual([
      "/repo/c.py",
      "/worktrees/B/b.py",
      "/worktrees/A/a.py",
    ]);
  });

  it("persists the 5-cap across remounts (regression: per-worktree re-accumulation)", () => {
    // The user-visible bug: switching from root → /data → root used
    // to land in two separate buckets, so each "side" accumulated
    // its own 50 entries instead of sharing a single 5-cap list.
    // After unifying, recording 6 paths (regardless of their roots)
    // and remounting must yield exactly 5 entries with the oldest
    // dropped.
    const first = useRecentFiles();
    for (let i = 0; i < 6; i++) {
      first.recordOpen(`/some/dir/file-${i}.py`);
    }
    const second = useRecentFiles();
    expect(second.entries.value).toHaveLength(5);
    expect(second.entries.value.map((e) => e.path)).toEqual([
      "/some/dir/file-5.py",
      "/some/dir/file-4.py",
      "/some/dir/file-3.py",
      "/some/dir/file-2.py",
      "/some/dir/file-1.py",
    ]);
  });
});

describe("remove", () => {
  it("drops the row whose path matches exactly", () => {
    const { entries, recordOpen, remove } = useRecentFiles();
    recordOpen("/repo/a.py");
    recordOpen("/repo/b.py");
    remove("/repo/a.py");
    expect(entries.value.map((e) => e.path)).toEqual(["/repo/b.py"]);
  });

  it("is a no-op when the path is not present", () => {
    const { entries, recordOpen, remove } = useRecentFiles();
    recordOpen("/repo/a.py");
    remove("/repo/nope.py");
    expect(entries.value.map((e) => e.path)).toEqual(["/repo/a.py"]);
  });

  it("persists the trimmed list", () => {
    const { recordOpen, remove } = useRecentFiles();
    recordOpen("/repo/a.py");
    recordOpen("/repo/b.py");
    remove("/repo/a.py");
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.entries.map((e: { path: string }) => e.path)).toEqual([
      "/repo/b.py",
    ]);
  });
});

describe("clear", () => {
  it("empties the list", () => {
    const { entries, recordOpen, clear } = useRecentFiles();
    recordOpen("/repo/a.py");
    recordOpen("/repo/b.py");
    clear();
    expect(entries.value).toEqual([]);
  });

  it("persists the empty list", () => {
    const { recordOpen, clear } = useRecentFiles();
    recordOpen("/repo/a.py");
    clear();
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.entries).toEqual([]);
  });

  it("clear on one instance empties the bucket for the next mount", () => {
    const a = useRecentFiles();
    a.recordOpen("/repo/a.py");
    a.clear();
    const b = useRecentFiles();
    expect(b.entries.value).toEqual([]);
  });
});
