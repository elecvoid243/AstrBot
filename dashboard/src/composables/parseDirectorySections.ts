// Author: elecvoid243
// Date: 2026-07-28
// Spec: docs/superpowers/specs/2026-07-28-git-diff-recursive-directory-tree-design.md §3.3
//
// Recursive directory-section builder for the GitDiff sidebar's file
// list. The previous (2026-06-28) implementation grouped by top-level
// directory only, so a new tracked directory like `new_dir/` showed up
// as a single bucket even when it contained many nested files. After
// the spcode v2.21.1 git-status endpoint started returning recursive
// untracked paths (see webapi-git-status-api.md §6), the UI had no
// matching way to render the tree — this module fills that gap by
// splitting each path on the first `/` and recursing into the tail.
//
// Pure function (no Vue, no axios) so it is unit-testable under
// `node --test` (see tests/buildDirectorySections.test.mjs).

import type { SpcodeGitDiffFile, GitDiffScope } from "./parseSpcodeGitDiff";

/**
 * A node in the directory tree rendered by `GitDiffBodyContent`.
 * Each section has either direct files (no further `/` in the path)
 * or child sections (sub-directories), or both.
 */
export interface DiffSection {
  /** Stable id derived from fullPath; used as `collapsedGroups` Set key. */
  id: string;
  /** Header label. Equals the last path segment, or "<root>" for repo-root. */
  label: string;
  /** Repo-relative POSIX path. Empty string for the synthetic <root> section. */
  fullPath: string;
  /** Number of direct files in this section (excludes children). */
  fileCount: number;
  /** Direct-file-only additions. */
  additions: number;
  /** Direct-file-only deletions. */
  deletions: number;
  /** Files that directly live in this section (no '/' in path). */
  files: SpcodeGitDiffFile[];
  /** Sub-directory sections, recursively the same shape. */
  children: DiffSection[];
  /** Visual badge kind, drives section header dot color. */
  badgeKind: "staged" | "unstaged" | "neutral";
}

/** Visual badge kind derived from the active diff scope. */
function scopeBadge(scope: GitDiffScope): DiffSection["badgeKind"] {
  if (scope === "staged") return "staged";
  if (scope === "all") return "neutral";
  return "unstaged";
}

/** Sum additions/deletions across a list of direct files. */
function sumStats(files: SpcodeGitDiffFile[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return { additions, deletions };
}

/**
 * Group a flat file list into a tree of `DiffSection` by recursively
 * splitting on the first `/` of each path. Bucket insertion order is
 * preserved (= first-seen order in `list`), matching the previous
 * flat-section behavior so the user sees the same diff sequence.
 *
 * Algorithm:
 *   - Empty list → [].
 *   - If every file has no '/' (all leaves), emit a single section:
 *       - parentPath === "" → synthetic "<root>" section.
 *       - parentPath !== "" → section at parentPath containing all files.
 *   - Otherwise, bucket the list by its first '/'-segment; for each
 *     (head, items) bucket, recurse with the stripped paths. The
 *     recursion naturally terminates because each recursion peels
 *     off at least one '/'.
 *
 * Idempotent: same input → same output, including ids. No exceptions
 * are thrown on any well-formed input.
 */
export function buildDirectorySections(
  list: SpcodeGitDiffFile[],
  parentPath: string,
  scope: GitDiffScope,
): DiffSection[] {
  if (list.length === 0) return [];

  // All-leaf shortcut: emit one section without splitting.
  const allLeaves = list.every((f) => !f.path.includes("/"));
  if (allLeaves) {
    const { additions, deletions } = sumStats(list);
    if (parentPath === "") {
      return [
        {
          id: "dir:",
          label: "<root>",
          fullPath: "",
          fileCount: list.length,
          additions,
          deletions,
          files: list,
          children: [],
          badgeKind: scopeBadge(scope),
        },
      ];
    }
    return [
      {
        id: `dir:${parentPath}`,
        label: parentPath.slice(parentPath.lastIndexOf("/") + 1),
        fullPath: parentPath,
        fileCount: list.length,
        additions,
        deletions,
        files: list,
        children: [],
        badgeKind: scopeBadge(scope),
      },
    ];
  }

  // Mixed leaves + nested: bucket by first '/'-segment and recurse.
  // The current section is `parentPath`. Its direct files are
  // items that have no '/' (handled by the recursion's leaf path).
  // The buckets' recursion returns nested sections.
  const directFiles = list.filter((f) => !f.path.includes("/"));
  const nested = list.filter((f) => f.path.includes("/"));
  const buckets = new Map<string, SpcodeGitDiffFile[]>();
  for (const f of nested) {
    const slash = f.path.indexOf("/");
    const head = f.path.slice(0, slash);
    const rest = f.path.slice(slash + 1);
    // Spread to avoid mutating the caller's array; the recursive
    // call will peel off the next segment from `rest`.
    const bucket = buckets.get(head) ?? [];
    bucket.push({ ...f, path: rest });
    buckets.set(head, bucket);
  }
  const children: DiffSection[] = [];
  for (const [head, items] of buckets) {
    const childPath = parentPath ? `${parentPath}/${head}` : head;
    children.push(...buildDirectorySections(items, childPath, scope));
  }
  // Edge case: top-level call with no direct files and only nested
  // items. In that case there is no real "root" directory to
  // represent — promote the children up to the top level so we
  // don't show a synthetic "<root>" wrapper with no files of its
  // own. (Recursive calls always emit their section because the
  // parent explicitly asked for it.)
  if (parentPath === "" && directFiles.length === 0) {
    return children;
  }
  const { additions, deletions } = sumStats(directFiles);
  const section: DiffSection = {
    id: `dir:${parentPath}`,
    label: parentPath === "" ? "<root>" : parentPath.slice(parentPath.lastIndexOf("/") + 1),
    fullPath: parentPath,
    fileCount: directFiles.length,
    additions,
    deletions,
    files: directFiles,
    children,
    badgeKind: scopeBadge(scope),
  };
  return [section];
}

/**
 * Walk every section in the tree in DFS pre-order, calling `fn` on
 * each. Used by the parent (GitDiffBodyContent) to accumulate the
 * top-bar summary, toggle collapse-all, and prune selection. Pure
 * helper, exposed so the test file can introspect id ordering.
 */
export function walkSections(
  sections: DiffSection[],
  fn: (s: DiffSection) => void,
): void {
  for (const s of sections) {
    fn(s);
    if (s.children.length > 0) walkSections(s.children, fn);
  }
}
