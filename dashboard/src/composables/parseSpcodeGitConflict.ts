// Author: elecvoid243 @ 2026-08-01
// Spec: docs/superpowers/specs/2026-08-01-git-merge-cherrypick-conflict-frontend-design.md §3.2
//
// Pure parsers for the conflict lifecycle endpoints (spcode plugin v2.22.0):
//   GET  /spcode/git-conflict-status
//   POST /spcode/git-conflict-resolve
//   POST /spcode/git-conflict-continue
//   POST /spcode/git-conflict-abort
// No Vue / no axios — unit-testable in isolation.

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
function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}
function asNumberOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function asBoolean(v: unknown): boolean {
  return v === true;
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// ── Types ────────────────────────────────────────────────

export type ConflictOperation = "merge" | "cherry_pick" | "revert";

export interface ConflictHunk {
  index: number;
  startLine: number;
  endLine: number;
  ours: string;
  theirs: string;
  base: string | null; // non-null only with diff3 markers
  oursLabel: string;
  theirsLabel: string;
}

export interface ConflictedFile {
  path: string;
  status: string; // e.g. "UU", "AA", "DU"
  hunks: ConflictHunk[]; // [] for binary/truncated/beyond-cap files
  threeWay: { base: string | null; ours: string | null; theirs: string | null };
  binary: boolean;
  truncated: boolean;
}

export interface ConflictSnapshot {
  inConflict: boolean;
  operation: ConflictOperation | null;
  operationRef: string | null;
  operationSubject: string | null;
  conflictedFiles: ConflictedFile[];
  resolvedFiles: string[];
  totalConflicted: number;
  totalResolved: number;
  allResolved: boolean;
  directory: string;
}

export interface RemainingConflict {
  path: string;
  status: string;
}

/** POST /spcode/git-conflict-resolve — four mutually exclusive modes. */
export type SpcodeResolveParams =
  | {
      mode: "hunks";
      file: string;
      hunks: { index: number; choice: "ours" | "theirs" | "base" }[];
      worktree?: string | null;
    }
  | { mode: "whole"; file: string; resolution: "ours" | "theirs"; worktree?: string | null }
  | { mode: "custom"; file: string; content: string; worktree?: string | null }
  | { mode: "all"; resolution: "ours" | "theirs"; worktree?: string | null };

export type SpcodeResolveResult =
  | {
      ok: true;
      resolved: boolean;
      partial: boolean;
      hunksResolved: number | null;
      hunksTotal: number | null;
      unresolvedHunks: { index: number; startLine: number; endLine: number }[];
      remainingConflicts: RemainingConflict[];
      allResolved: boolean;
    }
  | { ok: false; reason: string; stderr?: string };

export type SpcodeConflictActionResult =
  | {
      ok: true;
      operation: ConflictOperation | null;
      commitSha: string;
      commitMessage: string;
    }
  | {
      ok: false;
      reason: string;
      stderr?: string;
      remainingConflicts?: RemainingConflict[];
    };

// ── Field parsers ────────────────────────────────────────

function toOperation(v: unknown): ConflictOperation | null {
  return v === "merge" || v === "cherry_pick" || v === "revert" ? v : null;
}

function toHunks(v: unknown): ConflictHunk[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((h): h is Record<string, unknown> => typeof h === "object" && h !== null)
    .map((h) => ({
      index: asNumber(h.index),
      startLine: asNumber(h.start_line),
      endLine: asNumber(h.end_line),
      ours: asString(h.ours),
      theirs: asString(h.theirs),
      base: asStringOrNull(h.base),
      oursLabel: asString(h.ours_label),
      theirsLabel: asString(h.theirs_label),
    }));
}

function toConflictedFiles(v: unknown): ConflictedFile[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => {
      const tw = (
        typeof f.three_way === "object" && f.three_way !== null ? f.three_way : {}
      ) as Record<string, unknown>;
      return {
        path: asString(f.path),
        status: asString(f.status),
        hunks: toHunks(f.hunks),
        threeWay: {
          base: asStringOrNull(tw.base),
          ours: asStringOrNull(tw.ours),
          theirs: asStringOrNull(tw.theirs),
        },
        binary: asBoolean(f.binary),
        truncated: asBoolean(f.truncated),
      };
    });
}

function toRemainingConflicts(v: unknown): RemainingConflict[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({ path: asString(c.path), status: asString(c.status) }));
}

function toUnresolvedHunks(
  v: unknown,
): { index: number; startLine: number; endLine: number }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((h): h is Record<string, unknown> => typeof h === "object" && h !== null)
    .map((h) => ({
      index: asNumber(h.index),
      startLine: asNumber(h.start_line),
      endLine: asNumber(h.end_line),
    }));
}

