// Author: elecvoid243 @ 2026-08-12
// API doc: astrbot_plugin_spcode_toolkit docs/api/webapi-git-pull-push-remote-api.md
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

import { useSpcodeGitRemoteSync } from "../useSpcodeGitRemoteSync";

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

describe("useSpcodeGitRemoteSync", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("pull() posts snake_case body and parses an updated pull", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          success: true,
          pulled: true,
          updated: true,
          mode: "rebase",
          remote: "origin",
          branch: "main",
          after_sha: "abc1234",
          files_touched: ["a.ts"],
          upstream: "origin/main",
          reason: null,
          stderr: "",
          elapsed_ms: 5,
        },
      },
    });
    const { pull, isPulling } = withSetup(() => useSpcodeGitRemoteSync());
    const p = pull({ rebase: true, worktree: "D:/repo" });
    expect(isPulling.value).toBe(true);
    const r = await p;
    expect(isPulling.value).toBe(false);
    expect(r).toMatchObject({ ok: true, updated: true, mode: "rebase" });
    const [endpoint, body] = mockPost.mock.calls[0];
    expect(endpoint).toBe("spcode/git-pull");
    expect(body).toMatchObject({
      umo: "umo-test",
      worktree: "D:/repo",
      ff_only: false,
      rebase: true,
    });
    expect(body).not.toHaveProperty("remote");
  });

  it("pull() surfaces conflicts with conflicted files", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          success: false,
          reason: "merge_conflict",
          conflicted_files: [{ path: "a.ts", status: "UU" }],
          stderr: "CONFLICT",
          elapsed_ms: 5,
        },
      },
    });
    const { pull } = withSetup(() => useSpcodeGitRemoteSync());
    const r = await pull({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("merge_conflict");
      expect(r.conflict).toBe(true);
      expect(r.conflictedFiles).toEqual(["a.ts"]);
    }
  });

  it("push() posts to git-push and parses set_upstream success", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          success: true,
          pushed: true,
          set_upstream: true,
          remote: "origin",
          branch: "main",
          remote_branch: "origin/main",
          upstream: "origin/main",
          reason: null,
          stderr: "",
          elapsed_ms: 5,
        },
      },
    });
    const { push, isPushing } = withSetup(() => useSpcodeGitRemoteSync());
    const p = push({});
    expect(isPushing.value).toBe(true);
    const r = await p;
    expect(isPushing.value).toBe(false);
    expect(r).toMatchObject({ ok: true, pushed: true, setUpstream: true });
    const [endpoint, body] = mockPost.mock.calls[0];
    expect(endpoint).toBe("spcode/git-push");
    expect(body).toEqual({ umo: "umo-test" });
  });

  it("setRemoteUrl() posts url + remote and parses action", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          success: true,
          configured: true,
          action: "added",
          remote: "origin",
          url: "https://example.com/o/r.git",
          reason: null,
          stderr: "",
          elapsed_ms: 5,
        },
      },
    });
    const { setRemoteUrl } = withSetup(() => useSpcodeGitRemoteSync());
    const r = await setRemoteUrl({ url: "https://example.com/o/r.git" });
    expect(r).toMatchObject({ ok: true, action: "added" });
    const [endpoint, body] = mockPost.mock.calls[0];
    expect(endpoint).toBe("spcode/git-remote-set-url");
    expect(body).toMatchObject({
      umo: "umo-test",
      url: "https://example.com/o/r.git",
      remote: "origin",
    });
  });

  it("maps network errors to reason network", async () => {
    mockPost.mockRejectedValueOnce({
      code: "ERR_NETWORK",
      message: "Network Error",
    });
    const { push } = withSetup(() => useSpcodeGitRemoteSync());
    const r = await push({});
    expect(r).toMatchObject({ ok: false, reason: "network" });
  });

  it("returns aborted after dispose()", async () => {
    const api = withSetup(() => useSpcodeGitRemoteSync());
    api.dispose();
    const r = await api.pull({});
    expect(r).toMatchObject({ ok: false, reason: "aborted" });
    expect(mockPost).not.toHaveBeenCalled();
  });
});
