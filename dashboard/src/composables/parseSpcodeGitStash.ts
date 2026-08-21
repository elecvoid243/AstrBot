// Author: elecvoid243 @ 2026-08-21
// API: astrbot_plugin_spcode_toolkit tools/webapi/git_stash.py
//
// Pure parsers for GET /spcode/git-stash (stash 列表 + 文件明细) and
// POST /spcode/git-stash (git stash push -u)。No Vue / no axios.
// Mirrors parseSpcodeGitRemoteSync.ts.
//
// Both endpoints share the envelope:
//   { status: "ok", data: { success, reason, stderr, elapsed_ms, ... } }
// Failure is signalled by data.reason !== null; HTTP stays 200.

import { type GitOpReasonMeta } from "./parseSpcodeGitMerge";

// ── Envelope + coercion helpers ──────────────────────────

function unwrapData(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("missing status envelope");
  }
  const env = raw as { status?: unknown; data?: unknown };
  if (env.status !== "ok") {
    throw new Error("unexpected status envelope");
  }
  if (typeof env.data !== "object" || env.data === null) {
    throw new Error("missing data in response");
  }
  return env.data as Record<string, unknown>;
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}
function asBoolean(v: unknown): boolean {
  return v === true;
}

/** numstat "-" (binary) arrives as null additions/deletions. */
function asCount(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function asStashFiles(v: unknown): SpcodeStashFile[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): SpcodeStashFile[] => {
    if (typeof x !== "object" || x === null) return [];
    const f = x as Record<string, unknown>;
    const path = asString(f.path);
    if (!path) return [];
    return [
      {
        path,
        additions: asCount(f.additions),
        deletions: asCount(f.deletions),
        untracked: asBoolean(f.untracked),
      },
    ];
  });
}

function asStashEntries(v: unknown): SpcodeStashEntry[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): SpcodeStashEntry[] => {
    if (typeof x !== "object" || x === null) return [];
    const e = x as Record<string, unknown>;
    const ref = asString(e.ref);
    if (!ref) return [];
    return [
      {
        index: asNumber(e.index),
        ref,
        sha: asString(e.sha),
        message: asString(e.message),
        timestamp: asNumber(e.timestamp),
        files: asStashFiles(e.files),
        fileCount: asNumber(e.file_count),
      },
    ];
  });
}

// ── Snapshots ────────────────────────────────────────────

export interface SpcodeStashFile {
  path: string;
  /** null → binary content (git numstat "-"). */
  additions: number | null;
  deletions: number | null;
  /** Files stored in the stash's untracked commit (push -u). */
  untracked: boolean;
}

export interface SpcodeStashEntry {
  index: number;
  ref: string;
  sha: string;
  message: string;
  /** Unix seconds of when the stash was created. */
  timestamp: number;
  files: SpcodeStashFile[];
  fileCount: number;
}

export interface SpcodeStashListSnapshot {
  success: boolean;
  reason: string | null;
  stderr: string;
  elapsedMs: number;
  umo: string;
  worktree: string;
  directory: string;
  count: number;
  truncated: boolean;
  maxStashes: number;
  stashes: SpcodeStashEntry[];
}

export interface SpcodeStashPushSnapshot {
  success: boolean;
  reason: string | null;
  stderr: string;
  elapsedMs: number;
  umo: string;
  worktree: string;
  directory: string;
  stashed: boolean;
  ref: string;
  sha: string;
  message: string;
  timestamp: number;
  files: SpcodeStashFile[];
  fileCount: number;
  stashCount: number;
}

export interface SpcodeStashPopSnapshot {
  success: boolean;
  reason: string | null;
  stderr: string;
  elapsedMs: number;
  umo: string;
  worktree: string;
  directory: string;
  popped: boolean;
  ref: string;
  sha: string;
  files: SpcodeStashFile[];
  fileCount: number;
  /** Stash entries remaining after the pop (a clean pop drops the entry). */
  stashCount: number;
}

export interface SpcodeStashDropSnapshot {
  success: boolean;
  reason: string | null;
  stderr: string;
  elapsedMs: number;
  umo: string;
  worktree: string;
  directory: string;
  dropped: boolean;
  ref: string;
  sha: string;
  /** Stash entries remaining after the drop. */
  stashCount: number;
}

export type ParseResult<T> =
  | { kind: "ok"; snapshot: T }
  | { kind: "error"; reason: string };

// ── Endpoint parsers ─────────────────────────────────────

/** Parse the envelope from GET /spcode/git-stash. */
export function parseSpcodeStashList(
  raw: unknown,
): ParseResult<SpcodeStashListSnapshot> {
  const d = unwrapData(raw);
  return {
    kind: "ok",
    snapshot: {
      success: d.reason === null || d.reason === undefined,
      reason: (d.reason as string | null) ?? null,
      stderr: asString(d.stderr),
      elapsedMs: asNumber(d.elapsed_ms),
      umo: asString(d.umo),
      worktree: asString(d.worktree),
      directory: asString(d.directory),
      count: asNumber(d.count),
      truncated: asBoolean(d.truncated),
      maxStashes: asNumber(d.max_stashes, 50),
      stashes: asStashEntries(d.stashes),
    },
  };
}

