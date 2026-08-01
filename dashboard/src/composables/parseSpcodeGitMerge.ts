// Author: elecvoid243 @ 2026-08-01
// Spec: docs/superpowers/specs/2026-08-01-git-merge-cherrypick-conflict-frontend-design.md §3.1
//
// Pure parsers for POST /spcode/git-merge and POST /spcode/git-cherry-pick
// (spcode plugin v2.22.0). No Vue / no axios — unit-testable in isolation.
//
// Both endpoints share the envelope:
//   { status: "ok", data: { ...fields, reason: string | null, stderr, elapsed_ms } }
// Failure is signalled by reason !== null (HTTP stays 200).

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
function asBoolean(v: unknown): boolean {
  return v === true;
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// ── Types ────────────────────────────────────────────────

/** POST /spcode/git-merge parameters (UI side, camelCase). */
export interface SpcodeMergeParams {
  source: string;
  noFf?: boolean;
  ffOnly?: boolean;
  squash?: boolean;
  message?: string;
  worktree?: string | null;
}

export type SpcodeMergeResult =
  | {
      ok: true;
      merged: boolean; // false when squash (staged, not committed)
      mergeSha: string; // "" for squash
      mergeMessage: string;
      fastForward: boolean;
      squash: boolean;
      filesTouched: string[];
    }
  | {
      ok: false;
      reason: string;
      conflict: boolean;
      conflictedFiles: string[];
      stderr?: string;
    };

/** POST /spcode/git-cherry-pick parameters (UI side, camelCase). */
export interface SpcodeCherryPickParams {
  ref: string;
  mainline?: number | null;
  worktree?: string | null;
}

export type SpcodeCherryPickResult =
  | { ok: true; newSha: string; originalMessage: string; filesTouched: string[] }
  | {
      ok: false;
      reason: string;
      conflict: boolean;
      conflictedFiles: string[];
      stderr?: string;
    };

// ── Parsers ──────────────────────────────────────────────

export function parseSpcodeGitMerge(raw: unknown): SpcodeMergeResult {
  const d = unwrapData(raw);
  const reason = typeof d.reason === "string" ? d.reason : null;
  if (reason !== null) {
    return {
      ok: false,
      reason,
      conflict: asBoolean(d.conflict),
      conflictedFiles: asStringArray(d.conflicted_files),
      stderr: asString(d.stderr) || undefined,
    };
  }
  return {
    ok: true,
    merged: asBoolean(d.merged),
    mergeSha: asString(d.merge_sha),
    mergeMessage: asString(d.merge_message),
    fastForward: asBoolean(d.fast_forward),
    squash: asBoolean(d.squash),
    filesTouched: asStringArray(d.files_touched),
  };
}

export function parseSpcodeCherryPick(raw: unknown): SpcodeCherryPickResult {
  const d = unwrapData(raw);
  const reason = typeof d.reason === "string" ? d.reason : null;
  if (reason !== null) {
    return {
      ok: false,
      reason,
      conflict: asBoolean(d.conflict),
      conflictedFiles: asStringArray(d.conflicted_files),
      stderr: asString(d.stderr) || undefined,
    };
  }
  return {
    ok: true,
    newSha: asString(d.new_sha),
    originalMessage: asString(d.original_message),
    filesTouched: asStringArray(d.files_touched),
  };
}

// ── Body builders (camelCase params → snake_case wire) ───

export function buildMergeBody(p: SpcodeMergeParams): Record<string, unknown> {
  return {
    source: p.source,
    no_ff: p.noFf ?? false,
    ff_only: p.ffOnly ?? false,
    squash: p.squash ?? false,
    ...(p.message ? { message: p.message } : {}),
  };
}

export function buildCherryPickBody(
  p: SpcodeCherryPickParams,
): Record<string, unknown> {
  return {
    ref: p.ref,
    ...(typeof p.mainline === "number" ? { mainline: p.mainline } : {}),
  };
}

// ── Reason classification (spec §3.4) ────────────────────

export interface GitOpReasonMeta {
  i18nKey: string;
  color: "error" | "warning" | "info";
  withStderr?: boolean;
  withReason?: boolean;
}

const MERGE_PREFIX = "spcodeProjectLoad.diffSidebar.merge";
const CP_PREFIX = "spcodeProjectLoad.diffSidebar.cherryPick";

const MERGE_REASON_CODES: Record<string, GitOpReasonMeta> = {
  merge_conflict: { i18nKey: `${MERGE_PREFIX}.conflictWarning`, color: "warning" },
  merge_already_up_to_date: {
    i18nKey: `${MERGE_PREFIX}.alreadyUpToDate`,
    color: "info",
  },
  worktree_dirty: {
    i18nKey: `${MERGE_PREFIX}.error.worktree_dirty`,
    color: "error",
  },
  operation_in_progress: {
    i18nKey: `${MERGE_PREFIX}.error.operation_in_progress`,
    color: "error",
  },
  invalid_branch: {
    i18nKey: `${MERGE_PREFIX}.error.invalid_branch`,
    color: "error",
  },
  unrelated_histories: {
    i18nKey: `${MERGE_PREFIX}.error.unrelated_histories`,
    color: "error",
  },
  git_error: {
    i18nKey: `${MERGE_PREFIX}.error.git_error`,
    color: "error",
    withStderr: true,
  },
  network: { i18nKey: `${MERGE_PREFIX}.error.network`, color: "error" },
  unknown: {
    i18nKey: `${MERGE_PREFIX}.error.unknown`,
    color: "error",
    withReason: true,
  },
};

// Universal preflight/body reasons share the generic git_error surface.
for (const r of [
  "feature_disabled",
  "no_project_loaded",
  "worktree_invalid",
  "directory_missing",
  "not_a_git_repo",
  "git_unavailable",
  "invalid_body",
  "invalid_param",
]) {
  MERGE_REASON_CODES[r] = {
    i18nKey: `${MERGE_PREFIX}.error.git_error`,
    color: "error",
    withStderr: true,
  };
}

const CP_REASON_CODES: Record<string, GitOpReasonMeta> = {
  cherry_pick_conflict: {
    i18nKey: `${CP_PREFIX}.conflictWarning`,
    color: "warning",
  },
  cherry_pick_empty: { i18nKey: `${CP_PREFIX}.emptyInfo`, color: "info" },
  commit_not_found: {
    i18nKey: `${CP_PREFIX}.error.commit_not_found`,
    color: "error",
  },
  worktree_dirty: {
    i18nKey: `${CP_PREFIX}.error.worktree_dirty`,
    color: "error",
  },
  operation_in_progress: {
    i18nKey: `${CP_PREFIX}.error.operation_in_progress`,
    color: "error",
  },
  git_error: {
    i18nKey: `${CP_PREFIX}.error.git_error`,
    color: "error",
    withStderr: true,
  },
  network: { i18nKey: `${CP_PREFIX}.error.network`, color: "error" },
  unknown: {
    i18nKey: `${CP_PREFIX}.error.unknown`,
    color: "error",
    withReason: true,
  },
};

for (const r of [
  "feature_disabled",
  "no_project_loaded",
  "worktree_invalid",
  "directory_missing",
  "not_a_git_repo",
  "git_unavailable",
  "invalid_body",
  "invalid_param",
]) {
  CP_REASON_CODES[r] = {
    i18nKey: `${CP_PREFIX}.error.git_error`,
    color: "error",
    withStderr: true,
  };
}

export function classifyMergeReason(
  reason: string | null | undefined,
): GitOpReasonMeta {
  if (!reason) return MERGE_REASON_CODES.unknown;
  return MERGE_REASON_CODES[reason] ?? MERGE_REASON_CODES.unknown;
}

export function classifyCherryPickReason(
  reason: string | null | undefined,
): GitOpReasonMeta {
  if (!reason) return CP_REASON_CODES.unknown;
  return CP_REASON_CODES[reason] ?? CP_REASON_CODES.unknown;
}
