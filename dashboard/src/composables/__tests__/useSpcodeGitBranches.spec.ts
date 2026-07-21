import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
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

import { useSpcodeGitBranches } from "../useSpcodeGitBranches";
import type { SpcodeGitBranchesRawResponse } from "../parseSpcodeGitBranches";

function okEnvelope(data: Partial<SpcodeGitBranchesRawResponse>) {
  return {
    status: 200,
    data: { status: "ok", data: { ...data } },
    headers: { etag: 'W/"abc"' },
  };
}

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

describe("useSpcodeGitBranches — shell", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("refresh() transitions loading → ok and stores snapshot", async () => {
    mockGet.mockResolvedValueOnce(
      okEnvelope({
        loaded: true,
        directory: "D:/repo",
        umo: "umo-test",
        branches: [
          {
            name: "main",
            sha: "a",
            upstream: "",
            upstream_track: "",
            current: true,
            remote: false,
          },
        ],
        total: 1,
        current: "main",
        detached: false,
        reason: null,
        stderr: "",
        elapsed_ms: 10,
      }),
    );
    const { state, refresh } = withSetup(() => useSpcodeGitBranches());
    expect(state.value.kind).toBe("idle");
    await refresh();
    expect(state.value.kind).toBe("ok");
    if (state.value.kind === "ok") {
      expect(state.value.snapshot.current).toBe("main");
      expect(state.value.snapshot.branches).toHaveLength(1);
    }
  });

  it("refresh() with 304 replays previous snapshot with notModified", async () => {
    const ok200 = okEnvelope({
      loaded: true,
      directory: "D:/repo",
      umo: "umo-test",
      branches: [
        {
          name: "main",
          sha: "a",
          upstream: "",
          upstream_track: "",
          current: true,
          remote: false,
        },
      ],
      total: 1,
      current: "main",
      detached: false,
      reason: null,
      stderr: "",
      elapsed_ms: 10,
    });
    mockGet.mockResolvedValueOnce(ok200);
    const { state, refresh } = withSetup(() => useSpcodeGitBranches());
    await refresh();
    expect(state.value.kind).toBe("ok");

    // Second call returns 304
    mockGet.mockResolvedValueOnce({ status: 304, data: null, headers: {} });
    await refresh();
    if (state.value.kind === "ok") {
      expect(state.value.notModified).toBe(true);
      expect(state.value.snapshot.current).toBe("main");
    }
  });

  it("refresh() sets error state with previousSnapshot on failure", async () => {
    mockGet.mockRejectedValueOnce(new Error("network"));
    const { state, refresh } = withSetup(() => useSpcodeGitBranches());
    await refresh();
    expect(state.value.kind).toBe("error");
    if (state.value.kind === "error") {
      expect(state.value.reason).toBe("network");
    }
  });

  it("startPolling is idempotent; stopPolling clears the timer", async () => {
    vi.useFakeTimers();
    mockGet.mockResolvedValue(
      okEnvelope({
        loaded: true,
        directory: "D:/repo",
        umo: "umo-test",
        branches: [],
        total: 0,
        current: null,
        detached: false,
        reason: null,
        stderr: "",
        elapsed_ms: 0,
      }),
    );
    const { startPolling, stopPolling } = withSetup(() =>
      useSpcodeGitBranches(),
    );
    startPolling(1000);
    startPolling(1000); // second call should be no-op
    expect(mockGet).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockGet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockGet).toHaveBeenCalledTimes(2);
    stopPolling();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockGet).toHaveBeenCalledTimes(2); // still 2 — no more calls
    vi.useRealTimers();
  });

  it("dispose() clears timer and prevents future state updates", async () => {
    vi.useFakeTimers();
    mockGet.mockResolvedValue(
      okEnvelope({
        loaded: true,
        directory: "D:/repo",
        umo: "umo-test",
        branches: [],
        total: 0,
        current: null,
        detached: false,
        reason: null,
        stderr: "",
        elapsed_ms: 0,
      }),
    );
    const { startPolling, dispose } = withSetup(() =>
      useSpcodeGitBranches(),
    );
    startPolling(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockGet).toHaveBeenCalledTimes(1);
    dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockGet).toHaveBeenCalledTimes(1); // no more calls after dispose
    vi.useRealTimers();
  });
});
