// Author: elecvoid243 @ 2026-07-21
// Spec: docs/superpowers/specs/2026-07-21-git-branch-switcher-frontend-design.md §3.1

/**
 * Parsed types for GET /spcode/git-branches.
 *
 * Backend envelope (SpcodeGitBranchesResponse):
 *   { status: "ok", data: { loaded, directory, umo, branches: [ { name,
 *   sha, upstream, upstream_track, current, remote } ], total, current,
 *   detached, reason, stderr, elapsed_ms } }
 */

export interface SpcodeGitBranchRaw {
  name: string;
  sha: string;
  upstream: string;
  upstream_track: string;
  current: boolean;
  remote: boolean;
}

export interface SpcodeGitBranchesRawResponse {
  loaded: boolean;
  directory: string | null;
  umo: string | null;
  branches: SpcodeGitBranchRaw[];
  total: number;
  current: string | null;
  detached: boolean;
  reason: string | null;
  stderr: string;
  elapsed_ms: number;
}

export interface SpcodeGitBranch {
  name: string;
  sha: string;
  upstream: string;
  upstreamTrack: string;
  current: boolean;
  remote: boolean;
}

export interface SpcodeGitBranchesSnapshot {
  meta: {
    directory: string | null;
    umo: string | null;
    loaded: boolean;
    reason: string | null;
    stderr: string;
    elapsedMs: number;
    fetchedAt: number;
  };
  branches: SpcodeGitBranch[];
  total: number;
  current: string | null;
  detached: boolean;
}

export function parseSpcodeGitBranches(
  data: SpcodeGitBranchesRawResponse,
): SpcodeGitBranchesSnapshot {
  return {
    meta: {
      directory: data.directory ?? null,
      umo: data.umo ?? null,
      loaded: Boolean(data.loaded),
      reason: data.reason ?? null,
      stderr: typeof data.stderr === "string" ? data.stderr : "",
      elapsedMs: typeof data.elapsed_ms === "number" ? data.elapsed_ms : 0,
      fetchedAt: Date.now(),
    },
    branches: Array.isArray(data.branches)
      ? data.branches.map((b) => ({
          name: String(b.name ?? ""),
          sha: String(b.sha ?? ""),
          upstream: String(b.upstream ?? ""),
          upstreamTrack: String(b.upstream_track ?? ""),
          current: Boolean(b.current),
          remote: Boolean(b.remote),
        }))
      : [],
    total: typeof data.total === "number" ? data.total : 0,
    current: data.current ?? null,
    detached: Boolean(data.detached),
  };
}
