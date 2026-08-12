// Author: elecvoid243 @ 2026-08-12
// API doc: astrbot_plugin_spcode_toolkit docs/api/webapi-git-pull-push-remote-api.md
import { describe, it, expect } from "vitest";
import {
  parseSpcodeGitPull,
  parseSpcodeGitPush,
  parseSpcodeGitRemoteSetUrl,
  buildPullBody,
  buildPushBody,
  buildRemoteSetUrlBody,
  classifyPullReason,
  classifyPushReason,
  classifyRemoteReason,
} from "../parseSpcodeGitRemoteSync";

function envelope(data: Record<string, unknown>) {
  return { status: "ok", data };
}

describe("parseSpcodeGitPull", () => {
  it("parses an updated pull", () => {
    const r = parseSpcodeGitPull(
      envelope({
        success: true,
        pulled: true,
        updated: true,
        mode: "merge",
        remote: "origin",
        branch: "main",
        before_sha: "1111111",
        after_sha: "2222222",
        fast_forward: true,
        files_touched: ["src/app.py"],
        upstream: "origin/main",
        reason: null,
        stderr: "",
        elapsed_ms: 230,
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      updated: true,
      mode: "merge",
      remote: "origin",
      branch: "main",
      beforeSha: "1111111",
      afterSha: "2222222",
      fastForward: true,
      filesTouched: ["src/app.py"],
      upstream: "origin/main",
    });
  });

  it("parses an already-up-to-date pull as ok with updated=false", () => {
    const r = parseSpcodeGitPull(
      envelope({
        success: true,
        pulled: false,
        updated: false,
        mode: "merge",
        remote: "origin",
        branch: "main",
        reason: null,
        stderr: "",
        elapsed_ms: 180,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.updated).toBe(false);
  });

  it("parses a merge conflict with conflicted file paths", () => {
    const r = parseSpcodeGitPull(
      envelope({
        success: false,
        reason: "merge_conflict",
        operation: "merge",
        conflicted_files: [{ path: "src/app.py", status: "UU" }],
        stderr: "CONFLICT",
        elapsed_ms: 260,
      }),
    );
    expect(r).toMatchObject({
      ok: false,
      reason: "merge_conflict",
      conflict: true,
      conflictedFiles: ["src/app.py"],
      stderr: "CONFLICT",
    });
  });

  it("flags rebase_conflict as conflict too", () => {
    const r = parseSpcodeGitPull(
      envelope({ success: false, reason: "rebase_conflict", stderr: "" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflict).toBe(true);
  });

  it("maps success:false without reason to unknown", () => {
    const r = parseSpcodeGitPull(envelope({ success: false }));
    expect(r).toMatchObject({ ok: false, reason: "unknown" });
  });

  it("throws on a malformed envelope", () => {
    expect(() => parseSpcodeGitPull({ status: "error" })).toThrow();
  });
});

describe("parseSpcodeGitPush", () => {
  it("parses a first push that sets upstream", () => {
    const r = parseSpcodeGitPush(
      envelope({
        success: true,
        pushed: true,
        set_upstream: true,
        remote: "origin",
        branch: "main",
        remote_branch: "origin/main",
        upstream: "origin/main",
        reason: null,
        stderr: "",
        elapsed_ms: 320,
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      pushed: true,
      setUpstream: true,
      remoteBranch: "origin/main",
      upstream: "origin/main",
    });
  });

  it("parses an in-sync push as ok with pushed=false", () => {
    const r = parseSpcodeGitPush(
      envelope({
        success: true,
        pushed: false,
        set_upstream: false,
        reason: null,
        stderr: "",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pushed).toBe(false);
  });

  it("parses non_fast_forward rejection", () => {
    const r = parseSpcodeGitPush(
      envelope({
        success: false,
        reason: "non_fast_forward",
        pushed: false,
        stderr: "! [rejected] main -> main (fetch first)",
      }),
    );
    expect(r).toMatchObject({ ok: false, reason: "non_fast_forward" });
  });
});

describe("parseSpcodeGitRemoteSetUrl", () => {
  it.each(["added", "updated", "unchanged"])("parses action=%s", (action) => {
    const r = parseSpcodeGitRemoteSetUrl(
      envelope({
        success: true,
        configured: true,
        action,
        remote: "origin",
        url: "https://example.com/org/repo.git",
        reason: null,
        stderr: "",
      }),
    );
    expect(r).toMatchObject({ ok: true, action, remote: "origin" });
  });

  it("parses invalid_url failure", () => {
    const r = parseSpcodeGitRemoteSetUrl(
      envelope({ success: false, reason: "invalid_url", stderr: "" }),
    );
    expect(r).toMatchObject({ ok: false, reason: "invalid_url" });
  });
});

describe("body builders", () => {
  it("buildPullBody emits snake_case flags and omits empty remote/branch", () => {
    expect(buildPullBody({ ffOnly: true })).toEqual({
      ff_only: true,
      rebase: false,
    });
    expect(
      buildPullBody({ remote: "origin", branch: "main", rebase: true }),
    ).toEqual({
      remote: "origin",
      branch: "main",
      ff_only: false,
      rebase: true,
    });
  });

  it("buildPushBody omits empty remote/branch", () => {
    expect(buildPushBody({})).toEqual({});
    expect(buildPushBody({ remote: "origin" })).toEqual({ remote: "origin" });
  });

  it("buildRemoteSetUrlBody defaults remote to origin", () => {
    expect(buildRemoteSetUrlBody({ url: "u" })).toEqual({
      url: "u",
      remote: "origin",
    });
  });
});

describe("reason classifiers", () => {
  it("classifies pull conflicts as warning", () => {
    expect(classifyPullReason("merge_conflict").color).toBe("warning");
    expect(classifyPullReason("rebase_conflict").color).toBe("warning");
  });

  it("classifies non_fast_forward as warning, preflight as git_error", () => {
    expect(classifyPushReason("non_fast_forward").color).toBe("warning");
    expect(classifyPushReason("not_a_git_repo").i18nKey).toContain("git_error");
  });

  it("falls back to unknown with withReason", () => {
    expect(classifyPullReason("some_new_code").withReason).toBe(true);
    expect(classifyRemoteReason(null).i18nKey).toContain("unknown");
  });
});
