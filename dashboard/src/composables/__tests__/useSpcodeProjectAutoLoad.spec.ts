// dashboard/src/composables/__tests__/useSpcodeProjectAutoLoad.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useSpcodeProjectAutoLoad,
  ProjectLoadError,
} from "../useSpcodeProjectAutoLoad";
import type { Project } from "@/components/chat/ProjectList.vue";

vi.mock("@/api/v1", () => ({
  pluginExtensionApi: {
    post: vi.fn(),
  },
}));

import { pluginExtensionApi } from "@/api/v1";

const baseProject: Project = {
  project_id: "p-1",
  title: "T",
  workspace_type: "project",
  workspace_path: "/abs/repo",
  spcode_auto_load: true,
  spcode_force: false,
  spcode_no_codegraph: false,
  created_at: "",
  updated_at: "",
};

/** Wrap a ProjectLoadResponse-shaped object in the ApiEnvelope that
 *  pluginExtensionApi.post actually returns (status+data envelope). */
function mockPost(response: unknown): void {
  (pluginExtensionApi.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    data: { status: "ok", data: response },
  });
}

beforeEach(() => {
  (pluginExtensionApi.post as ReturnType<typeof vi.fn>).mockReset();
});

describe("useSpcodeProjectAutoLoad", () => {
  it("FT-1: returns null for workspace_type=session", async () => {
    const { silentLoad } = useSpcodeProjectAutoLoad();
    const r = await silentLoad({
      project: { ...baseProject, workspace_type: "session" },
      umo: "u1",
    });
    expect(r).toBeNull();
    expect(pluginExtensionApi.post).not.toHaveBeenCalled();
  });

  it("FT-2: returns null when spcode_auto_load=false", async () => {
    const { silentLoad } = useSpcodeProjectAutoLoad();
    const r = await silentLoad({
      project: { ...baseProject, spcode_auto_load: false },
      umo: "u1",
    });
    expect(r).toBeNull();
    expect(pluginExtensionApi.post).not.toHaveBeenCalled();
  });

  it("FT-3: success returns data and posts exactly once", async () => {
    mockPost({
      success: true,
      reason: null,
      elapsed_ms: 100,
      data: {
        loaded: true,
        directory: "/abs/repo",
        umo: "u1",
        skipped_substeps: [],
        substep_messages: [],
      },
    });
    const { silentLoad } = useSpcodeProjectAutoLoad();
    const r = await silentLoad({ project: baseProject, umo: "u1" });
    expect(r?.loaded).toBe(true);
    expect(pluginExtensionApi.post).toHaveBeenCalledTimes(1);
  });

  it("FT-4: no_project_loaded + matching directory is treated as success", async () => {
    mockPost({
      success: false,
      reason: "no_project_loaded",
      elapsed_ms: 1,
      data: {
        loaded: false,
        directory: "/abs/repo",
        umo: "u1",
        skipped_substeps: [],
        substep_messages: [],
        previous_directory: "/abs/repo",
      },
    });
    const { silentLoad } = useSpcodeProjectAutoLoad();
    const r = await silentLoad({ project: baseProject, umo: "u1" });
    expect(r?.loaded).toBe(true);
    expect(pluginExtensionApi.post).toHaveBeenCalledTimes(1);
  });

  it("FT-5: no_project_loaded + mismatch + spcode_force=true retries with force", async () => {
    mockPost({
      success: false,
      reason: "no_project_loaded",
      elapsed_ms: 1,
      data: {
        loaded: false,
        directory: "/abs/repo",
        umo: "u1",
        skipped_substeps: [],
        substep_messages: [],
        previous_directory: "/old",
      },
    });
    mockPost({
      success: true,
      reason: null,
      elapsed_ms: 100,
      data: {
        loaded: true,
        directory: "/abs/repo",
        umo: "u1",
        skipped_substeps: [],
        substep_messages: [],
      },
    });
    const { silentLoad } = useSpcodeProjectAutoLoad();
    const r = await silentLoad({
      project: { ...baseProject, spcode_force: true },
      umo: "u1",
    });
    expect(r?.loaded).toBe(true);
    expect(pluginExtensionApi.post).toHaveBeenCalledTimes(2);
    // pluginExtensionApi.post signature is (pluginPath, data?, config?)
    // The 2nd arg is the body.
    const secondCall = (
      pluginExtensionApi.post as ReturnType<typeof vi.fn>
    ).mock.calls[1];
    expect(secondCall[1].force).toBe(true);
  });

  it("FT-6: no_project_loaded + mismatch + spcode_force=false throws", async () => {
    mockPost({
      success: false,
      reason: "no_project_loaded",
      elapsed_ms: 1,
      data: {
        loaded: false,
        directory: "/abs/repo",
        umo: "u1",
        skipped_substeps: [],
        substep_messages: [],
        previous_directory: "/old",
      },
    });
    const { silentLoad } = useSpcodeProjectAutoLoad();
    await expect(
      silentLoad({ project: baseProject, umo: "u1" }),
    ).rejects.toBeInstanceOf(ProjectLoadError);
  });

  it("FT-7: git_error throws ProjectLoadError with reason git_error", async () => {
    mockPost({
      success: false,
      reason: "git_error",
      elapsed_ms: 1,
      data: {
        loaded: false,
        directory: "/abs/repo",
        umo: "u1",
        skipped_substeps: [],
        substep_messages: ["ERR [2/3] codegraph init failed"],
      },
    });
    const { silentLoad } = useSpcodeProjectAutoLoad();
    await expect(
      silentLoad({ project: baseProject, umo: "u1" }),
    ).rejects.toMatchObject({ reason: "git_error" });
  });

  it("FT-8: feature_disabled throws ProjectLoadError with that reason", async () => {
    mockPost({
      success: false,
      reason: "feature_disabled",
      elapsed_ms: 1,
      data: {
        loaded: false,
        directory: "/abs/repo",
        umo: "u1",
        skipped_substeps: [],
        substep_messages: [],
      },
    });
    const { silentLoad } = useSpcodeProjectAutoLoad();
    await expect(
      silentLoad({ project: baseProject, umo: "u1" }),
    ).rejects.toMatchObject({ reason: "feature_disabled" });
  });

  it("FT-9: inflight serializes same (project, umo) — concurrent calls share one promise", async () => {
    let resolveFirst!: (v: unknown) => void;
    (
      pluginExtensionApi.post as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { silentLoad } = useSpcodeProjectAutoLoad();
    const p1 = silentLoad({ project: baseProject, umo: "u1" });
    const p2 = silentLoad({ project: baseProject, umo: "u1" });
    expect(pluginExtensionApi.post).toHaveBeenCalledTimes(1);
    resolveFirst({
      data: {
        status: "ok",
        data: {
          success: true,
          reason: null,
          elapsed_ms: 1,
          data: {
            loaded: true,
            directory: "/abs/repo",
            umo: "u1",
            skipped_substeps: [],
            substep_messages: [],
          },
        },
      },
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
  });

  it("FT-10: inflight isolated by (project, umo) — different keys do not block each other", async () => {
    let resolveFirst!: (v: unknown) => void;
    (
      pluginExtensionApi.post as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    mockPost({
      success: true,
      reason: null,
      elapsed_ms: 1,
      data: {
        loaded: true,
        directory: "/b",
        umo: "u1",
        skipped_substeps: [],
        substep_messages: [],
      },
    });
    const { silentLoad } = useSpcodeProjectAutoLoad();
    const p1 = silentLoad({ project: baseProject, umo: "u1" });
    const p2 = silentLoad({
      project: { ...baseProject, project_id: "p-2" },
      umo: "u1",
    });
    expect(pluginExtensionApi.post).toHaveBeenCalledTimes(2);
    resolveFirst({
      data: {
        status: "ok",
        data: {
          success: true,
          reason: null,
          elapsed_ms: 1,
          data: {
            loaded: true,
            directory: "/a",
            umo: "u1",
            skipped_substeps: [],
            substep_messages: [],
          },
        },
      },
    });
    await Promise.all([p1, p2]);
  });

  it("FT-11: network timeout throws ProjectLoadError(network_timeout)", async () => {
    (
      pluginExtensionApi.post as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(
      (path: string, _data: unknown, config?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          config?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const { silentLoad } = useSpcodeProjectAutoLoad();
    await expect(
      silentLoad({ project: baseProject, umo: "u1", timeoutMs: 50 }),
    ).rejects.toMatchObject({ reason: "network_timeout" });
  });
});
