// Author: elecvoid243 @ 2026-07-21
// Spec: docs/superpowers/specs/2026-07-21-git-branch-switcher-frontend-design.md §3.2
//
// Pure parsers for the 3 git branch mutation endpoints
// (git-branch-switch / git-branch-create / git-branch-delete).
// No Vue / no axios. Mirrors parseSpcodeWorktreeManagement.ts split.
//
// All 3 endpoints return the SAME envelope shape:
//   { status: "ok", data: { loaded, directory, umo, [endpoint fields],
//                            branches: [...refreshed list...],
//                            reason, stderr, elapsed_ms } }
// The `branches` field is the refreshed complete list; the consumer
// (useSpcodeGitBranches) uses it to atomically replace its state.

import {
  parseSpcodeGitBranches,
  type SpcodeGitBranchRaw,
  type SpcodeGitBranchesRawResponse,
  type SpcodeGitBranchesSnapshot,
} from "./parseSpcodeGitBranches";

export type BranchMgmtEndpoint = "switch" | "create" | "delete";

export interface SpcodeBranchMgmtRawData {
  loaded: boolean;
  directory: string | null;
  umo: string | null;
  // Endpoint-specific (always present per endpoint)
  switched?: boolean;
  created?: boolean;
  deleted?: boolean;
  name?: string;
  previous?: string | null;
  start_point?: string;
  sha?: string;
  force?: boolean;
  detach?: boolean;
  was_current?: boolean;
  // Refreshed list (used to atomically replace composable state)
  branches: SpcodeGitBranchRaw[] | null;
  total: number;
  current: string | null;
  detached: boolean;
  reason: string | null;
  stderr: string;
  elapsed_ms: number;
}

export interface SpcodeBranchMgmtRawResponse {
  loaded?: boolean;
  directory?: string | null;
  umo?: string | null;
  switched?: boolean;
  created?: boolean;
  deleted?: boolean;
  name?: string;
  previous?: string | null;
  start_point?: string;
  sha?: string;
  force?: boolean;
  detach?: boolean;
  was_current?: boolean;
  branches?: SpcodeGitBranchRaw[] | null;
  total?: number;
  current?: string | null;
  detached?: boolean;
  reason?: string | null;
  stderr?: string;
  elapsed_ms?: number;
}

export interface SpcodeBranchMgmtSnapshot {
  meta: {
    directory: string | null;
    umo: string | null;
    loaded: boolean;
    reason: string | null;
    stderr: string;
    elapsedMs: number;
    fetchedAt: number;
  };
  // Endpoint-specific success flags
  switched: boolean;
  created: boolean;
  deleted: boolean;
  name: string;
  previous: string | null;
  startPoint: string;
  sha: string;
  force: boolean;
  detach: boolean;
  wasCurrent: boolean;
  // Refreshed full branch list
  branches: SpcodeGitBranchesSnapshot;
}

export type ParseResult<T> =
  | { kind: "ok"; snapshot: T }
  | { kind: "error"; reason: string; stderr: string };

// ── Envelope helpers ─────────────────────────────────────

