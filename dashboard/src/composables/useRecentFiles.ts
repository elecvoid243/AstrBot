// Author: elecvoid243, 2026-07-20
// useRecentFiles: Recent files data layer for the Files view.
//
// 2026-07-20 recent-files-unify: the recent list is now a SINGLE GLOBAL
// bucket shared across the whole project (no per-worktree splitting).
// localStorage key is a fixed constant, MAX_ENTRIES is 5, and the
// previous worktree-path validation has been removed because the list
// is no longer scoped to any directory. Pure data — no knowledge of
// the sidebar or FileBrowser — so this composable can be reused by
// future Quick-Open (A1) and any other feature that needs the list.

import { ref, type Ref } from "vue";

const MAX_ENTRIES = 5;
/** Fixed localStorage key: one global recent-files bucket, shared by
 *  every view that mounts <RecentFilesBlock>. */
const STORAGE_KEY = "spcode.recentFiles.global";

/** One row in the Recent list. LIFO ordered by openedAt desc. */
export interface RecentEntry {
  path: string;
  /** Unix milliseconds. */
  openedAt: number;
}

export interface UseRecentFiles {
  entries: Ref<RecentEntry[]>;
  recordOpen(path: string): void;
  remove(path: string): void;
  clear(): void;
}

interface RecentBucket {
  entries: RecentEntry[];
}

/** localStorage wrapper matching the safe-get/safe-set pattern used in
 *  GitDiffSidebar.vue. Returns "" / no-ops on any exception so quota
 *  / private-mode failures degrade to no-op without throwing. */
function safeGetItem(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* no-op */
  }
}

/** Read + JSON.parse the bucket; returns empty list on any error. */
function loadBucket(): RecentEntry[] {
  const raw = safeGetItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RecentBucket;
    if (!parsed || !Array.isArray(parsed.entries)) return [];
    return parsed.entries;
  } catch {
    return [];
  }
}

/** Persist the bucket. */
function saveBucket(entries: RecentEntry[]): void {
  safeSetItem(STORAGE_KEY, JSON.stringify({ entries } satisfies RecentBucket));
}

export function useRecentFiles(): UseRecentFiles {
  const entries = ref<RecentEntry[]>(loadBucket());

  function recordOpen(path: string): void {
    // Reject empty / whitespace-only paths to keep the list clean.
    if (!path || !path.trim()) return;
    // Dedupe: strip any prior entry pointing at this exact path so
    // the repeat-open re-lands it at the head.
    const filtered = entries.value.filter((e) => e.path !== path);
    filtered.unshift({ path, openedAt: Date.now() });
    // Cap to MAX_ENTRIES. Old entries beyond the cap are discarded
    // (LIFO retention); the 6th recordOpen drops the oldest survivor.
    entries.value = filtered.slice(0, MAX_ENTRIES);
    saveBucket(entries.value);
  }

  function remove(path: string): void {
    entries.value = entries.value.filter((e) => e.path !== path);
    saveBucket(entries.value);
  }

  function clear(): void {
    entries.value = [];
    saveBucket(entries.value);
  }

  return { entries, recordOpen, remove, clear };
}
