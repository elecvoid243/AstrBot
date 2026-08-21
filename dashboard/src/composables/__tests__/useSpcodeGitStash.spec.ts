// Author: elecvoid243 @ 2026-08-21
// API: astrbot_plugin_spcode_toolkit tools/webapi/git_stash.py
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";

// Mock the spcode project status composable BEFORE importing the SUT.
vi.mock("../useSpcodeProjectStatus", () => ({
  useSpcodeProjectStatus: () => ({
    status: {
      value: { umo: "umo-test", directory: "D:/repo", loaded: true },
    },
    refresh: vi.fn(),
  }),
}));

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock("@/api/v1", () => ({
  pluginExtensionApi: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import { useSpcodeGitStash } from "../useSpcodeGitStash";

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

const LIST_ENVELOPE = {
  data: {
    status: "ok",
    data: {
      count: 1,
      truncated: false,
      max_stashes: 50,
      stashes: [
        {
          index: 0,
          ref: "stash@{0}",
          sha: "a".repeat(40),
          message: "On main: wip",
          timestamp: 1755700000,
          file_count: 2,
          files: [
            { path: "a.py", additions: 3, deletions: 1, untracked: false },
            { path: "b.bin", additions: null, deletions: null, untracked: true },
          ],
        },
      ],
      reason: null,
      stderr: "",
      elapsed_ms: 8,
      umo: "umo-test",
      worktree: "D:/repo",
      directory: "D:/repo",
    },
  },
};

describe("useSpcodeGitStash", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("refreshList() GETs with umo/worktree params and stores the snapshot", async () => {
    mockGet.mockResolvedValueOnce(LIST_ENVELOPE);
    const { listState, refreshList } = withSetup(() =>
      useSpcodeGitStash(ref("D:/repo")),
    );
    expect(listState.value.kind).toBe("idle");
    const p = refreshList();
    expect(listState.value.kind).toBe("loading");
    await p;
    expect(listState.value.kind).toBe("ok");
    if (listState.value.kind === "ok") {
      expect(listState.value.snapshot.count).toBe(1);
      const stash = listState.value.snapshot.stashes[0];
      expect(stash.ref).toBe("stash@{0}");
      expect(stash.files[0]).toEqual({
        path: "a.py",
        additions: 3,
        deletions: 1,
        untracked: false,
      });
      // binary numstat "-" arrives as null counts
      expect(stash.files[1].additions).toBeNull();
      expect(stash.files[1].untracked).toBe(true);
    }
    const [endpoint, config] = mockGet.mock.calls[0];
    expect(endpoint).toBe("spcode/git-stash");
    expect(config.params).toEqual({ umo: "umo-test", worktree: "D:/repo" });
  });

  it("stash() posts snake_case body and parses success", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          stashed: true,
          ref: "stash@{0}",
          sha: "b".repeat(40),
          message: "On main: wip",
          timestamp: 1755700001,
          file_count: 1,
          stash_count: 2,
          files: [{ path: "a.py", additions: 1, deletions: 0, untracked: false }],
          reason: null,
          stderr: "",
          elapsed_ms: 12,
        },
      },
    });
    const { stash, isStashing } = withSetup(() => useSpcodeGitStash());
    const p = stash({ message: "wip", worktree: "D:/repo", umo: "umo-test" });
    expect(isStashing.value).toBe(true);
    const r = await p;
    expect(isStashing.value).toBe(false);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.stashed).toBe(true);
      expect(r.snapshot.fileCount).toBe(1);
      expect(r.snapshot.stashCount).toBe(2);
    }
    const [endpoint, body] = mockPost.mock.calls[0];
    expect(endpoint).toBe("spcode/git-stash");
    expect(body).toEqual({ message: "wip", worktree: "D:/repo", umo: "umo-test" });
  });

  it("omits message from the body when empty", async () => {
    mockPost.mockResolvedValueOnce({
      data: { data: { stashed: false, reason: "nothing_to_stash" } },
    });
    const { stash } = withSetup(() => useSpcodeGitStash());
    await stash({ message: "" });
    const [, body] = mockPost.mock.calls[0];
    expect(body).not.toHaveProperty("message");
    expect(body).not.toHaveProperty("worktree");
    expect(body).not.toHaveProperty("umo");
  });

  it("passes failure reason + stderr through", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          stashed: false,
          reason: "stash_failed",
          stderr: "cannot stash",
        },
      },
    });
    const { stash } = withSetup(() => useSpcodeGitStash());
    const r = await stash({ message: "m", umo: "u" });
    expect(r).toEqual({
      ok: false,
      reason: "stash_failed",
      stderr: "cannot stash",
    });
  });

  it("maps network errors to 'network'", async () => {
    mockPost.mockRejectedValueOnce({
      code: "ERR_NETWORK",
      message: "Network Error",
    });
    const { stash } = withSetup(() => useSpcodeGitStash());
    const r = await stash({ message: "m", umo: "u" });
    expect(r).toEqual({ ok: false, reason: "network" });
  });

  it("dispose() makes subsequent calls return 'aborted'", async () => {
    const { stash, dispose } = withSetup(() => useSpcodeGitStash());
    dispose();
    const r = await stash({ message: "m", umo: "u" });
    expect(r).toEqual({ ok: false, reason: "aborted" });
    expect(mockPost).not.toHaveBeenCalled();
  });

  // ── pop (POST /spcode/git-stash-pop) ──────────────────────────

  it("pop() posts the index and parses success", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          popped: true,
          ref: "stash@{1}",
          sha: "c".repeat(40),
          file_count: 2,
          stash_count: 1,
          files: [
            { path: "a.py", additions: 1, deletions: 0, untracked: false },
            { path: "n.txt", additions: 5, deletions: 0, untracked: true },
          ],
          reason: null,
          stderr: "",
          elapsed_ms: 15,
        },
      },
    });
    const { pop, popping } = withSetup(() => useSpcodeGitStash());
    const p = pop({ index: 1, ref: "stash@{1}", worktree: "D:/repo" });
    expect(popping.value).toBe("stash@{1}");
    const r = await p;
    expect(popping.value).toBeNull();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.popped).toBe(true);
      expect(r.snapshot.fileCount).toBe(2);
      expect(r.snapshot.stashCount).toBe(1);
    }
    const [endpoint, body] = mockPost.mock.calls[0];
    expect(endpoint).toBe("spcode/git-stash-pop");
    expect(body).toEqual({ index: 1, worktree: "D:/repo" });
  });

  it("pop() passes failure reason + stderr through", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          popped: false,
          ref: "stash@{0}",
          reason: "stash_conflict",
          stderr: "CONFLICT (content): Merge conflict in a.py",
        },
      },
    });
    const { pop } = withSetup(() => useSpcodeGitStash());
    const r = await pop({ index: 0, ref: "stash@{0}" });
    expect(r).toEqual({
      ok: false,
      reason: "stash_conflict",
      stderr: "CONFLICT (content): Merge conflict in a.py",
    });
  });

  it("pop() is single-flight: a second concurrent pop returns 'aborted'", async () => {
    let resolvePending: (v: unknown) => void = () => {};
    mockPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
    );
    const { pop, popping } = withSetup(() => useSpcodeGitStash());
    const first = pop({ index: 0, ref: "stash@{0}" });
    const second = await pop({ index: 1, ref: "stash@{1}" });
    expect(second).toEqual({ ok: false, reason: "aborted" });
    expect(popping.value).toBe("stash@{0}");
    resolvePending({
      data: { status: "ok", data: { popped: true, reason: null, files: [] } },
    });
    const r = await first;
    expect(r.ok).toBe(true);
    expect(popping.value).toBeNull();
  });

  // ── drop (POST /spcode/git-stash-drop) ─────────────────────────

  it("drop() posts the index and parses success", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          dropped: true,
          ref: "stash@{0}",
          sha: "d".repeat(40),
          stash_count: 2,
          reason: null,
          stderr: "",
          elapsed_ms: 9,
        },
      },
    });
    const { drop, dropping } = withSetup(() => useSpcodeGitStash());
    const p = drop({ index: 0, ref: "stash@{0}", umo: "u" });
    expect(dropping.value).toBe("stash@{0}");
    const r = await p;
    expect(dropping.value).toBeNull();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.dropped).toBe(true);
      expect(r.snapshot.stashCount).toBe(2);
    }
    const [endpoint, body] = mockPost.mock.calls[0];
    expect(endpoint).toBe("spcode/git-stash-drop");
    expect(body).toEqual({ index: 0, umo: "u" });
  });

  it("drop() passes failure reason + stderr through", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          dropped: false,
          ref: "stash@{3}",
          reason: "stash_not_found",
          stderr: "",
        },
      },
    });
    const { drop } = withSetup(() => useSpcodeGitStash());
    const r = await drop({ index: 3, ref: "stash@{3}" });
    expect(r).toEqual({ ok: false, reason: "stash_not_found" });
  });

  it("drop() is blocked while a pop is in flight (shared single-flight)", async () => {
    let resolvePending: (v: unknown) => void = () => {};
    mockPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
    );
    const { pop, drop } = withSetup(() => useSpcodeGitStash());
    const popping = pop({ index: 0, ref: "stash@{0}" });
    const r = await drop({ index: 1, ref: "stash@{1}" });
    expect(r).toEqual({ ok: false, reason: "aborted" });
    resolvePending({
      data: { status: "ok", data: { popped: true, reason: null, files: [] } },
    });
    await popping;
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
