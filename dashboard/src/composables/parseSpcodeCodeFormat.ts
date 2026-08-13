// Author: elecvoid243
// Date: 2026-08-13
// Pure parser for POST /spcode/code-format responses. No Vue / no axios —
// importable by node --test.
// Spec: spcode plugin docs/api/webapi-code-check-format-api.md §3, §4.

/** Reason codes the code-format endpoint can return (null = success). */
export const CODE_FORMAT_REASON_CODES = [
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
  "file_too_large",
  "tool_unavailable",
  "format_failed",
] as const;

export type CodeFormatReason =
  | (typeof CODE_FORMAT_REASON_CODES)[number]
  | "network"
  | "unknown";

/** Parsed business payload (envelope already unwrapped). */
export interface CodeFormatSnapshot {
  success: boolean;
  formatted: boolean;
  path: string;
  formatter: string;
  /** true = dry-run (diff_summary only), false = written back. */
  check: boolean;
  changed: boolean;
  fileSizeBefore: number | null;
  fileSizeAfter: number | null;
  diffSummary: string | null;
  proposal: string | null;
  reason: string | null;
  stderr: string;
  elapsedMs: number;
}

export type CodeFormatParseResult =
  | { kind: "ok"; snapshot: CodeFormatSnapshot }
  | { kind: "error"; reason: string };

/** Parse the { status, data } envelope returned by POST /spcode/code-format. */
export function parseSpcodeCodeFormat(raw: unknown): CodeFormatParseResult {
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
      formatted: Boolean(d.formatted),
      path: typeof d.path === "string" ? d.path : "",
      formatter: typeof d.formatter === "string" ? d.formatter : "",
      check: Boolean(d.check),
      changed: Boolean(d.changed),
      fileSizeBefore:
        typeof d.file_size_before === "number" ? d.file_size_before : null,
      fileSizeAfter:
        typeof d.file_size_after === "number" ? d.file_size_after : null,
      diffSummary:
        typeof d.diff_summary === "string" ? d.diff_summary : null,
      proposal: typeof d.proposal === "string" ? d.proposal : null,
      reason: typeof d.reason === "string" ? d.reason : null,
      stderr: typeof d.stderr === "string" ? d.stderr : "",
      elapsedMs: typeof d.elapsed_ms === "number" ? d.elapsed_ms : 0,
    },
  };
}

/** Map a raw reason string to a known CodeFormatReason; "unknown" otherwise. */
export function classifyCodeFormatReason(
  raw: string | null | undefined,
): CodeFormatReason {
  if (raw === null || raw === undefined) return "unknown";
  if (raw === "network") return "network";
  if ((CODE_FORMAT_REASON_CODES as readonly string[]).includes(raw)) {
    return raw as CodeFormatReason;
  }
  return "unknown";
}
