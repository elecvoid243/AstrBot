// Author: elecvoid243
// Date: 2026-08-13
// Vue composable wrapping POST /spcode/code-check. Mirrors the lifecycle
// pattern of useSpcodeFileRestore.ts (single instance per consumer,
// AbortController for cancellation, isMounted guard).
// Spec: spcode plugin docs/api/webapi-code-check-format-api.md §2.

import { ref } from "vue";
import { pluginExtensionApi } from "@/api/v1";
import {
  parseSpcodeCodeCheck,
  classifyCodeCheckReason,
  type CodeCheckSnapshot,
} from "./parseSpcodeCodeCheck";

export interface CodeCheckParams {
  path: string;
  linter?: "auto" | "ruff" | "cpplint" | "cppcheck";
  /** true = `ruff check --fix` (auto-fix), false = read-only check. */
  fix?: boolean;
  umo?: string | null;
  worktree?: string | null;
}

export type CodeCheckResult =
  | { ok: true; snapshot: CodeCheckSnapshot }
  | { ok: false; reason: string; stderr?: string };

export interface UseSpcodeCodeCheck {
  isChecking: import("vue").Ref<boolean>;
  check: (params: CodeCheckParams) => Promise<CodeCheckResult>;
  dispose: () => void;
}

export function useSpcodeCodeCheck(): UseSpcodeCodeCheck {
  const isChecking = ref(false);
  let ctrl: AbortController | null = null;
  let isMounted = true;

  async function check(params: CodeCheckParams): Promise<CodeCheckResult> {
    if (!isMounted) return { ok: false, reason: "aborted" };
    ctrl?.abort();
    ctrl = new AbortController();
    isChecking.value = true;
    try {
      const resp = await pluginExtensionApi.post<unknown>(
        "spcode/code-check",
        {
          path: params.path,
          linter: params.linter ?? "auto",
          fix: params.fix ?? false,
          ...(params.worktree ? { worktree: params.worktree } : {}),
          ...(params.umo ? { umo: params.umo } : {}),
        },
        { signal: ctrl.signal },
      );
      if (!isMounted) return { ok: false, reason: "aborted" };
      const parsed = parseSpcodeCodeCheck(resp.data);
      if (parsed.kind !== "ok") return { ok: false, reason: "unknown" };
      const snap = parsed.snapshot;
      if (!snap.success && snap.reason) {
        return {
          ok: false,
          reason: classifyCodeCheckReason(snap.reason),
          stderr: snap.stderr || undefined,
        };
      }
      return { ok: true, snapshot: snap };
    } catch (err) {
      if (!isMounted) return { ok: false, reason: "aborted" };
      const e = err as { name?: string; code?: string; message?: string };
      if (e?.name === "CanceledError") return { ok: false, reason: "aborted" };
      if (e?.code === "ERR_NETWORK" || /network/i.test(e?.message ?? "")) {
        return { ok: false, reason: "network" };
      }
      return { ok: false, reason: "unknown" };
    } finally {
      if (isMounted) isChecking.value = false;
    }
  }

  function dispose(): void {
    isMounted = false;
    ctrl?.abort();
    ctrl = null;
  }

  return { isChecking, check, dispose };
}