/** Parse the envelope from POST /spcode/git-stash. */
export function parseSpcodeStashPush(
  raw: unknown,
): ParseResult<SpcodeStashPushSnapshot> {
  const d = unwrapData(raw);
  return {
    kind: "ok",
    snapshot: {
      success: d.reason === null || d.reason === undefined,
      reason: (d.reason as string | null) ?? null,
      stderr: asString(d.stderr),
      elapsedMs: asNumber(d.elapsed_ms),
      umo: asString(d.umo),
      worktree: asString(d.worktree),
      directory: asString(d.directory),
      stashed: asBoolean(d.stashed),
      ref: asString(d.ref),
      sha: asString(d.sha),
      message: asString(d.message),
      timestamp: asNumber(d.timestamp),
      files: asStashFiles(d.files),
      fileCount: asNumber(d.file_count),
      stashCount: asNumber(d.stash_count),
    },
  };
}

/** Parse the envelope from POST /spcode/git-stash-pop. */
export function parseSpcodeStashPop(
  raw: unknown,
): ParseResult<SpcodeStashPopSnapshot> {
  const d = unwrapData(raw);
  return {
    kind: "ok",
    snapshot: {
      success: d.reason === null || d.reason === undefined,
      reason: (d.reason as string | null) ?? null,
      stderr: asString(d.stderr),
      elapsedMs: asNumber(d.elapsed_ms),
      umo: asString(d.umo),
      worktree: asString(d.worktree),
      directory: asString(d.directory),
      popped: asBoolean(d.popped),
      ref: asString(d.ref),
      sha: asString(d.sha),
      files: asStashFiles(d.files),
      fileCount: asNumber(d.file_count),
      stashCount: asNumber(d.stash_count),
    },
  };
}

/** Parse the envelope from POST /spcode/git-stash-drop. */
export function parseSpcodeStashDrop(
  raw: unknown,
): ParseResult<SpcodeStashDropSnapshot> {
  const d = unwrapData(raw);
  return {
    kind: "ok",
    snapshot: {
      success: d.reason === null || d.reason === undefined,
      reason: (d.reason as string | null) ?? null,
      stderr: asString(d.stderr),
      elapsedMs: asNumber(d.elapsed_ms),
      umo: asString(d.umo),
      worktree: asString(d.worktree),
      directory: asString(d.directory),
      dropped: asBoolean(d.dropped),
      ref: asString(d.ref),
      sha: asString(d.sha),
      stashCount: asNumber(d.stash_count),
    },
  };
}

// ── Reason classification ────────────────────────────────

const STASH_PREFIX = "spcodeProjectLoad.diffSidebar.stash";

const PREFLIGHT_AS_GIT_ERROR = [
  "feature_disabled",
  "no_project_loaded",
  "worktree_invalid",
  "directory_missing",
  "not_a_git_repo",
  "git_unavailable",
];

const STASH_REASON_CODES: Record<string, GitOpReasonMeta> = {
  nothing_to_stash: {
    i18nKey: `${STASH_PREFIX}.error.nothing_to_stash`,
    color: "warning",
  },
  stash_failed: {
    i18nKey: `${STASH_PREFIX}.error.stash_failed`,
    color: "error",
    withStderr: true,
  },
  stash_not_found: {
    i18nKey: `${STASH_PREFIX}.error.stash_not_found`,
    color: "warning",
  },
  stash_conflict: {
    i18nKey: `${STASH_PREFIX}.error.stash_conflict`,
    color: "warning",
    withStderr: true,
  },
  stash_drop_failed: {
    i18nKey: `${STASH_PREFIX}.error.stash_drop_failed`,
    color: "error",
    withStderr: true,
  },
  worktree_dirty: {
    i18nKey: `${STASH_PREFIX}.error.worktree_dirty`,
    color: "warning",
  },
  operation_in_progress: {
    i18nKey: `${STASH_PREFIX}.error.operation_in_progress`,
    color: "error",
  },
  invalid_body: { i18nKey: `${STASH_PREFIX}.error.invalid_body`, color: "error" },
  invalid_message: {
    i18nKey: `${STASH_PREFIX}.error.invalid_message`,
    color: "error",
  },
  invalid_param: {
    i18nKey: `${STASH_PREFIX}.error.invalid_param`,
    color: "error",
  },
  git_error: {
    i18nKey: `${STASH_PREFIX}.error.git_error`,
    color: "error",
    withStderr: true,
  },
  network: { i18nKey: `${STASH_PREFIX}.error.network`, color: "error" },
  unknown: {
    i18nKey: `${STASH_PREFIX}.error.unknown`,
    color: "error",
    withReason: true,
  },
};
for (const r of PREFLIGHT_AS_GIT_ERROR) {
  STASH_REASON_CODES[r] = {
    i18nKey: `${STASH_PREFIX}.error.git_error`,
    color: "error",
    withStderr: true,
  };
}

/** Classify a git-stash failure reason for snackbar rendering. */
export function classifyStashReason(
  reason: string | null | undefined,
): GitOpReasonMeta {
  if (!reason) return STASH_REASON_CODES.unknown;
  return STASH_REASON_CODES[reason] ?? STASH_REASON_CODES.unknown;
}
