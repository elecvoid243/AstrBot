// Author: elecvoid243 @ 2026-08-01
// Spec: docs/superpowers/specs/2026-08-01-git-merge-cherrypick-conflict-frontend-design.md §3.3
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

vi.mock("../useSpcodeProjectStatus", () => ({
  useSpcodeProjectStatus: () => ({
    status: { value: { umo: "umo-test", directory: "D:/repo", loaded: true } },
    refresh: vi.fn(),
  }),
}));

const mockPost = vi.fn();
vi.mock("@/api/v1", () => ({
  pluginExtensionApi: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import { useSpcodeGitMerge } from "../useSpcodeGitMerge";

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

describe("useSpcodeGitMerge", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("merge() posts snake_case body and parses success", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          merged: true,
          source: "f/x",
          merge_sha: "abc",
          merge_message: "m",
          fast_forward: false,
          squash: false,
          files_touched: ["a.ts"],
          reason: null,
          stderr: "",
          elapsed_ms: 5,
        },
      },
    });
    const { merge, isMerging } = withSetup(() => useSpcodeGitMerge());
    const p = merge({ source: "f/x", noFf: true, worktree: "D:/repo" });
    expect(isMerging.value).toBe(true);
    const r = await p;
    expect(isMerging.value).toBe(false);
    expect(r.ok).toBe(true);
    const [endpoint, body] = mockPost.mock.calls[0];
    expect(endpoint).toBe("spcode/git-merge");
    expect(body).toMatchObject({
      umo: "umo-test",
      worktree: "D:/repo",
      source: "f/x",
      no_ff: true,
      ff_only: false,
      squash: false,
    });
    expect(body).not.toHaveProperty("message");
  });

  it("merge() surfaces conflict failures with conflicted files", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          merged: false,
          source: "f/x",
          reason: "merge_conflict",
          conflict: true,
          conflicted_files: ["a.ts"],
          stderr: "CONFLICT",
          elapsed_ms: 5,
        },
      },
    });
    const { merge } = withSetup(() => useSpcodeGitMerge());
    const r = await merge({ source: "f/x" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("merge_conflict");
      expect(r.conflict).toBe(true);
      expect(r.conflictedFiles).toEqual(["a.ts"]);
    }
  });

  it("cherryPick() posts ref + mainline and parses success", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          picked: true,
          ref: "abc",
          new_sha: "def",
          original_message: "s",
          files_touched: [],
          reason: null,
          stderr: "",
          elapsed_ms: 5,
        },
      },
    });
    const { cherryPick } = withSetup(() => useSpcodeGitMerge());
    const r = await cherryPick({ ref: "abc", mainline: 1 });
    expect(r.ok).toBe(true);
    const [endpoint, body] = mockPost.mock.calls[0];
    expect(endpoint).toBe("spcode/git-cherry-pick");
    expect(body).toMatchObject({ umo: "umo-test", ref: "abc", mainline: 1 });
    expect(body).not.toHaveProperty("worktree");
  });

  it("maps network errors to reason network", async () => {
    mockPost.mockRejectedValueOnce({ code: "ERR_NETWORK", message: "Network Error" });
    const { merge } = withSetup(() => useSpcodeGitMerge());
    const r = await merge({ source: "f/x" });
    expect(r).toMatchObject({ ok: false, reason: "network" });
  });

  it("returns aborted after dispose()", async () => {
    const api = withSetup(() => useSpcodeGitMerge());
    api.dispose();
    const r = await api.merge({ source: "f/x" });
    expect(r).toMatchObject({ ok: false, reason: "aborted" });
    expect(mockPost).not.toHaveBeenCalled();
  });
});
