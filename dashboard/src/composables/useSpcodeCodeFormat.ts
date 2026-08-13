// Author: elecvoid243
// Date: 2026-08-13
// Vue composable wrapping POST /spcode/code-format. Mirrors the lifecycle
// pattern of useSpcodeFileRestore.ts. `check: true` performs a dry-run
// (diff_summary only, no write); `check: false` writes back.
// Spec: spcode plugin docs/api/webapi-code-check-format-api.md §3.

import { ref } from "vue";
import { pluginExtensionApi } from "@/api/v1";
import {
  parseSpcodeCodeFormat,
  classifyCodeFormatReason,
  type CodeFormatSnapshot,
} from "./parseSpcodeCodeFormat";

export interface CodeFormatParams {
  path: string;
  check?: boolean;
  umo?: string | null;
  worktree?: string | null;
}

export type CodeFormatResult =
  | { ok: true; snapshot: CodeFormatSnapshot }
  | { ok: false; reason: string; stderr?: string };

export interface UseSpcodeCodeFormat {
  isFormatting: import("vue").Ref<boolean>;
  format: (params: CodeFormatParams) => Promise<CodeFormatResult>;
  dispose: () => void;
}

export function useSpcodeCodeFormat(): UseSpcodeCodeFormat {
  const isFormatting = ref(false);
  let ctrl: AbortController | null = null;
  let isMounted = true;

  async function format(params: CodeFormatParams): Promise<CodeFormatResult> {
    if (!isMounted) return { ok: false, reason: "aborted" };
    ctrl?.abort();
    ctrl = new AbortController();
    isFormatting.value = true;
    try {
      const resp = await pluginExtensionApi.post<unknown>(
        "spcode/code-format",
        {
          path: params.path,
          check: params.check ?? false,
          ...(params.worktree ? { worktree: params.worktree } : {}),
          ...(params.umo ? { umo: params.umo } : {}),
        },
        { signal: ctrl.signal },
      );
      if (!isMounted) return { ok: false, reason: "aborted" };
      const parsed = parseSpcodeCodeFormat(resp.data);
      if (parsed.kind !== "ok") return { ok: false, reason: "unknown" };
      const snap = parsed.snapshot;
      if (!snap.success && snap.reason) {
        return {
          ok: false,
          reason: classifyCodeFormatReason(snap.reason),
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
      if (isMounted) isFormatting.value = false;
    }
  }

  function dispose(): void {
    isMounted = false;
    ctrl?.abort();
    ctrl = null;
  }

  return { isFormatting, format, dispose };
}
