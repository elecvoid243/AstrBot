// Author: elecvoid243 @ 2026-08-13
// Spec: astrbot_plugin_spcode_toolkit
//   docs/superpowers/specs/2026-08-13-git-commit-amend-frontend-design.md
import { describe, it, expect } from "vitest";
import { parseSpcodeGitCommitAmend } from "../parseSpcodeGitWorkflow";

describe("parseSpcodeGitCommitAmend", () => {
  it("parses a successful amend envelope", () => {
    const result = parseSpcodeGitCommitAmend({
      status: "ok",
      data: {
        success: true,
        amended: true,
        before_sha: "a".repeat(40),
        after_sha: "b".repeat(40),
        subject: "fix: updated",
        message: "fix: updated\n\nbody",
        reason: null,
        stderr: "",
        elapsed_ms: 5,
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.snapshot.success).toBe(true);
    expect(result.snapshot.amended).toBe(true);
    expect(result.snapshot.beforeSha).toBe("a".repeat(40));
    expect(result.snapshot.afterSha).toBe("b".repeat(40));
    expect(result.snapshot.subject).toBe("fix: updated");
    expect(result.snapshot.message).toBe("fix: updated\n\nbody");
  });

  it("parses a failure envelope and keeps the reason", () => {
    const result = parseSpcodeGitCommitAmend({
      status: "ok",
      data: {
        success: false,
        amended: false,
        reason: "staged_changes_present",
        stderr: "working tree has staged changes",
        elapsed_ms: 5,
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.snapshot.success).toBe(false);
    expect(result.snapshot.amended).toBe(false);
    expect(result.snapshot.reason).toBe("staged_changes_present");
    expect(result.snapshot.stderr).toBe("working tree has staged changes");
  });

  it("treats missing success with null reason as success (canonical envelope)", () => {
    const result = parseSpcodeGitCommitAmend({
      status: "ok",
      data: {
        amended: true,
        after_sha: "b".repeat(40),
        reason: null,
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.snapshot.success).toBe(true);
    expect(result.snapshot.amended).toBe(true);
  });
});
