// Author: elecvoid243
// Date: 2026-08-13
// Pure parser for POST /spcode/code-check responses. No Vue / no axios —
// importable by node --test.
// Spec: spcode plugin docs/api/webapi-code-check-format-api.md §2, §4.

/** Reason codes the code-check endpoint can return (null = success). */
export const CODE_CHECK_REASON_CODES = [
  "invalid_body",
  "invalid_param",
  "feature_disabled",
  "no_project_loaded",
  "worktree_invalid",
  "directory_missing",
  "not_a_git_repo",
  "path_unsafe",
  "file_not_found",
  "unsupported_media_type",
  "tool_unavailable",
  "check_failed",
] as const;

export type CodeCheckReason =
  | (typeof CODE_CHECK_REASON_CODES)[number]
  | "network"
  | "unknown";

/** A single linter issue. Field names vary by linter (ruff / cpplint /
 *  cppcheck); unknown keys are preserved so the detail view can dump them. */
export interface CodeCheckIssue {
  line?: number;
  col?: number;
  code?: string;
  message?: string;
  severity?: string;
  context?: string[];
  [key: string]: unknown;
}

/** Parsed business payload (envelope already unwrapped). */
export interface CodeCheckSnapshot {
  success: boolean;
  checked: boolean;
  path: string;
  linter: string;
  issues: CodeCheckIssue[];
  count: number;
  /** Non-null in C/C++ merge mode: { cppcheck, cpplint } grouped results. */
  linters: Record<string, unknown> | null;
  /** True when the request ran `ruff check --fix` (auto-fix mode). */
  fixed: boolean;
  /** Number of issues auto-fixed (null when not in fix mode). */
  fixedCount: number | null;
  proposal: string | null;
  reason: string | null;
  stderr: string;
  elapsedMs: number;
}

export type CodeCheckParseResult =
  | { kind: "ok"; snapshot: CodeCheckSnapshot }
  | { kind: "error"; reason: string };

/** Parse the { status, data } envelope returned by POST /spcode/code-check. */
export function parseSpcodeCodeCheck(raw: unknown): CodeCheckParseResult {
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
  const d = env.data as Record<string, unknown>;
  return {
    kind: "ok",
    snapshot: {
      success: d.success !== false,
      checked: Boolean(d.checked),
      path: typeof d.path === "string" ? d.path : "",
      linter: typeof d.linter === "string" ? d.linter : "",
      issues: Array.isArray(d.issues) ? (d.issues as CodeCheckIssue[]) : [],
      count: typeof d.count === "number" ? d.count : 0,
      linters:
        d.linters && typeof d.linters === "object"
          ? (d.linters as Record<string, unknown>)
          : null,
      fixed: Boolean(d.fixed),
      fixedCount: typeof d.fixed_count === "number" ? d.fixed_count : null,
      proposal: typeof d.proposal === "string" ? d.proposal : null,
      reason: typeof d.reason === "string" ? d.reason : null,
      stderr: typeof d.stderr === "string" ? d.stderr : "",
      elapsedMs: typeof d.elapsed_ms === "number" ? d.elapsed_ms : 0,
    },
  };
}

/** Map a raw reason string to a known CodeCheckReason; "unknown" otherwise. */
export function classifyCodeCheckReason(
  raw: string | null | undefined,
): CodeCheckReason {
  if (raw === null || raw === undefined) return "unknown";
  if (raw === "network") return "network";
  if ((CODE_CHECK_REASON_CODES as readonly string[]).includes(raw)) {
    return raw as CodeCheckReason;
  }
  return "unknown";
}
