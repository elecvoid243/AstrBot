// dashboard/src/composables/useSpcodeProjectAutoLoad.ts
//
// Silent (no chat-history pollution) spcode project-load driver for
// ChatUI "project"-typed projects. Called by the Chat.vue currSessionId
// watcher (Task 14) every time the active session changes.
//
// Behavior contract (mirrors spcode endpoint spec):
//   - workspace_type !== "project" -> return null (no-op)
//   - spcode_auto_load === false    -> return null (no-op)
//   - missing workspace_path        -> return null (no-op)
//   - same (project, umo) concurrent calls share one in-flight promise
//   - response success -> return data
//   - response reason "no_project_loaded" + previous_directory matches
//     workspace_path -> treat as success (idempotent re-entry)
//   - response reason "no_project_loaded" + mismatch + spcode_force=true
//     -> retry with force=true
//   - any other failure -> throw ProjectLoadError
//
// Author: elecvoid243

import { ref } from "vue";
import { pluginExtensionApi } from "@/api/v1";
import type { Project } from "@/components/chat/ProjectList.vue";

export type ProjectLoadReason =
  | "invalid_body"
  | "invalid_param"
  | "feature_disabled"
  | "no_project_loaded"
  | "path_unsafe"
  | "git_error"
  | "network_timeout"
  | "unknown";

export interface ProjectLoadData {
  loaded: boolean;
  directory: string;
  umo: string;
  skipped_substeps: string[];
  substep_messages: string[];
  previous_directory?: string;
  silent_reason?: string;
}

export interface ProjectLoadResponse {
  success: boolean;
  reason: ProjectLoadReason | null;
  elapsed_ms: number;
  data: ProjectLoadData;
}

/** Thrown when the silent project-load endpoint reports a non-success result
 *  or the network call itself fails. The reason string is suitable for i18n. */
export class ProjectLoadError extends Error {
  constructor(
    public reason: ProjectLoadReason,
    public data: ProjectLoadData,
  ) {
    super(`Project load failed: ${reason}`);
    this.name = "ProjectLoadError";
  }
}

export interface SilentLoadRequest {
  project: Project;
  umo: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const inflight = new Map<string, Promise<ProjectLoadData | null>>();

function inflightKey(project: Project, umo: string): string {
  return `${project.project_id}::${umo}`;
}

async function postLoad(
  req: SilentLoadRequest,
  force: boolean,
): Promise<ProjectLoadResponse> {
  const controller = new AbortController();
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  req.signal?.addEventListener("abort", onExternalAbort);
  try {
    // pluginExtensionApi.post signature: (pluginPath, data?, config?)
    // We pass the body as the 2nd arg and the AbortSignal via AxiosRequestConfig.
    const res = await pluginExtensionApi.post<ProjectLoadResponse>(
      "spcode/project-load",
      {
        directory: req.project.workspace_path!,
        umo: req.umo,
        force,
        no_codegraph: req.project.spcode_no_codegraph || undefined,
      },
      { signal: controller.signal },
    );
    return res.data.data;
  } catch (err) {
    const aborted =
      controller.signal.aborted ||
      (err as { name?: string })?.name === "AbortError";
    throw new ProjectLoadError(
      aborted ? "network_timeout" : "unknown",
      {
        loaded: false,
        directory: req.project.workspace_path ?? "",
        umo: req.umo,
        skipped_substeps: [],
        substep_messages: [String((err as Error)?.message ?? err)],
      },
    );
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export function useSpcodeProjectAutoLoad() {
  async function silentLoad(
    req: SilentLoadRequest,
  ): Promise<ProjectLoadData | null> {
    const { project, umo } = req;
    if (project.workspace_type !== "project") return null;
    if (project.spcode_auto_load === false) return null;
    if (!project.workspace_path) return null;

    const key = inflightKey(project, umo);
    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = (async (): Promise<ProjectLoadData | null> => {
      let resp = await postLoad(req, project.spcode_force === true);

      if (resp.success) return resp.data;

      // Idempotent re-entry: server says "already loaded", but the loaded
      // directory matches ours -- treat as success.
      if (
        resp.reason === "no_project_loaded" &&
        resp.data.previous_directory === project.workspace_path
      ) {
        return { ...resp.data, loaded: true };
      }

      // Mismatch + force=true: retry once with force=true.
      if (
        !resp.success &&
        resp.reason === "no_project_loaded" &&
        project.spcode_force === true
      ) {
        resp = await postLoad(req, true);
        if (resp.success) return resp.data;
      }

      throw new ProjectLoadError(resp.reason ?? "unknown", resp.data);
    })();

    inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(key);
    }
  }

  return { silentLoad };
}
