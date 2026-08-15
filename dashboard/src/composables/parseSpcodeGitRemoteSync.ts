// Author: elecvoid243 @ 2026-08-12
// API doc: astrbot_plugin_spcode_toolkit docs/api/webapi-git-pull-push-remote-api.md
//
// Pure parsers for POST /spcode/git-pull, POST /spcode/git-push and
// POST /spcode/git-remote-set-url. No Vue / no axios — unit-testable
// in isolation. Mirrors parseSpcodeGitMerge.ts.
//
// All three endpoints share the envelope:
//   { status: "ok", data: { success, reason, stderr, elapsed_ms, ... } }
// Failure is signalled by data.success === false (reason !== null);
// HTTP stays 200.

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
function asBoolean(v: unknown): boolean {
  return v === true;
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

// Conflicted files arrive as [{ path, status }] (porcelain XY).
function asConflictedPaths(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) =>
      typeof x === "object" && x !== null
        ? (x as { path?: unknown }).path
        : undefined,
    )
    .filter((p): p is string => typeof p === "string");
}

// ── git-pull ─────────────────────────────────────────────

/** POST /spcode/git-pull parameters (UI side, camelCase). */
export interface SpcodePullParams {
  remote?: string;
  branch?: string;
  ffOnly?: boolean;
  rebase?: boolean;
  worktree?: string | null;
}

export type SpcodePullResult =
  | {
      ok: true;
      /** false → "already up to date" (not an error). */
      updated: boolean;
      mode: string; // "merge" | "ff_only" | "rebase"
      remote: string;
      branch: string;
      beforeSha: string;
      afterSha: string;
      fastForward: boolean;
      filesTouched: string[];
      upstream: string | null;
    }
  | {
      ok: false;
      reason: string;
      conflict: boolean;
      conflictedFiles: string[];
      stderr?: string;
    };

export function parseSpcodeGitPull(raw: unknown): SpcodePullResult {
  const d = unwrapData(raw);
  const reason = typeof d.reason === "string" ? d.reason : null;
  if (reason !== null || d.success === false) {
    const r = reason ?? "unknown";
    return {
      ok: false,
      reason: r,
      conflict: r === "merge_conflict" || r === "rebase_conflict",
      conflictedFiles: asConflictedPaths(d.conflicted_files),
      stderr: asString(d.stderr) || undefined,
    };
  }
  return {
    ok: true,
    updated: asBoolean(d.updated),
    mode: asString(d.mode, "merge"),
    remote: asString(d.remote),
    branch: asString(d.branch),
    beforeSha: asString(d.before_sha),
    afterSha: asString(d.after_sha),
    fastForward: asBoolean(d.fast_forward),
    filesTouched: asStringArray(d.files_touched),
    upstream: typeof d.upstream === "string" ? d.upstream : null,
  };
}

// ── git-push ─────────────────────────────────────────────

/** POST /spcode/git-push parameters (UI side, camelCase). */
export interface SpcodePushParams {
  remote?: string;
  branch?: string;
  /** Remote target branch; defaults to `branch` (same-name push). */
  remoteBranch?: string;
  worktree?: string | null;
}

export type SpcodePushResult =
  | {
      ok: true;
      /** false → remote already in sync (not an error). */
      pushed: boolean;
      setUpstream: boolean;
      remote: string;
      branch: string;
      remoteBranch: string;
      upstream: string | null;
    }
  | { ok: false; reason: string; stderr?: string };

export function parseSpcodeGitPush(raw: unknown): SpcodePushResult {
  const d = unwrapData(raw);
  const reason = typeof d.reason === "string" ? d.reason : null;
  if (reason !== null || d.success === false) {
    return {
      ok: false,
      reason: reason ?? "unknown",
      stderr: asString(d.stderr) || undefined,
    };
  }
  return {
    ok: true,
    pushed: asBoolean(d.pushed),
    setUpstream: asBoolean(d.set_upstream),
    remote: asString(d.remote),
    branch: asString(d.branch),
    remoteBranch: asString(d.remote_branch),
    upstream: typeof d.upstream === "string" ? d.upstream : null,
  };
}

// ── git-remote-set-url ───────────────────────────────────

/** POST /spcode/git-remote-set-url parameters (UI side, camelCase). */
export interface SpcodeRemoteSetUrlParams {
  url: string;
  remote?: string;
  worktree?: string | null;
}

export type SpcodeRemoteSetUrlResult =
  | {
      ok: true;
      action: string; // "added" | "updated" | "unchanged"
      remote: string;
      url: string;
      /** 2026-08-16: git remote 配置的远端名列表，供推送对话框即时刷新。 */
      remotes: string[];
    }
  | { ok: false; reason: string; stderr?: string };

