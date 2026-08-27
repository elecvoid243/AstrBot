// Author: elecvoid243, 2026-07-20
// 2026-08-27 recent-files-split: buckets are keyed per worktree AND per
// view scope ("files" / "docs"), so the workspace Files view and the
// docs DocumentManager keep separate recent lists, and each list is
// scoped to the worktree it was browsed in. Restores the pre-unify
// per-worktree keying plus a view dimension. Pure data — no knowledge
// of the sidebar or FileBrowser — so this composable can be reused by
// future Quick-Open (A1) and any other feature that needs the list.

import { ref, watch, type Ref } from "vue";

const MAX_ENTRIES = 5;

/** Which page owns the bucket. Files view and docs view never share
 *  entries, so each gets its own key namespace. */
export type RecentFilesScope = "files" | "docs";

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

/** FNV-1a 32-bit hash, lowercase hex, zero-padded to 8 chars.
 *  NOT cryptographic — only used to keep localStorage keys short and
 *  free of filesystem separators / unicode quirks. ~10 lines, sync,
 *  zero deps (mirrors the same function in useRecentFiles.spec.ts;
 *  keep the two byte-identical). */
export function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
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

/** Resolve current bucket key. Returns "" when no worktree is set so
 *  callers can early-out uniformly. */
function bucketKey(worktreeRoot: string | null, scope: RecentFilesScope): string {
  if (!worktreeRoot) return "";
  try {
    return `spcode.recentFiles.${scope}.${fnv1aHex(worktreeRoot)}`;
  } catch {
    // Extreme fallback: pathological string inputs. Encode and slice.
    const fallback = encodeURIComponent(worktreeRoot).slice(0, 32);
    return `spcode.recentFiles.${scope}.rt-${fallback}`;
  }
}

/** Read + JSON.parse a bucket; returns empty list on any error. */
function loadBucket(key: string): RecentEntry[] {
  const raw = safeGetItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RecentBucket;
    if (!parsed || !Array.isArray(parsed.entries)) return [];
    return parsed.entries;
  } catch {
    return [];
  }
}

/** Persist a bucket. */
function saveBucket(key: string, entries: RecentEntry[]): void {
  safeSetItem(key, JSON.stringify({ entries } satisfies RecentBucket));
}

/** Worktree-separator detection: Windows root contains '\', others '/'.
 *  Mirrors the spec §6.1 logic exactly. */
function sepOf(root: string): string {
  return root.includes("\\") ? "\\" : "/";
}

/**
 * Per-worktree, per-view recent-files bucket.
 *
 * Args:
 *   worktree: Ref to the effective root the calling view operates in
 *     (Files view: `currentRoot`; docs view: the active worktree /
 *     projectRoot prop). Switching the ref re-loads the bucket.
 *   scope: Which page owns the list — "files" (workspace Files view)
 *     or "docs" (DocumentManager). The two never share entries.
 */
export function useRecentFiles(
  worktree: Ref<string | null>,
  scope: RecentFilesScope,
): UseRecentFiles {
  const entries = ref<RecentEntry[]>([]);

  function persist(): void {
    const key = bucketKey(worktree.value, scope);
    if (!key) return;
    saveBucket(key, entries.value);
  }

  /** Load + replace entries from localStorage for the current bucket.
   *  Called on mount and on every worktree-ref change. */
  function loadForCurrent(): void {
    const key = bucketKey(worktree.value, scope);
    if (!key) {
      entries.value = [];
      return;
    }
    entries.value = loadBucket(key);
  }

  function recordOpen(path: string): void {
    const root = worktree.value;
    if (!root) return;
    // Path validation: the file must live strictly inside the worktree
    // (or be the root itself). Prevents arbitrary filesystem paths
    // from polluting the bucket from search jumps or external triggers.
    const sep = sepOf(root);
    if (path !== root && !path.startsWith(root + sep)) return;

    // Dedupe: strip any prior entry pointing at this exact path so
    // the repeat-open re-lands it at the head.
    const filtered = entries.value.filter((e) => e.path !== path);
    filtered.unshift({ path, openedAt: Date.now() });
    // Cap to MAX_ENTRIES. Old entries beyond the cap are discarded
    // (LIFO retention).
    entries.value = filtered.slice(0, MAX_ENTRIES);
    persist();
  }
  function remove(path: string): void {
    entries.value = entries.value.filter((e) => e.path !== path);
    persist();
  }

  function clear(): void {
    entries.value = [];
    persist();
  }

  // Initial load.
  loadForCurrent();

  // Re-load whenever the worktree ref changes. `flush: "sync"` keeps
  // the load deterministic — loadBucket is a single JSON.parse
  // bounded by MAX_ENTRIES, no observable cost.
  watch(worktree, () => loadForCurrent(), { flush: "sync" });

  return { entries, recordOpen, remove, clear };
}
