// Author: elecvoid243, 2026-07-20
// 2026-08-27 recent-files-split: buckets are keyed per worktree AND per
// view scope ("files" / "docs"). These tests cover the new contract:
// scope + worktree key isolation, worktree-switch reload, dedupe +
// LIFO, 5-row cap with the oldest dropped on overflow, inside-worktree
// path validation, persistence, remove, clear, and the empty-path /
// null-worktree guards.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import {
  useRecentFiles,
  fnv1aHex,
  type RecentEntry,
} from "@/composables/useRecentFiles";

function storageKey(scope: "files" | "docs", worktreeRoot: string): string {
  return `spcode.recentFiles.${scope}.${fnv1aHex(worktreeRoot)}`;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function seeded(
  scope: "files" | "docs",
  worktreeRoot: string,
  entries: RecentEntry[],
): void {
  localStorage.setItem(storageKey(scope, worktreeRoot), JSON.stringify({ entries }));
}

describe("initial load", () => {
  it("returns an empty list when localStorage has no bucket", () => {
    const worktree = ref<string | null>("/repo");
    const { entries } = useRecentFiles(worktree, "files");
    expect(entries.value).toEqual([]);
  });

  it("returns prior entries when the bucket exists and parses correctly", () => {
    seeded("files", "/repo", [
      { path: "/repo/src/main.py", openedAt: 1700000000000 },
    ]);
    const worktree = ref<string | null>("/repo");
    const { entries } = useRecentFiles(worktree, "files");
    expect(entries.value).toEqual([
      { path: "/repo/src/main.py", openedAt: 1700000000000 },
    ]);
  });

  it("falls back to empty list when the stored JSON is malformed", () => {
    localStorage.setItem(storageKey("files", "/repo"), "{not json");
    const worktree = ref<string | null>("/repo");
    const { entries } = useRecentFiles(worktree, "files");
    expect(entries.value).toEqual([]);
  });

  it("starts empty when the worktree ref is null", () => {
    const worktree = ref<string | null>(null);
    const { entries } = useRecentFiles(worktree, "files");
    expect(entries.value).toEqual([]);
  });
});

describe("recordOpen", () => {
  it("appends a new entry to the head", () => {
    const worktree = ref<string | null>("/repo");
    const { entries, recordOpen } = useRecentFiles(worktree, "files");
    recordOpen("/repo/src/main.py");
    expect(entries.value).toHaveLength(1);
    expect(entries.value[0].path).toBe("/repo/src/main.py");
    expect(typeof entries.value[0].openedAt).toBe("number");
  });

  it("treats a repeat open of the same path as no new row, refreshed to head", () => {
    const worktree = ref<string | null>("/repo");
    const { entries, recordOpen } = useRecentFiles(worktree, "files");
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
    const worktree = ref<string | null>("/repo");
    const { entries, recordOpen } = useRecentFiles(worktree, "files");
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
    const worktree = ref<string | null>("/repo");
    const { entries, recordOpen } = useRecentFiles(worktree, "files");
    recordOpen("");
    recordOpen("   ");
    expect(entries.value).toEqual([]);
  });

  it("rejects paths outside the worktree root", () => {
    const worktree = ref<string | null>("/repo");
    const { entries, recordOpen } = useRecentFiles(worktree, "files");
    recordOpen("/other/repo/a.py");
    // Prefix-adjacent sibling directory must not sneak in either.
    recordOpen("/repository/a.py");
    expect(entries.value).toEqual([]);
  });

  it("accepts the root itself and Windows-separator paths under a Windows root", () => {
    const worktree = ref<string | null>("C:\\work\\repo");
    const { entries, recordOpen } = useRecentFiles(worktree, "files");
    recordOpen("C:\\work\\repo");
    recordOpen("C:\\work\\repo\\src\\main.py");
    expect(entries.value.map((e) => e.path)).toEqual([
      "C:\\work\\repo\\src\\main.py",
      "C:\\work\\repo",
    ]);
  });

  it("trims to MAX_ENTRIES (5), dropping the oldest entry on the 6th open", () => {
    const worktree = ref<string | null>("/repo");
    const { entries, recordOpen } = useRecentFiles(worktree, "files");
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

  it("persists to the scoped localStorage key on every recordOpen", () => {
    const worktree = ref<string | null>("/repo");
    const { recordOpen } = useRecentFiles(worktree, "files");
    recordOpen("/repo/main.py");
    const raw = localStorage.getItem(storageKey("files", "/repo"));
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].path).toBe("/repo/main.py");
  });

  it("is a no-op when the worktree ref is null", () => {
    const worktree = ref<string | null>(null);
    const { entries, recordOpen } = useRecentFiles(worktree, "files");
    recordOpen("/repo/a.py");
    expect(entries.value).toEqual([]);
  });
});

describe("per-worktree + per-scope buckets", () => {
  it("keeps separate lists per worktree and reloads on worktree switch", () => {
    const worktree = ref<string | null>("/worktrees/A");
    const { entries, recordOpen } = useRecentFiles(worktree, "files");
    recordOpen("/worktrees/A/a.py");

    worktree.value = "/worktrees/B";
    // The bucket for B starts empty; its writes don't touch A's.
    expect(entries.value).toEqual([]);
    recordOpen("/worktrees/B/b.py");
    expect(entries.value.map((e) => e.path)).toEqual(["/worktrees/B/b.py"]);

    // Switching back re-loads A's persisted history.
    worktree.value = "/worktrees/A";
    expect(entries.value.map((e) => e.path)).toEqual(["/worktrees/A/a.py"]);
  });

  it("keeps 'files' and 'docs' separate for the same worktree", () => {
    const worktree = ref<string | null>("/repo");
    const files = useRecentFiles(worktree, "files");
    const docs = useRecentFiles(worktree, "docs");

    files.recordOpen("/repo/src/main.py");
    docs.recordOpen("/repo/docs/spec.md");

    expect(files.entries.value.map((e) => e.path)).toEqual([
      "/repo/src/main.py",
    ]);
    expect(docs.entries.value.map((e) => e.path)).toEqual(["/repo/docs/spec.md"]);
    expect(localStorage.getItem(storageKey("files", "/repo"))).not.toBeNull();
    expect(localStorage.getItem(storageKey("docs", "/repo"))).not.toBeNull();
    expect(localStorage.getItem("spcode.recentFiles.global")).toBeNull();
  });

  it("two instances with the same scope + worktree share one bucket across remounts", () => {
    const worktree = ref<string | null>("/repo");
    const first = useRecentFiles(worktree, "files");
    first.recordOpen("/repo/a.py");
    first.recordOpen("/repo/b.py");

    // Fresh instance (the analogue of a view remount) reads the same
    // persisted bucket back.
    const second = useRecentFiles(worktree, "files");
    expect(second.entries.value.map((e) => e.path)).toEqual([
      "/repo/b.py",
      "/repo/a.py",
    ]);
  });
});

describe("remove", () => {
  it("drops the row whose path matches exactly", () => {
    const worktree = ref<string | null>("/repo");
    const { entries, recordOpen, remove } = useRecentFiles(worktree, "files");
    recordOpen("/repo/a.py");
    recordOpen("/repo/b.py");
    remove("/repo/a.py");
    expect(entries.value.map((e) => e.path)).toEqual(["/repo/b.py"]);
  });

  it("is a no-op when the path is not present", () => {
    const worktree = ref<string | null>("/repo");
    const { entries, recordOpen, remove } = useRecentFiles(worktree, "files");
    recordOpen("/repo/a.py");
    remove("/repo/nope.py");
    expect(entries.value.map((e) => e.path)).toEqual(["/repo/a.py"]);
  });

  it("persists the trimmed list", () => {
    const worktree = ref<string | null>("/repo");
    const { recordOpen, remove } = useRecentFiles(worktree, "files");
    recordOpen("/repo/a.py");
    recordOpen("/repo/b.py");
    remove("/repo/a.py");
    const raw = JSON.parse(localStorage.getItem(storageKey("files", "/repo"))!);
    expect(raw.entries.map((e: { path: string }) => e.path)).toEqual([
      "/repo/b.py",
    ]);
  });
});

describe("clear", () => {
  it("empties the list", () => {
    const worktree = ref<string | null>("/repo");
    const { entries, recordOpen, clear } = useRecentFiles(worktree, "files");
    recordOpen("/repo/a.py");
    recordOpen("/repo/b.py");
    clear();
    expect(entries.value).toEqual([]);
  });

  it("persists the empty list", () => {
    const worktree = ref<string | null>("/repo");
    const { recordOpen, clear } = useRecentFiles(worktree, "files");
    recordOpen("/repo/a.py");
    clear();
    const raw = JSON.parse(localStorage.getItem(storageKey("files", "/repo"))!);
    expect(raw.entries).toEqual([]);
  });

  it("only clears its own scope + worktree bucket", () => {
    const worktree = ref<string | null>("/repo");
    const files = useRecentFiles(worktree, "files");
    const docs = useRecentFiles(worktree, "docs");
    files.recordOpen("/repo/a.py");
    docs.recordOpen("/repo/docs/a.md");

    files.clear();
    expect(files.entries.value).toEqual([]);
    expect(docs.entries.value.map((e) => e.path)).toEqual(["/repo/docs/a.md"]);
  });
});
