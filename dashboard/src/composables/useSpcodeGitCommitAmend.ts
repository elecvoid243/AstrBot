// Author: elecvoid243 @ 2026-08-13
// Spec: astrbot_plugin_spcode_toolkit
//   docs/superpowers/specs/2026-08-13-git-commit-amend-frontend-design.md
//
// Vue composable wrapping POST /spcode/git-commit-amend. Mirrors
// useSpcodeGitCommit: a single in-flight call (the user edits and
// confirms one commit message at a time), one boolean state surface,
// abort-on-reentry, dispose on unmount.

import { ref } from "vue";
import { pluginExtensionApi } from "@/api/v1";
import {
  parseSpcodeGitCommitAmend,
  type SpcodeAmendSnapshot,
} from "./parseSpcodeGitWorkflow";

export interface UseSpcodeGitCommitAmend {
  isAmending: import("vue").Ref<boolean>;
  amend: (params: AmendParams) => Promise<AmendResult>;
  dispose: () => void;
}

export interface AmendParams {
  message: string;
  worktree?: string | null;
  umo?: string | null;
}

export type AmendResult =
  | { ok: true; snapshot: SpcodeAmendSnapshot }
  | { ok: false; reason: string; stderr?: string };

export function useSpcodeGitCommitAmend(): UseSpcodeGitCommitAmend {
  const isAmending = ref(false);
  let abortController: AbortController | null = null;
  let isMounted = true;

  async function amend(params: AmendParams): Promise<AmendResult> {
    if (!isMounted) return { ok: false, reason: "aborted" };
    abortController?.abort();
    abortController = new AbortController();
    isAmending.value = true;
    try {
      const resp = await pluginExtensionApi.post<unknown>(
        "spcode/git-commit-amend",
        {
          message: params.message,
          ...(params.worktree ? { worktree: params.worktree } : {}),
          ...(params.umo ? { umo: params.umo } : {}),
        },
        { signal: abortController.signal },
      );
      if (!isMounted) return { ok: false, reason: "aborted" };
      const parsed = parseSpcodeGitCommitAmend(resp.data);
      if (parsed.kind !== "ok") {
        return { ok: false, reason: "unknown" };
      }
      const snapshot = parsed.snapshot;
      if (snapshot.success) {
        return { ok: true, snapshot };
      }
      return {
        ok: false,
        reason: snapshot.reason ?? "unknown",
        stderr: snapshot.stderr || undefined,
      };
    } catch (err) {
      if (!isMounted) return { ok: false, reason: "aborted" };
      if ((err as { name?: string })?.name === "CanceledError") {
        return { ok: false, reason: "aborted" };
      }
      const anyErr = err as { code?: string; message?: string };
      if (
        anyErr.code === "ERR_NETWORK" ||
        /network/i.test(anyErr.message ?? "")
      ) {
        return { ok: false, reason: "network" };
      }
      return { ok: false, reason: "unknown" };
    } finally {
      if (isMounted) isAmending.value = false;
    }
  }

  function dispose(): void {
    isMounted = false;
    abortController?.abort();
    abortController = null;
  }

  return { isAmending, amend, dispose };
}
