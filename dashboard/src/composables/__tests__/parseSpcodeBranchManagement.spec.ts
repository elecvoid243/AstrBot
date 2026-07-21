import { describe, it, expect } from "vitest";
import {
  parseSpcodeBranchSwitch,
  parseSpcodeBranchCreate,
  parseSpcodeBranchDelete,
  classifyBranchReason,
  type BranchMgmtEndpoint,
} from "../parseSpcodeBranchManagement";

const successEnvelope = (data: unknown) => ({
  status: "ok",
  data: { ...data, reason: null, stderr: "", elapsed_ms: 50 },
});

describe("parseSpcodeBranchSwitch", () => {
  it("returns ok snapshot on success", () => {
    const raw = successEnvelope({
      loaded: true,
      directory: "D:/repo",
      umo: "u1",
      switched: true,
      name: "feature/x",
      previous: "main",
      created: false,
      force: false,
      detach: false,
      branches: [
        {
          name: "main",
          sha: "a",
          upstream: "",
          upstream_track: "",
          current: false,
          remote: false,
        },
        {
          name: "feature/x",
          sha: "b",
          upstream: "",
          upstream_track: "",
          current: true,
          remote: false,
        },
      ],
      total: 2,
      current: "feature/x",
      detached: false,
    });
    const r = parseSpcodeBranchSwitch(raw);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.snapshot.switched).toBe(true);
      expect(r.snapshot.name).toBe("feature/x");
      expect(r.snapshot.previous).toBe("main");
      expect(r.snapshot.branches.branches).toHaveLength(2);
    }
  });

  it("returns error on worktree_dirty", () => {
    const raw = {
      status: "ok",
      data: {
        reason: "worktree_dirty",
        stderr: "working tree dirty",
        elapsed_ms: 5,
        loaded: true,
        directory: "D:/repo",
        umo: "u1",
      },
    };
    const r = parseSpcodeBranchSwitch(raw);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.reason).toBe("worktree_dirty");
      expect(r.stderr).toContain("dirty");
    }
  });

  it("returns error on branch_not_found", () => {
    const raw = {
      status: "ok",
      data: {
        reason: "branch_not_found",
        stderr: "",
        elapsed_ms: 5,
        loaded: true,
        directory: "D:/repo",
        umo: "u1",
      },
    };
    const r = parseSpcodeBranchSwitch(raw);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.reason).toBe("branch_not_found");
  });
});

describe("parseSpcodeBranchCreate", () => {
  it("returns ok snapshot on success", () => {
    const raw = successEnvelope({
      loaded: true,
      directory: "D:/repo",
      umo: "u1",
      created: true,
      name: "feat/y",
      start_point: "HEAD",
      force: false,
      sha: "newSha123",
      branches: [
        {
          name: "main",
          sha: "a",
          upstream: "",
          upstream_track: "",
          current: true,
          remote: false,
        },
        {
          name: "feat/y",
          sha: "newSha123",
          upstream: "",
          upstream_track: "",
          current: false,
          remote: false,
        },
      ],
      total: 2,
      current: "main",
      detached: false,
    });
    const r = parseSpcodeBranchCreate(raw);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.snapshot.created).toBe(true);
      expect(r.snapshot.sha).toBe("newSha123");
    }
  });

  it("returns error on branch_exists", () => {
    const raw = {
      status: "ok",
      data: {
        reason: "branch_exists",
        stderr: "already exists",
        elapsed_ms: 5,
        loaded: true,
        directory: "D:/repo",
        umo: "u1",
      },
    };
    const r = parseSpcodeBranchCreate(raw);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.reason).toBe("branch_exists");
  });
});

describe("parseSpcodeBranchDelete", () => {
  it("returns ok snapshot on success", () => {
    const raw = successEnvelope({
      loaded: true,
      directory: "D:/repo",
      umo: "u1",
      deleted: true,
      name: "feat/old",
      force: false,
      was_current: false,
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
    });
    const r = parseSpcodeBranchDelete(raw);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.snapshot.deleted).toBe(true);
      expect(r.snapshot.name).toBe("feat/old");
    }
  });

  it("returns error on branch_is_current", () => {
    const raw = {
      status: "ok",
      data: {
        reason: "branch_is_current",
        stderr: "cannot delete current",
        elapsed_ms: 5,
        loaded: true,
        directory: "D:/repo",
        umo: "u1",
      },
    };
    const r = parseSpcodeBranchDelete(raw);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.reason).toBe("branch_is_current");
  });

  it("returns error on branch_not_merged", () => {
    const raw = {
      status: "ok",
      data: {
        reason: "branch_not_merged",
        stderr: "not fully merged",
        elapsed_ms: 5,
        loaded: true,
        directory: "D:/repo",
        umo: "u1",
      },
    };
    const r = parseSpcodeBranchDelete(raw);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.reason).toBe("branch_not_merged");
  });
});

describe("classifyBranchReason", () => {
  const cases: Array<[BranchMgmtEndpoint, string, boolean]> = [
    ["switch", "worktree_dirty", true],
    ["switch", "branch_not_found", true],
    ["delete", "branch_is_current", true],
    ["delete", "branch_not_merged", true],
    ["create", "branch_exists", true],
    ["create", "invalid_branch", true],
    ["switch", "network", true],
    ["switch", null as unknown as string, true],
    ["switch", "some_unknown_reason", true],
  ];
  for (const [endpoint, reason, expectDefined] of cases) {
    it(`endpoint=${endpoint} reason=${reason} → defined=${expectDefined}`, () => {
      const meta = classifyBranchReason(reason, endpoint);
      expect(meta).toBeDefined();
      expect(typeof meta.i18nKey).toBe("string");
    });
  }
});