export function parseSpcodeGitRemoteSetUrl(
  raw: unknown,
): SpcodeRemoteSetUrlResult {
  const d = unwrapData(raw);
  const reason = typeof d.reason === "string" ? d.reason : null;
  if (reason !== null || d.success === false) {
    return {
      ok: false,
      reason: reason ?? "unknown",
      stderr: asString(d.stderr) || undefined,
    };
  }
  return {
    ok: true,
    action: asString(d.action, "updated"),
    remote: asString(d.remote),
    url: asString(d.url),
    remotes: Array.isArray(d.remotes)
      ? d.remotes.map((r) => String(r)).filter((r) => r !== "")
      : [],
  };
}

// ── Body builders (camelCase params → snake_case wire) ───

export function buildPullBody(p: SpcodePullParams): Record<string, unknown> {
  return {
    ...(p.remote ? { remote: p.remote } : {}),
    ...(p.branch ? { branch: p.branch } : {}),
    ff_only: p.ffOnly ?? false,
    rebase: p.rebase ?? false,
  };
}

export function buildPushBody(p: SpcodePushParams): Record<string, unknown> {
  return {
    ...(p.remote ? { remote: p.remote } : {}),
    ...(p.branch ? { branch: p.branch } : {}),
    ...(p.remoteBranch ? { remote_branch: p.remoteBranch } : {}),
  };
}

export function buildRemoteSetUrlBody(
  p: SpcodeRemoteSetUrlParams,
): Record<string, unknown> {
  return {
    url: p.url,
    remote: p.remote ?? "origin",
  };
}

// ── git-remotes (list) ──────────────────────────────────

/** GET /spcode/git-remotes item: one configured remote (name + url). */
export interface SpcodeRemote {
  name: string;
  url: string;
}

export type SpcodeRemotesResult =
  | { ok: true; remotes: SpcodeRemote[] }
  | { ok: false; reason: string; stderr?: string };

export function parseSpcodeGitRemotes(raw: unknown): SpcodeRemotesResult {
  const d = unwrapData(raw);
  const reason = typeof d.reason === "string" ? d.reason : null;
  if (reason !== null || d.success === false) {
    return {
      ok: false,
      reason: reason ?? "unknown",
      stderr: asString(d.stderr) || undefined,
    };
  }
  const remotes = Array.isArray(d.remotes)
    ? d.remotes
        .filter((x): x is Record<string, unknown> =>
          typeof x === "object" && x !== null,
        )
        .map((x) => ({ name: asString(x.name), url: asString(x.url) }))
        .filter((r) => r.name !== "")
    : [];
  return { ok: true, remotes };
}

// ── git-remote-remove ───────────────────────────────────

export type SpcodeRemoteRemoveResult =
  | { ok: true; remote: string; remotes: string[] }
  | { ok: false; reason: string; stderr?: string };

export function parseSpcodeGitRemoteRemove(
  raw: unknown,
): SpcodeRemoteRemoveResult {
  const d = unwrapData(raw);
  const reason = typeof d.reason === "string" ? d.reason : null;
  if (reason !== null || d.success === false) {
    return {
      ok: false,
      reason: reason ?? "unknown",
      stderr: asString(d.stderr) || undefined,
    };
  }
  return {
    ok: true,
    remote: asString(d.remote),
    remotes: asStringArray(d.remotes),
  };
}

// ── Reason classification (API doc §6) ───────────────────

const PULL_PREFIX = "spcodeProjectLoad.diffSidebar.pull";
const PUSH_PREFIX = "spcodeProjectLoad.diffSidebar.push";
const REMOTE_PREFIX = "spcodeProjectLoad.diffSidebar.remote";

// Universal preflight/body reasons share the generic git_error surface
// (mirrors parseSpcodeGitMerge).
const PREFLIGHT_AS_GIT_ERROR = [
  "feature_disabled",
  "no_project_loaded",
  "worktree_invalid",
  "directory_missing",
  "not_a_git_repo",
  "git_unavailable",
  "invalid_body",
  "invalid_param",
];

