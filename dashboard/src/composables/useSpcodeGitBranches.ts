// Author: elecvoid243 @ 2026-07-21
// Spec: docs/superpowers/specs/2026-07-21-git-branch-switcher-frontend-design.md §3.2
//
// Composable for the git branch list. Mirrors useSpcodeWorktrees 1:1
// for the read path (state / refresh / polling / dispose). Mutation
// methods (switch / create / delete) are added in Task 4.

import { ref, watch, type Ref } from "vue";
import { pluginExtensionApi } from "@/api/v1";
import { useSpcodeProjectStatus } from "@/composables/useSpcodeProjectStatus";
import {
  parseSpcodeGitBranches,
  type SpcodeGitBranchesSnapshot,
  type SpcodeGitBranchesRawResponse,
} from "@/composables/parseSpcodeGitBranches";

export type BranchesFetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ok";
      snapshot: SpcodeGitBranchesSnapshot;
      notModified?: boolean;
    }
  | {
      kind: "error";
      reason: string;
      previousSnapshot?: SpcodeGitBranchesSnapshot;
    };

// Placeholder types — full implementations in Task 4.
export interface BranchSwitchParams {
  name: string;
  force?: boolean;
  detach?: boolean;
  umo?: string | null;
}
export interface BranchCreateParams {
  name: string;
  startPoint?: string;
  umo?: string | null;
}
export interface BranchDeleteParams {
  name: string;
  force?: boolean;
  umo?: string | null;
}
export type BranchMgmtResult =
  | { ok: true; snapshot: SpcodeGitBranchesSnapshot }
  | { ok: false; reason: string; stderr?: string };

export interface UseSpcodeGitBranches {
  state: Ref<BranchesFetchState>;
  refresh: () => Promise<void>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;
  switch: (params: BranchSwitchParams) => Promise<BranchMgmtResult>;
  create: (params: BranchCreateParams) => Promise<BranchMgmtResult>;
  delete: (params: BranchDeleteParams) => Promise<BranchMgmtResult>;
  dispose: () => void;
}

// Single source of truth for the polling cadence — imported from
// the worktree composable rather than re-declared. Both composables
// start/stop in lockstep in GitDiffSidebar.vue.
const DEFAULT_POLL_MS = 30_000;

export function useSpcodeGitBranches(): UseSpcodeGitBranches {
  const state = ref<BranchesFetchState>({ kind: "idle" });
  const spcodeStatus = useSpcodeProjectStatus();
  let abortController: AbortController | null = null;
  let mutationAbort: AbortController | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let isMounted = true;
  const etagMap = new Map<string, string>();
  const prevSnapshotMap = new Map<string, SpcodeGitBranchesSnapshot>();

  function etagKey(d: {
    umo: string | null;
    directory: string | null;
  }): string {
    return `branches|${d.umo ?? "null"}|${d.directory ?? "null"}`;
  }

  async function refresh(): Promise<void> {
    if (!isMounted) return;
    const umo = spcodeStatus.status.value.umo ?? null;
    const directory = spcodeStatus.status.value.directory ?? null;
    if (!umo) {
      state.value = {
        kind: "error",
        reason: "no_project_loaded",
        previousSnapshot: undefined,
      };
      return;
    }
    abortController?.abort();
    abortController = new AbortController();
    const isFirst = state.value.kind !== "ok";
    if (isFirst) state.value = { kind: "loading" };
    const key = etagKey({ umo, directory });
    const etag = etagMap.get(key);
    try {
      const resp = await pluginExtensionApi.get<unknown>(
        "spcode/git-branches",
        {
          params: { umo },
          headers: etag ? { "If-None-Match": etag } : {},
          validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
          signal: abortController.signal,
        },
      );
      if (!isMounted) return;
      if (resp.status === 304) {
        const cached = prevSnapshotMap.get(key);
        if (cached) {
          state.value = { kind: "ok", snapshot: cached, notModified: true };
        }
        return;
      }
      const envelope = resp.data as { data?: SpcodeGitBranchesRawResponse };
      const data = envelope?.data;
      if (!data) throw new Error("empty response data");
      const snap = parseSpcodeGitBranches(data);
      prevSnapshotMap.set(key, snap);
      const newEtag = (resp.headers as Record<string, string> | undefined)?.[
        "etag"
      ] ?? (resp.headers as Record<string, string> | undefined)?.["ETag"];
      if (newEtag) etagMap.set(key, newEtag);
      state.value = { kind: "ok", snapshot: snap, notModified: false };
    } catch (err) {
      if (!isMounted) return;
      if ((err as { name?: string })?.name === "CanceledError") return;
      const anyErr = err as { code?: string; message?: string };
      const reason =
        anyErr.code === "ERR_NETWORK" || /network/i.test(anyErr.message ?? "")
          ? "network"
          : "unknown";
      const prev =
        state.value.kind === "ok" ? state.value.snapshot : undefined;
      state.value = { kind: "error", reason, previousSnapshot: prev };
    }
  }

  watch(
    () => spcodeStatus.status.value.umo,
    (newUmo, oldUmo) => {
      if (!isMounted) return;
      if (newUmo && newUmo !== oldUmo) void refresh();
    },
  );

  function startPolling(intervalMs: number = DEFAULT_POLL_MS): void {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void refresh();
    }, intervalMs);
  }
  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // Stub mutation methods (real implementations in Task 4).
  async function _branchStub(): Promise<BranchMgmtResult> {
    return { ok: false, reason: "not_implemented" };
  }

  function dispose(): void {
    isMounted = false;
    stopPolling();
    abortController?.abort();
    abortController = null;
    mutationAbort?.abort();
    mutationAbort = null;
  }

  return {
    state,
    refresh,
    startPolling,
    stopPolling,
    switch: _branchStub as never,
    create: _branchStub as never,
    delete: _branchStub as never,
    dispose,
  };
}
