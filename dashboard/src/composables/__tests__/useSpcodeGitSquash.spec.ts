// Author: elecvoid243 @ 2026-08-03
// Spec: docs/superpowers/specs/2026-08-03-git-squash-design.md §4.1
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

const mockPost = vi.fn();
vi.mock("@/api/v1", () => ({
  pluginExtensionApi: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import { useSpcodeGitSquash } from "../useSpcodeGitSquash";

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

describe("useSpcodeGitSquash", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("squash() posts snake_case body and parses success", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          squashed: true,
          new_sha: "a".repeat(40),
          message: "combined",
          squashed_count: 2,
          old_head_sha: "b".repeat(40),
          files_touched: ["a.ts"],
          reason: null,
          stderr: "",
          elapsed_ms: 5,
        },
      },
    });
    const { squash, isSquashing } = withSetup(() => useSpcodeGitSquash());
    const p = squash({
      shas: ["c".repeat(40), "d".repeat(40)],
      message: "combined",
      worktree: "D:/repo",
      umo: "umo-test",
    });
    expect(isSquashing.value).toBe(true);
    const r = await p;
    expect(isSquashing.value).toBe(false);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.newSha).toBe("a".repeat(40));
      expect(r.snapshot.message).toBe("combined");
      expect(r.snapshot.squashedCount).toBe(2);
      expect(r.snapshot.oldHeadSha).toBe("b".repeat(40));
      expect(r.snapshot.filesTouched).toEqual(["a.ts"]);
    }
    const [endpoint, body] = mockPost.mock.calls[0];
    expect(endpoint).toBe("spcode/git-squash");
    expect(body).toEqual({
      commits: ["c".repeat(40), "d".repeat(40)],
      message: "combined",
      worktree: "D:/repo",
      umo: "umo-test",
    });
  });

  it("omits worktree/umo from the body when nullish", async () => {
    mockPost.mockResolvedValueOnce({
      data: { data: { squashed: false, reason: "worktree_dirty" } },
    });
    const { squash } = withSetup(() => useSpcodeGitSquash());
    await squash({ shas: ["a", "b"], message: "m" });
    const [, body] = mockPost.mock.calls[0];
    expect(body).not.toHaveProperty("worktree");
    expect(body).not.toHaveProperty("umo");
  });

  it("passes failure reason + stderr through", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        data: {
          squashed: false,
          reason: "not_contiguous",
          stderr: "selected commits are not a contiguous range from HEAD",
        },
      },
    });
    const { squash } = withSetup(() => useSpcodeGitSquash());
    const r = await squash({ shas: ["a", "b"], message: "m", umo: "u" });
    expect(r).toEqual({
      ok: false,
      reason: "not_contiguous",
      stderr: "selected commits are not a contiguous range from HEAD",
    });
  });

  it("maps network errors to 'network'", async () => {
    mockPost.mockRejectedValueOnce({
      code: "ERR_NETWORK",
      message: "Network Error",
    });
    const { squash } = withSetup(() => useSpcodeGitSquash());
    const r = await squash({ shas: ["a", "b"], message: "m", umo: "u" });
    expect(r).toEqual({ ok: false, reason: "network" });
  });

  it("dispose() makes subsequent calls return 'aborted'", async () => {
    const { squash, dispose } = withSetup(() => useSpcodeGitSquash());
    dispose();
    const r = await squash({ shas: ["a", "b"], message: "m", umo: "u" });
    expect(r).toEqual({ ok: false, reason: "aborted" });
    expect(mockPost).not.toHaveBeenCalled();
  });
});