const PULL_REASON_CODES: Record<string, GitOpReasonMeta> = {
  merge_conflict: {
    i18nKey: `${PULL_PREFIX}.conflictWarning`,
    color: "warning",
  },
  rebase_conflict: {
    i18nKey: `${PULL_PREFIX}.conflictWarning`,
    color: "warning",
  },
  worktree_dirty: {
    i18nKey: `${PULL_PREFIX}.error.worktree_dirty`,
    color: "error",
  },
  operation_in_progress: {
    i18nKey: `${PULL_PREFIX}.error.operation_in_progress`,
    color: "error",
  },
  no_upstream: { i18nKey: `${PULL_PREFIX}.error.no_upstream`, color: "error" },
  detached_head: {
    i18nKey: `${PULL_PREFIX}.error.detached_head`,
    color: "error",
  },
  remote_not_found: {
    i18nKey: `${PULL_PREFIX}.error.remote_not_found`,
    color: "error",
  },
  invalid_remote: {
    i18nKey: `${PULL_PREFIX}.error.invalid_remote`,
    color: "error",
  },
  invalid_branch: {
    i18nKey: `${PULL_PREFIX}.error.invalid_branch`,
    color: "error",
  },
  auth_required: {
    i18nKey: `${PULL_PREFIX}.error.auth_required`,
    color: "error",
  },
  network_error: {
    i18nKey: `${PULL_PREFIX}.error.network_error`,
    color: "error",
  },
  git_error: {
    i18nKey: `${PULL_PREFIX}.error.git_error`,
    color: "error",
    withStderr: true,
  },
  network: { i18nKey: `${PULL_PREFIX}.error.network`, color: "error" },
  unknown: {
    i18nKey: `${PULL_PREFIX}.error.unknown`,
    color: "error",
    withReason: true,
  },
};
for (const r of PREFLIGHT_AS_GIT_ERROR) {
  PULL_REASON_CODES[r] = {
    i18nKey: `${PULL_PREFIX}.error.git_error`,
    color: "error",
    withStderr: true,
  };
}

const PUSH_REASON_CODES: Record<string, GitOpReasonMeta> = {
  non_fast_forward: {
    i18nKey: `${PUSH_PREFIX}.error.non_fast_forward`,
    color: "warning",
  },
  push_rejected: {
    i18nKey: `${PUSH_PREFIX}.error.push_rejected`,
    color: "error",
    withStderr: true,
  },
  auth_required: {
    i18nKey: `${PUSH_PREFIX}.error.auth_required`,
    color: "error",
  },
  network_error: {
    i18nKey: `${PUSH_PREFIX}.error.network_error`,
    color: "error",
  },
  remote_not_found: {
    i18nKey: `${PUSH_PREFIX}.error.remote_not_found`,
    color: "error",
  },
  detached_head: {
    i18nKey: `${PUSH_PREFIX}.error.detached_head`,
    color: "error",
  },
  invalid_remote: {
    i18nKey: `${PUSH_PREFIX}.error.invalid_remote`,
    color: "error",
  },
  invalid_branch: {
    i18nKey: `${PUSH_PREFIX}.error.invalid_branch`,
    color: "error",
  },
  git_error: {
    i18nKey: `${PUSH_PREFIX}.error.git_error`,
    color: "error",
    withStderr: true,
  },
  network: { i18nKey: `${PUSH_PREFIX}.error.network`, color: "error" },
  unknown: {
    i18nKey: `${PUSH_PREFIX}.error.unknown`,
    color: "error",
    withReason: true,
  },
};
for (const r of PREFLIGHT_AS_GIT_ERROR) {
  PUSH_REASON_CODES[r] = {
    i18nKey: `${PUSH_PREFIX}.error.git_error`,
    color: "error",
    withStderr: true,
  };
}

const REMOTE_REASON_CODES: Record<string, GitOpReasonMeta> = {
  invalid_url: {
    i18nKey: `${REMOTE_PREFIX}.error.invalid_url`,
    color: "error",
  },
  invalid_remote: {
    i18nKey: `${REMOTE_PREFIX}.error.invalid_remote`,
    color: "error",
  },
  remote_not_found: {
    i18nKey: `${REMOTE_PREFIX}.error.remote_not_found`,
    color: "error",
  },
  git_error: {
    i18nKey: `${REMOTE_PREFIX}.error.git_error`,
    color: "error",
    withStderr: true,
  },
  network: { i18nKey: `${REMOTE_PREFIX}.error.network`, color: "error" },
  unknown: {
    i18nKey: `${REMOTE_PREFIX}.error.unknown`,
    color: "error",
    withReason: true,
  },
};
for (const r of PREFLIGHT_AS_GIT_ERROR) {
  REMOTE_REASON_CODES[r] = {
    i18nKey: `${REMOTE_PREFIX}.error.git_error`,
    color: "error",
    withStderr: true,
  };
}

export function classifyPullReason(
  reason: string | null | undefined,
): GitOpReasonMeta {
  if (!reason) return PULL_REASON_CODES.unknown;
  return PULL_REASON_CODES[reason] ?? PULL_REASON_CODES.unknown;
}

export function classifyPushReason(
  reason: string | null | undefined,
): GitOpReasonMeta {
  if (!reason) return PUSH_REASON_CODES.unknown;
  return PUSH_REASON_CODES[reason] ?? PUSH_REASON_CODES.unknown;
}

export function classifyRemoteReason(
  reason: string | null | undefined,
): GitOpReasonMeta {
  if (!reason) return REMOTE_REASON_CODES.unknown;
  return REMOTE_REASON_CODES[reason] ?? REMOTE_REASON_CODES.unknown;
}
