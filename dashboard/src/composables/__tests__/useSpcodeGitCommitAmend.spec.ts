// Author: elecvoid243 @ 2026-08-13
// Spec: astrbot_plugin_spcode_toolkit
//   docs/superpowers/specs/2026-08-13-git-commit-amend-frontend-design.md
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

const mockPost = vi.fn();
vi.mock("@/api/v1", () => ({
  pluginExtensionApi: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import { useSpcodeGitCommitAmend } from "../useSpcodeGitCommitAmend";

function withSetup<T>(fn: () => T): T {
  let result: T;
  const Comp = defineComponent({
    setup() {
      result = fn();
      return () => h("div");
    },
  });
  mount(Comp);
  return result!;
}

describe("useSpcodeGitCommitAmend", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("amend() posts snake_case body and parses success", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          amended: true,
          before_sha: "a".repeat(40),
          after_sha: "b".repeat(40),
          subject: "fix: updated",
          message: "fix: updated\n\nbody",
          reason: null,
          stderr: "",
          elapsed_ms: 5,
        },
      },
    });
    const { amend, isAmending } = withSetup(() => useSpcodeGitCommitAmend());
    const p = amend({
      message: "fix: updated\n\nbody",
      worktree: "D:/repo",
      umo: "umo-test",
    });
    expect(isAmending.value).toBe(true);
    const r = await p;
    expect(isAmending.value).toBe(false);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.amended).toBe(true);
      expect(r.snapshot.beforeSha).toBe("a".repeat(40));
      expect(r.snapshot.afterSha).toBe("b".repeat(40));
      expect(r.snapshot.subject).toBe("fix: updated");
    }
    const [endpoint, body] = mockPost.mock.calls[0];
    expect(endpoint).toBe("spcode/git-commit-amend");
    expect(body).toEqual({
      message: "fix: updated\n\nbody",
      worktree: "D:/repo",
      umo: "umo-test",
    });
  });

  it("omits worktree/umo from the body when nullish", async () => {
    mockPost.mockResolvedValueOnce({
      data: { data: { amended: false, reason: "staged_changes_present" } },
    });
    const { amend } = withSetup(() => useSpcodeGitCommitAmend());
    await amend({ message: "m" });
    const [, body] = mockPost.mock.calls[0];
    expect(body).not.toHaveProperty("worktree");
    expect(body).not.toHaveProperty("umo");
  });

  it("passes failure reason + stderr through", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          amended: false,
          reason: "cannot_amend_merge_commit",
          stderr: "cannot amend merge commit",
        },
      },
    });
    const { amend } = withSetup(() => useSpcodeGitCommitAmend());
    const r = await amend({ message: "m", umo: "u" });
    expect(r).toEqual({
      ok: false,
      reason: "cannot_amend_merge_commit",
      stderr: "cannot amend merge commit",
    });
  });

  it("maps network errors to 'network'", async () => {
    mockPost.mockRejectedValueOnce({
      code: "ERR_NETWORK",
      message: "Network Error",
    });
    const { amend } = withSetup(() => useSpcodeGitCommitAmend());
    const r = await amend({ message: "m", umo: "u" });
    expect(r).toEqual({ ok: false, reason: "network" });
  });

  it("dispose() makes subsequent calls return 'aborted'", async () => {
    const { amend, dispose } = withSetup(() => useSpcodeGitCommitAmend());
    dispose();
    const r = await amend({ message: "m", umo: "u" });
    expect(r).toEqual({ ok: false, reason: "aborted" });
    expect(mockPost).not.toHaveBeenCalled();
  });
});
