// useSpcodeProjectAutoLoad.spec.ts
// Covers the 2026-08-07 auto-load fixes: normalized idempotent compare
// and unconditional force-retry on true mismatch (binding is the source
// of truth).
// Author: elecvoid243
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/v1", () => ({
  pluginExtensionApi: { post: vi.fn() },
}));

import { pluginExtensionApi } from "@/api/v1";
import {
  ProjectLoadError,
  useSpcodeProjectAutoLoad,
} from "./useSpcodeProjectAutoLoad";
import type { Project } from "@/components/chat/ProjectList.vue";

const postMock = () => pluginExtensionApi.post as ReturnType<typeof vi.fn>;

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    project_id: "p1",
    title: "demo",
    emoji: "📁",
    description: "",
    workspace_type: "custom",
    workspace_path: "F:/proj/",
    spcode_auto_load: true,
    spcode_force: false,
    spcode_no_codegraph: false,
    created_at: "",
    updated_at: "",
    ...overrides,
  } as Project;
}

/** Envelope-shaped reply mirroring the backend (success inside data). */
function envelope(extra: Record<string, unknown>) {
  return { data: { data: { elapsed_ms: 1, ...extra } } };
}

describe("useSpcodeProjectAutoLoad silentLoad", () => {
  beforeEach(() => postMock().mockReset());

  it("treats same-directory path variants as idempotent success", async () => {
    // Backend resolved "F:\proj"; workspace_path is "f:/proj/" — same dir.
    postMock().mockResolvedValueOnce(
      envelope({
        success: false,
        reason: "no_project_loaded",
        loaded: false,
        directory: "",
        previous_directory: "F:\\proj",
        substep_messages: [],
      }),
    );
    const { silentLoad } = useSpcodeProjectAutoLoad();
    const data = await silentLoad({ project: makeProject(), umo: "u1" });
    expect(data?.loaded).toBe(true);
    // No force retry: exactly one POST.
    expect(postMock()).toHaveBeenCalledTimes(1);
    expect(postMock().mock.calls[0][1].force).toBe(false);
  });

  it("retries with force=true on true mismatch even without spcode_force", async () => {
    postMock()
      .mockResolvedValueOnce(
        envelope({
          success: false,
          reason: "no_project_loaded",
          loaded: false,
          directory: "",
          previous_directory: "F:\\other",
          substep_messages: [],
        }),
      )
      .mockResolvedValueOnce(
        envelope({
          success: true,
          reason: null,
          loaded: true,
          directory: "F:\\proj",
          skipped_substeps: [],
          substep_messages: [],
        }),
      );
    const { silentLoad } = useSpcodeProjectAutoLoad();
    const data = await silentLoad({ project: makeProject(), umo: "u1" });
    expect(data?.loaded).toBe(true);
    expect(postMock()).toHaveBeenCalledTimes(2);
    expect(postMock().mock.calls[1][1].force).toBe(true);
  });

  it("throws ProjectLoadError when the force retry also fails", async () => {
    const fail = envelope({
      success: false,
      reason: "no_project_loaded",
      loaded: false,
      directory: "",
      previous_directory: "F:\\other",
      substep_messages: [],
    });
    postMock().mockResolvedValue(fail);
    const { silentLoad } = useSpcodeProjectAutoLoad();
    await expect(
      silentLoad({ project: makeProject(), umo: "u1" }),
    ).rejects.toBeInstanceOf(ProjectLoadError);
    expect(postMock()).toHaveBeenCalledTimes(2);
  });

  it("returns null for non-custom workspaces without any POST", async () => {
    const { silentLoad } = useSpcodeProjectAutoLoad();
    for (const workspace_type of ["session", "project"] as const) {
      const data = await silentLoad({
        project: makeProject({ workspace_type }),
        umo: "u1",
      });
      expect(data).toBeNull();
    }
    expect(postMock()).not.toHaveBeenCalled();
  });
});
