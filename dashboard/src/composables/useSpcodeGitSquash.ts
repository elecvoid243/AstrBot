// Author: elecvoid243
// Date: 2026-08-03
// Spec: docs/superpowers/specs/2026-08-03-git-squash-design.md §4.1
//
// Vue composable wrapping POST /spcode/git-squash. Lifecycle mirrors
// useSpcodeGitRevert.ts: a single in-flight call (the user confirms
// one squash at a time from the History view), one boolean state
// surface, abort-on-reentry, dispose on unmount. The envelope is
// shallow, so parsing stays inline (same precedent as revert — no
// dedicated parser file).
//
// The endpoint runs `git reset --soft <oldest>^` + `git commit -F -`:
// it REWRITES history (the selected commits disappear), is
// non-idempotent, and requires a clean worktree server-side.

import { ref } from "vue";
import { pluginExtensionApi } from "@/api/v1";

export interface UseSpcodeGitSquash {
  isSquashing: import("vue").Ref<boolean>;
  squash: (params: SquashParams) => Promise<SquashResult>;
  dispose: () => void;
}

export interface SquashParams {
  /** Full SHAs of the selected commits (any order; the backend
   *  authoritatively validates HEAD-anchored contiguity). */
  shas: string[];
  /** Final commit message (already trimmed by the dialog). */
  message: string;
  worktree?: string | null;
  umo?: string | null;
}

export interface SquashSnapshot {
  /** Full SHA of the newly created squashed commit ("" if re-read failed). */
  newSha: string;
  /** Subject line of the new commit. */
  message: string;
  /** How many commits were squashed. */
  squashedCount: number;
  /** HEAD before the rewrite (for diagnostics). */
  oldHeadSha: string;
  /** Repo-relative files touched by the new commit. */
  filesTouched: string[];
}

export type SquashResult =
  | { ok: true; snapshot: SquashSnapshot }
  | { ok: false; reason: string; stderr?: string };

export function useSpcodeGitSquash(): UseSpcodeGitSquash {
  const isSquashing = ref(false);
  let abortController: AbortController | null = null;
  let isMounted = true;

  async function squash(params: SquashParams): Promise<SquashResult> {
    if (!isMounted) return { ok: false, reason: "aborted" };
    abortController?.abort();
    abortController = new AbortController();
    isSquashing.value = true;
    try {
      const resp = await pluginExtensionApi.post<unknown>(
        "spcode/git-squash",
        {
          commits: params.shas,
          message: params.message,
          ...(params.worktree ? { worktree: params.worktree } : {}),
          ...(params.umo ? { umo: params.umo } : {}),
        },
        { signal: abortController.signal },
      );
      if (!isMounted) return { ok: false, reason: "aborted" };
      const data = (
        resp.data as {
          data?: {
            squashed?: boolean;
            reason?: string | null;
            stderr?: string;
            new_sha?: string;
            message?: string;
            squashed_count?: number;
            old_head_sha?: string;
            files_touched?: unknown;
          };
        }
      )?.data;
      if (data && data.reason == null && data.squashed === true) {
        return {
          ok: true,
          snapshot: {
            newSha: typeof data.new_sha === "string" ? data.new_sha : "",
            message: typeof data.message === "string" ? data.message : "",
            squashedCount:
              typeof data.squashed_count === "number"
                ? data.squashed_count
                : 0,
            oldHeadSha:
              typeof data.old_head_sha === "string" ? data.old_head_sha : "",
            filesTouched: Array.isArray(data.files_touched)
              ? data.files_touched.filter(
                  (f): f is string => typeof f === "string",
                )
              : [],
          },
        };
      }
      // Failure envelope: reason is guaranteed on every failure path.
      return {
        ok: false,
        reason:
          typeof data?.reason === "string" && data.reason
            ? data.reason
            : "unknown",
        stderr:
          typeof data?.stderr === "string" && data.stderr
            ? data.stderr
            : undefined,
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
      if (isSquashing.value && isMounted) isSquashing.value = false;
    }
  }

  function dispose(): void {
    isMounted = false;
    abortController?.abort();
    abortController = null;
  }

  return { isSquashing, squash, dispose };
}
