// Author: elecvoid243
// Date: 2026-07-27
//
// Tests the composable's `setPlanMode(umo, active)` mutation: it must
// POST to the plugin's `spcode/plan-mode` endpoint with the umo and
// target state, adopt the authoritative state from the response
// envelope, and soft-fail (returning false, keeping prior state) on
// network errors so the caller can fall back to dispatching the
// `/plan` / `/build` chat command against older plugin versions.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { postMock } = vi.hoisted(() => {
  const postMock = vi.fn();
  return { postMock };
});

vi.mock("@/api/v1", () => ({
  pluginExtensionApi: { get: vi.fn(), post: postMock },
}));

import { useSpcodePlanMode } from "./useSpcodePlanMode";

function okEnvelope(active: boolean, allActiveCount: number) {
  return {
    data: {
      status: "ok",
      data: {
        active,
        umo: "webchat:FriendMessage:webchat!admin!c1",
        all_active_count: allActiveCount,
        changed: true,
      },
    },
  };
}

beforeEach(() => {
  postMock.mockReset();
  useSpcodePlanMode().reset();
});

describe("setPlanMode", () => {
  it("POSTs umo+active to spcode/plan-mode and adopts the response state", async () => {
    postMock.mockResolvedValue(okEnvelope(true, 3));
    const umo = "webchat:FriendMessage:webchat!admin!c1";

    const ok = await useSpcodePlanMode().setPlanMode(umo, true);

    expect(ok).toBe(true);
    expect(postMock).toHaveBeenCalledWith("spcode/plan-mode", {
      umo,
      active: true,
    });
    const s = useSpcodePlanMode().status.value;
    expect(s.active).toBe(true);
    expect(s.umo).toBe(umo);
    expect(s.allActiveCount).toBe(3);
  });

  it("returns false and keeps prior state when the POST fails", async () => {
    postMock.mockRejectedValue(new Error("404 Not Found"));
    const { status, setActive, setPlanMode } = useSpcodePlanMode();
    setActive(true); // pretend a previous session left plan mode on
    const before = status.value;

    const ok = await setPlanMode("umo-x", false);

    expect(ok).toBe(false);
    expect(status.value).toEqual(before);
  });

  it("returns false when the envelope carries no data", async () => {
    postMock.mockResolvedValue({ data: { status: "error" } });

    const ok = await useSpcodePlanMode().setPlanMode("umo-x", true);

    expect(ok).toBe(false);
  });
});
