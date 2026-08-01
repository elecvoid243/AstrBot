// Author: elecvoid243 @ 2026-08-01
// Spec: docs/superpowers/specs/2026-08-01-git-merge-cherrypick-conflict-frontend-design.md §3.3
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";

vi.mock("../useSpcodeProjectStatus", () => ({
  useSpcodeProjectStatus: () => ({
    status: { value: { umo: "umo-test", directory: "D:/repo", loaded: true } },
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

import { useSpcodeGitConflict } from "../useSpcodeGitConflict";

const NO_CONFLICT = {
  in_conflict: false,
  operation: null,
  operation_ref: null,
  operation_subject: null,
  conflicted_files: [],
  resolved_files: [],
  total_conflicted: 0,
  total_resolved: 0,
  all_resolved: true,
  directory: "D:/repo",
  umo: "umo-test",
  worktree: "D:/repo",
  reason: null,
  stderr: "",
  elapsed_ms: 2,
};

const IN_CONFLICT = {
  ...NO_CONFLICT,
  in_conflict: true,
  operation: "merge",
  operation_ref: "abc",
  operation_subject: "s",
  conflicted_files: [
    {
      path: "a.ts",
      status: "UU",
      hunks: [],
      three_way: { base: null, ours: "x", theirs: "y" },
      binary: false,
      truncated: false,
    },
  ],
  total_conflicted: 1,
  all_resolved: false,
};

function okGet(data: Record<string, unknown>) {
  return { status: 200, data: { status: "ok", data }, headers: { etag: 'W/"e1"' } };
}

function withSetup<T>(fn: () => T): { result: T; unmount: () => void } {
  let result: T;
  const Comp = defineComponent({
    setup() {
      result = fn();
      return () => h("div");
    },
  });
  const wrapper = mount(Comp);
  return { result: result!, unmount: () => wrapper.unmount() };
}

describe("useSpcodeGitConflict", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refresh() transitions idle → ok and parses snapshot", async () => {
    mockGet.mockResolvedValueOnce(okGet(IN_CONFLICT));
    const { result } = withSetup(() => useSpcodeGitConflict(ref("D:/repo")));
    expect(result.state.value.kind).toBe("idle");
    await result.refresh();
    expect(result.state.value.kind).toBe("ok");
    if (result.state.value.kind === "ok") {
      expect(result.state.value.snapshot.inConflict).toBe(true);
      expect(result.state.value.snapshot.operation).toBe("merge");
      expect(result.state.value.snapshot.conflictedFiles[0].threeWay.ours).toBe("x");
    }
    const [endpoint, cfg] = mockGet.mock.calls[0];
    expect(endpoint).toBe("spcode/git-conflict-status");
    expect(cfg.params).toMatchObject({ umo: "umo-test", worktree: "D:/repo" });
  });

  it("304 replays the cached snapshot with notModified", async () => {
    mockGet.mockResolvedValueOnce(okGet(IN_CONFLICT));
    const { result } = withSetup(() => useSpcodeGitConflict(ref(null)));
    await result.refresh();
    mockGet.mockResolvedValueOnce({ status: 304, data: null, headers: {} });
    await result.refresh();
    if (result.state.value.kind === "ok") {
      expect(result.state.value.notModified).toBe(true);
      expect(result.state.value.snapshot.inConflict).toBe(true);
    } else {
      throw new Error("expected ok state");
    }
  });

  it("error keeps previousSnapshot", async () => {
    mockGet.mockResolvedValueOnce(okGet(NO_CONFLICT));
    const { result } = withSetup(() => useSpcodeGitConflict(ref(null)));
    await result.refresh();
    mockGet.mockRejectedValueOnce({ code: "ERR_NETWORK", message: "Network Error" });
    await result.refresh();
    expect(result.state.value.kind).toBe("error");
    if (result.state.value.kind === "error") {
      expect(result.state.value.reason).toBe("network");
      expect(result.state.value.previousSnapshot?.inConflict).toBe(false);
    }
  });

  it("startPolling fires refresh on the interval", async () => {
    vi.useFakeTimers();
    mockGet.mockResolvedValue(okGet(NO_CONFLICT));
    const { result, unmount } = withSetup(() => useSpcodeGitConflict(ref(null)));
    result.startPolling(30_000);
    expect(mockGet).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockGet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockGet).toHaveBeenCalledTimes(2);
    result.stopPolling();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockGet).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("resolve() posts the serialized body and refreshes state", async () => {
    mockGet.mockResolvedValue(okGet(IN_CONFLICT));
    mockPost.mockResolvedValueOnce({
      data: {
        status: "ok",
        data: {
          resolved: true,
          file: "a.ts",
          mode: "whole_file",
          hunks_resolved: null,
          hunks_total: null,
          partial: false,
          remaining_conflicts: [],
          all_resolved: true,
          reason: null,
          stderr: "",
          elapsed_ms: 4,
        },
      },
    });
    const { result } = withSetup(() => useSpcodeGitConflict(ref("D:/repo")));
    const r = await result.resolve({ mode: "whole", file: "a.ts", resolution: "ours" });
    expect(r.ok).toBe(true);
    const [endpoint, body] = mockPost.mock.calls[0];
    expect(endpoint).toBe("spcode/git-conflict-resolve");
    expect(body).toMatchObject({
      umo: "umo-test",
      worktree: "D:/repo",
      file: "a.ts",
      resolution: "ours",
    });
    // success triggers an immediate status refresh
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("continueOp() posts optional message; abort() posts empty body", async () => {
    mockGet.mockResolvedValue(okGet(NO_CONFLICT));
    mockPost
      .mockResolvedValueOnce({
        data: {
          status: "ok",
          data: {
            continued: true,
            operation: "merge",
            commit_sha: "c1",
            commit_message: "m",
            files_touched: [],
            reason: null,
            stderr: "",
            elapsed_ms: 4,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: "ok",
          data: {
            aborted: true,
            operation: "merge",
            operation_ref: "abc",
            reason: null,
            stderr: "",
            elapsed_ms: 4,
          },
        },
      });
    const { result } = withSetup(() => useSpcodeGitConflict(ref(null)));
    const rc = await result.continueOp("my message");
    expect(rc).toMatchObject({ ok: true, operation: "merge", commitSha: "c1" });
    expect(mockPost.mock.calls[0][0]).toBe("spcode/git-conflict-continue");
    expect(mockPost.mock.calls[0][1]).toMatchObject({
      umo: "umo-test",
      message: "my message",
    });
    const ra = await result.abort();
    expect(ra.ok).toBe(true);
    expect(mockPost.mock.calls[1][0]).toBe("spcode/git-conflict-abort");
    expect(mockPost.mock.calls[1][1]).not.toHaveProperty("message");
  });

  it("mutations return aborted after dispose()", async () => {
    const { result } = withSetup(() => useSpcodeGitConflict(ref(null)));
    result.dispose();
    const r = await result.resolve({ mode: "all", resolution: "ours" });
    expect(r).toMatchObject({ ok: false, reason: "aborted" });
    expect(mockPost).not.toHaveBeenCalled();
  });
});
