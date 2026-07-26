import { describe, expect, it } from "vitest";
import { parseShellToolResult } from "@/utils/shellToolResult";

const OVERFLOW =
  "Truncated tool output preview shown above. " +
  "The tool output was too large to include directly and was written to " +
  "`F:\\tmp\\overflow.txt`. Use astrbot_file_read_tool to inspect it. " +
  "Use a narrower window when reading large files.";

const NOTICE =
  "[SYSTEM NOTICE] By the way, you have executed the same tool " +
  "`astrbot_execute_shell` with the same arguments 3 times consecutively.";

function makeResult(stdout: string, stderr = "", exitCode = 0): string {
  return JSON.stringify({ stdout, stderr, exit_code: exitCode });
}

describe("parseShellToolResult", () => {
  it("parses a plain JSON result", () => {
    const r = parseShellToolResult(makeResult("hello\nworld"));
    expect(r.json).toEqual({ stdout: "hello\nworld", stderr: "", exit_code: 0 });
    expect(r.extra).toBeNull();
  });

  it("splits a trailing system notice from valid JSON", () => {
    const r = parseShellToolResult(`${makeResult("ok")}\n\n${NOTICE}`);
    expect(r.json?.stdout).toBe("ok");
    expect(r.extra).toBe(NOTICE);
  });

  it("handles unbalanced braces inside string values", () => {
    const r1 = parseShellToolResult(makeResult('example: "params": { then more'));
    expect(r1.json?.stdout).toBe('example: "params": { then more');

    const r2 = parseShellToolResult(makeResult("closes early } oops"));
    expect(r2.json?.stdout).toBe("closes early } oops");

    const r3 = parseShellToolResult(makeResult("both } and { mixed }}{"));
    expect(r3.json?.stdout).toBe("both } and { mixed }}{");
  });

  it("handles escaped quotes and backslashes inside strings", () => {
    const stdout = 'path "C:\\\\Program Files\\\\{app}" \\"quoted\\"';
    const r = parseShellToolResult(makeResult(stdout));
    expect(r.json?.stdout).toBe(stdout);
  });

  it("treats only the overflow notice as extra when JSON is truncated", () => {
    const full = makeResult("x".repeat(1000));
    const truncated = full.slice(0, full.length / 2);
    const r = parseShellToolResult(`${truncated}\n\n${OVERFLOW}`);
    expect(r.json).toBeNull();
    // The grey extra box must show ONLY the notice, never the whole result.
    expect(r.extra).toBe(OVERFLOW);
  });

  it("treats only the system notice as extra when JSON is truncated", () => {
    const full = makeResult("y".repeat(1000));
    const truncated = full.slice(0, full.length / 2);
    const r = parseShellToolResult(`${truncated}\n\n${NOTICE}`);
    expect(r.json).toBeNull();
    expect(r.extra).toBe(NOTICE);
  });

  it("returns null extra for truncated JSON without any notice", () => {
    const full = makeResult("z".repeat(1000));
    const r = parseShellToolResult(full.slice(0, full.length / 2));
    expect(r.json).toBeNull();
    expect(r.extra).toBeNull();
  });

  it("returns null extra for non-JSON error text", () => {
    const r = parseShellToolResult("Error executing command: boom");
    expect(r.json).toBeNull();
    expect(r.extra).toBeNull();
  });
});
