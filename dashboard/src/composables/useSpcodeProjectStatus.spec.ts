// useSpcodeProjectStatus.spec.ts
//
// Regression tests for the null-umo guard (2026-08-15, elecvoid243):
// refresh() without a umo must reset the shared status to the empty
// state and MUST NOT hit the backend's "most-recently-loaded project
// across ALL umos" fallback — that fallback returns an unrelated
// fixed directory, which the per-session chip would display as the
// current session's project right after "new chat" / a project title
// is clicked (no session exists yet, so there is no umo).
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/api/v1", () => ({
  pluginExtensionApi: { get: vi.fn(), post: vi.fn() },
}));

import { pluginExtensionApi } from "@/api/v1";
import { useSpcodeProjectStatus } from "./useSpcodeProjectStatus";

const getMock = vi.mocked(pluginExtensionApi.get);

const UMO = "webchat:FriendMessage:webchat!astrbot!cid-123";

describe("useSpcodeProjectStatus null-umo guard", () => {
  beforeEach(() => {
    getMock.mockReset();
    useSpcodeProjectStatus().reset();
  });

  it("refresh(null) resets to the empty state without hitting the API", async () => {
    const { status, refresh, setLoaded } = useSpcodeProjectStatus();
    setLoaded("C:/proj/demo");
    expect(status.value.loaded).toBe(true);
    expect(status.value.directory).toBe("C:/proj/demo");

    await refresh(null);

    expect(status.value.loaded).toBe(false);
    expect(status.value.directory).toBeNull();
    expect(status.value.umo).toBeNull();
    expect(status.value.allLoadedCount).toBe(0);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("refresh(undefined) behaves like refresh(null)", async () => {
    const { status, refresh, setLoaded } = useSpcodeProjectStatus();
    setLoaded("C:/proj/demo");

    await refresh(undefined);

    expect(status.value.loaded).toBe(false);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("refresh(umo) queries the API for that umo and adopts the response", async () => {
    getMock.mockResolvedValue({
      data: {
        data: {
          loaded: true,
          directory: "C:/proj/demo",
          loaded_at: 123.4,
          umo: UMO,
          all_loaded_count: 2,
          boot_id: "4000-1234567890",
        },
      },
    } as never);
    const { status, refresh } = useSpcodeProjectStatus();

    await refresh(UMO);

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock.mock.calls[0][1]).toEqual({ params: { umo: UMO } });
    expect(status.value.loaded).toBe(true);
    expect(status.value.directory).toBe("C:/proj/demo");
    expect(status.value.umo).toBe(UMO);
    expect(status.value.allLoadedCount).toBe(2);
    // 2026-09-01: backend boot id is parsed and drives stale-tag detection.
    expect(status.value.bootId).toBe("4000-1234567890");
  });

  it("bootId stays null when the backend omits it", async () => {
    getMock.mockResolvedValue({
      data: {
        data: {
          loaded: false,
          directory: null,
          loaded_at: null,
          umo: UMO,
          all_loaded_count: 0,
        },
      },
    } as never);
    const { status, refresh } = useSpcodeProjectStatus();
    await refresh(UMO);
    expect(status.value.bootId).toBeNull();
  });

  it("reset() and setUnloaded() keep the observed bootId", async () => {
    getMock.mockResolvedValue({
      data: {
        data: {
          loaded: true,
          directory: "C:/proj/demo",
          loaded_at: 123.4,
          umo: UMO,
          all_loaded_count: 1,
          boot_id: "4000-abc",
        },
      },
    } as never);
    const { status, refresh, setUnloaded, reset } = useSpcodeProjectStatus();
    await refresh(UMO);
    expect(status.value.bootId).toBe("4000-abc");

    setUnloaded();
    expect(status.value.bootId).toBe("4000-abc");
    reset();
    expect(status.value.bootId).toBe("4000-abc");
  });

  it("concurrent refresh(umo) calls share a single GET", async () => {
    getMock.mockResolvedValue({
      data: {
        data: {
          loaded: true,
          directory: "C:/proj/demo",
          loaded_at: 123.4,
          umo: UMO,
          all_loaded_count: 1,
          boot_id: "4000-abc",
        },
      },
    } as never);
    const { status, refresh } = useSpcodeProjectStatus();
    await Promise.all([refresh(UMO), refresh(UMO), refresh(UMO)]);
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(status.value.bootId).toBe("4000-abc");
  });
});