// ── Endpoint parsers ─────────────────────────────────────

/** GET /spcode/git-conflict-status. Throws on malformed envelope. */
export function parseSpcodeConflictStatus(raw: unknown): ConflictSnapshot {
  const d = unwrapData(raw);
  return {
    inConflict: asBoolean(d.in_conflict),
    operation: toOperation(d.operation),
    operationRef: asStringOrNull(d.operation_ref),
    operationSubject: asStringOrNull(d.operation_subject),
    conflictedFiles: toConflictedFiles(d.conflicted_files),
    resolvedFiles: asStringArray(d.resolved_files),
    totalConflicted: asNumber(d.total_conflicted),
    totalResolved: asNumber(d.total_resolved),
    allResolved: asBoolean(d.all_resolved),
    directory: asString(d.directory),
  };
}

export function parseSpcodeConflictResolve(raw: unknown): SpcodeResolveResult {
  const d = unwrapData(raw);
  const reason = typeof d.reason === "string" ? d.reason : null;
  if (reason !== null) {
    return { ok: false, reason, stderr: asString(d.stderr) || undefined };
  }
  return {
    ok: true,
    resolved: asBoolean(d.resolved),
    partial: asBoolean(d.partial),
    hunksResolved: asNumberOrNull(d.hunks_resolved),
    hunksTotal: asNumberOrNull(d.hunks_total),
    unresolvedHunks: toUnresolvedHunks(d.unresolved_hunks),
    remainingConflicts: toRemainingConflicts(d.remaining_conflicts),
    allResolved: asBoolean(d.all_resolved),
  };
}

function parseAction(raw: unknown): SpcodeConflictActionResult {
  const d = unwrapData(raw);
  const reason = typeof d.reason === "string" ? d.reason : null;
  if (reason !== null) {
    return {
      ok: false,
      reason,
      stderr: asString(d.stderr) || undefined,
      remainingConflicts: toRemainingConflicts(d.remaining_conflicts),
    };
  }
  return {
    ok: true,
    operation: toOperation(d.operation),
    commitSha: asString(d.commit_sha),
    commitMessage: asString(d.commit_message),
  };
}

export const parseSpcodeConflictContinue = parseAction;
export const parseSpcodeConflictAbort = parseAction;

// ── Body builder ─────────────────────────────────────────

export function buildResolveBody(p: SpcodeResolveParams): Record<string, unknown> {
  switch (p.mode) {
    case "hunks":
      return { file: p.file, hunks: p.hunks };
    case "whole":
      return { file: p.file, resolution: p.resolution };
    case "custom":
      return { file: p.file, resolution: "custom", content: p.content };
    case "all":
      return { all: true, resolution: p.resolution };
  }
}

// ── Reason classification (spec §3.4) ────────────────────

export interface GitOpReasonMeta {
  i18nKey: string;
  color: "error" | "warning" | "info";
  withStderr?: boolean;
  withReason?: boolean;
}

const PREFIX = "spcodeProjectLoad.diffSidebar.conflict";

const CONFLICT_REASON_CODES: Record<string, GitOpReasonMeta> = {
  no_conflict_in_progress: {
    i18nKey: `${PREFIX}.error.no_conflict_in_progress`,
    color: "warning",
  },
  file_not_conflicted: {
    i18nKey: `${PREFIX}.error.file_not_conflicted`,
    color: "error",
  },
  unresolved_conflicts_remain: {
    i18nKey: `${PREFIX}.error.unresolved_conflicts_remain`,
    color: "warning",
  },
  path_unsafe: { i18nKey: `${PREFIX}.error.path_unsafe`, color: "error" },
  invalid_param: {
    i18nKey: `${PREFIX}.error.invalid_param`,
    color: "error",
    withStderr: true,
  },
  hook_rejected: {
    i18nKey: `${PREFIX}.error.hook_rejected`,
    color: "error",
    withStderr: true,
  },
  identity_not_set: {
    i18nKey: `${PREFIX}.error.identity_not_set`,
    color: "error",
  },
  git_error: {
    i18nKey: `${PREFIX}.error.git_error`,
    color: "error",
    withStderr: true,
  },
  network: { i18nKey: `${PREFIX}.error.network`, color: "error" },
  unknown: {
    i18nKey: `${PREFIX}.error.unknown`,
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
]) {
  CONFLICT_REASON_CODES[r] = {
    i18nKey: `${PREFIX}.error.git_error`,
    color: "error",
    withStderr: true,
  };
}

export function classifyConflictReason(
  reason: string | null | undefined,
): GitOpReasonMeta {
  if (!reason) return CONFLICT_REASON_CODES.unknown;
  return CONFLICT_REASON_CODES[reason] ?? CONFLICT_REASON_CODES.unknown;
}
