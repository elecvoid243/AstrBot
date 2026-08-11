// Tests for utils/resolveSessionUmo.ts
// Bug fix (2026-08-11): the project chip above ChatInput stayed stale
// ("宸插姞杞?<previous project>") when clicking a session under a project
// folder that was not the currently selected project. Root cause:
// resolveCurrentUmo only searched the flat session list (which excludes
// project sessions server-side) and the currently selected project's
// session list 鈥?never the projectSessionsById cache that backs every
// visible project folder.
//
// Author: elecvoid243 | 2026-08-11

import { describe, it, expect } from "vitest";
import { resolveSessionUmo } from "@/utils/resolveSessionUmo";

const FLAT = [
  { session_id: "flat-1", platform_id: "webchat", is_group: 0 },
];
const SELECTED_PROJECT = [
  { session_id: "sel-1", platform_id: "webchat", is_group: 0 },
];
const BY_ID = {
  projA: [{ session_id: "a-1", platform_id: "webchat", is_group: 0 }],
  projB: [
    { session_id: "b-1", platform_id: "webchat", is_group: 0 },
    { session_id: "b-group", platform_id: "webchat", is_group: 1 },
  ],
};

describe("resolveSessionUmo", () => {
  it("resolves a session from the flat list", () => {
    const umo = resolveSessionUmo("flat-1", {
      sessions: FLAT,
      projectSessions: [],
      projectSessionsById: {},
    });
    expect(umo).toBe("webchat:FriendMessage:webchat!guest!flat-1");
  });

  it("resolves a session from the selected project's list", () => {
    const umo = resolveSessionUmo("sel-1", {
      sessions: [],
      projectSessions: SELECTED_PROJECT,
      projectSessionsById: {},
    });
    expect(umo).toBe("webchat:FriendMessage:webchat!guest!sel-1");
  });

  it("resolves a session that only exists in the projectSessionsById cache", () => {
    const umo = resolveSessionUmo("b-1", {
      sessions: [],
      projectSessions: SELECTED_PROJECT, // a DIFFERENT project's list
      projectSessionsById: BY_ID,
    });
    expect(umo).toBe("webchat:FriendMessage:webchat!guest!b-1");
  });

  it("builds a GroupMessage umo for group sessions", () => {
    const umo = resolveSessionUmo("b-group", {
      sessions: [],
      projectSessions: [],
      projectSessionsById: BY_ID,
    });
    expect(umo).toBe("webchat:GroupMessage:webchat!guest!b-group");
  });

  it("uses the platform-native format for non-webchat sessions", () => {
    const umo = resolveSessionUmo("qq-1", {
      sessions: [],
      projectSessions: [],
      projectSessionsById: {
        projC: [{ session_id: "qq-1", platform_id: "qq", is_group: 0 }],
      },
    });
    expect(umo).toBe("qq:FriendMessage:qq-1");
  });

  it("returns null for unknown or empty session ids", () => {
    const sources = {
      sessions: FLAT,
      projectSessions: SELECTED_PROJECT,
      projectSessionsById: BY_ID,
    };
    expect(resolveSessionUmo("missing", sources)).toBeNull();
    expect(resolveSessionUmo("", sources)).toBeNull();
  });
});