function unwrapEnvelope(raw: unknown): unknown {
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
  return env.data;
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
function asBoolean(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function buildSnapshot(d: SpcodeBranchMgmtRawData): SpcodeBranchMgmtSnapshot {
  // Re-parse the refreshed branches array using the GET parser for
  // consistency. The double-parse keeps both parsers pure and
  // avoids drifting field mappings.
  const rawListResponse: SpcodeGitBranchesRawResponse = {
    loaded: d.loaded,
    directory: d.directory,
    umo: d.umo,
    branches: Array.isArray(d.branches) ? d.branches : [],
    total: d.total,
    current: d.current,
    detached: d.detached,
    reason: d.reason,
    stderr: d.stderr,
    elapsed_ms: d.elapsed_ms,
  };
  return {
    meta: {
      directory: d.directory ?? null,
      umo: d.umo ?? null,
      loaded: Boolean(d.loaded),
      reason: d.reason ?? null,
      stderr: asString(d.stderr),
      elapsedMs: asNumber(d.elapsed_ms),
      fetchedAt: Date.now(),
    },
    switched: asBoolean(d.switched),
    created: asBoolean(d.created),
    deleted: asBoolean(d.deleted),
    name: asString(d.name),
    previous: d.previous !== undefined ? asStringOrNull(d.previous) : null,
    startPoint: asString(d.start_point, "HEAD"),
    sha: asString(d.sha),
    force: asBoolean(d.force),
    detach: asBoolean(d.detach),
    wasCurrent: asBoolean(d.was_current),
    branches: parseSpcodeGitBranches(rawListResponse),
  };
}

// ── Endpoint-specific parsers ─────────────────────────────

export function parseSpcodeBranchSwitch(
  raw: unknown,
): ParseResult<SpcodeBranchMgmtSnapshot> {
  const d = unwrapEnvelope(raw) as SpcodeBranchMgmtRawData;
  if (d.reason) {
    return { kind: "error", reason: d.reason, stderr: asString(d.stderr) };
  }
  return { kind: "ok", snapshot: buildSnapshot(d) };
}

export function parseSpcodeBranchCreate(
  raw: unknown,
): ParseResult<SpcodeBranchMgmtSnapshot> {
  const d = unwrapEnvelope(raw) as SpcodeBranchMgmtRawData;
  if (d.reason) {
    return { kind: "error", reason: d.reason, stderr: asString(d.stderr) };
  }
  return { kind: "ok", snapshot: buildSnapshot(d) };
}

export function parseSpcodeBranchDelete(
  raw: unknown,
): ParseResult<SpcodeBranchMgmtSnapshot> {
  const d = unwrapEnvelope(raw) as SpcodeBranchMgmtRawData;
  if (d.reason) {
    return { kind: "error", reason: d.reason, stderr: asString(d.stderr) };
  }
  return { kind: "ok", snapshot: buildSnapshot(d) };
}

// ── Reason classification (spec §3.7) ──────────────────

export interface BranchReasonMeta {
  i18nKey: string;
  color: "error" | "warning";
  withStderr?: boolean;
  withReason?: boolean;
}

const PREFIX = "spcodeProjectLoad.diffSidebar.branchMgmt";

export const BRANCH_MGMT_REASON_CODES: Record<string, BranchReasonMeta> = {
  // Pre-existing universal reasons
  feature_disabled: {
    i18nKey: `${PREFIX}.switch.error.git_error`,
    color: "error",
  },
  no_project_loaded: {
    i18nKey: `${PREFIX}.switch.error.git_error`,
    color: "error",
  },
  directory_missing: {
    i18nKey: `${PREFIX}.switch.error.git_error`,
    color: "error",
  },
  not_a_git_repo: {
    i18nKey: `${PREFIX}.switch.error.git_error`,
    color: "error",
  },
  git_unavailable: {
    i18nKey: `${PREFIX}.switch.error.git_error`,
    color: "error",
  },
  // Body / param
  invalid_body: {
    i18nKey: `${PREFIX}.switch.error.git_error`,
    color: "error",
  },
  invalid_param: {
    i18nKey: `${PREFIX}.switch.error.git_error`,
    color: "error",
  },
  invalid_branch: {
    i18nKey: `${PREFIX}.switch.error.invalid_branch`,
    color: "error",
  },
  // Branch-specific
  branch_exists: {
    i18nKey: `${PREFIX}.create.error.branch_exists`,
    color: "warning",
  },
  branch_not_found: {
    i18nKey: `${PREFIX}.switch.error.branch_not_found`,
    color: "warning",
  },
  branch_is_current: {
    i18nKey: `${PREFIX}.delete.error.branch_is_current`,
    color: "error",
  },
  branch_not_merged: {
    i18nKey: `${PREFIX}.delete.error.branch_not_merged`,
    color: "warning",
  },
  worktree_dirty: {
    i18nKey: `${PREFIX}.switch.error.worktree_dirty`,
    color: "warning",
  },
  // Git-level
  git_error: {
    i18nKey: `${PREFIX}.switch.error.git_error`,
    color: "error",
    withStderr: true,
  },
  // Network / unknown
  network: {
    i18nKey: `${PREFIX}.switch.error.git_error`,
    color: "error",
  },
  unknown: {
    i18nKey: `${PREFIX}.switch.error.git_error`,
    color: "error",
    withReason: true,
  },
};

const ALLOWED_BY_ENDPOINT: Record<BranchMgmtEndpoint, readonly string[]> = {
  switch: [
    "feature_disabled",
    "no_project_loaded",
    "directory_missing",
    "not_a_git_repo",
    "git_unavailable",
    "git_error",
    "invalid_body",
    "invalid_param",
    "invalid_branch",
    "worktree_dirty",
    "branch_not_found",
  ],
  create: [
    "feature_disabled",
    "no_project_loaded",
    "directory_missing",
    "not_a_git_repo",
    "git_unavailable",
    "git_error",
    "invalid_body",
    "invalid_param",
    "invalid_branch",
    "branch_exists",
  ],
  delete: [
    "feature_disabled",
    "no_project_loaded",
    "directory_missing",
    "not_a_git_repo",
    "git_unavailable",
    "git_error",
    "invalid_body",
    "invalid_param",
    "invalid_branch",
    "branch_not_found",
    "branch_is_current",
    "branch_not_merged",
  ],
};

export function classifyBranchReason(
  reason: string | null | undefined,
  endpoint: BranchMgmtEndpoint,
): BranchReasonMeta {
  if (reason === null || reason === undefined) {
    return BRANCH_MGMT_REASON_CODES.unknown;
  }
  if (reason === "network") {
    return BRANCH_MGMT_REASON_CODES.network;
  }
  if (!(ALLOWED_BY_ENDPOINT[endpoint] as readonly string[]).includes(reason)) {
    return BRANCH_MGMT_REASON_CODES.unknown;
  }
  return BRANCH_MGMT_REASON_CODES[reason] ?? BRANCH_MGMT_REASON_CODES.unknown;
}
