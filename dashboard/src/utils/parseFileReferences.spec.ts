// Author: elecvoid243, 2026-08-09
// Sample blocks mirror useFileReferences.formatForLLM byte-for-byte, so
// the fixtures below are exactly the shape the backend stores in history.
import { describe, expect, it } from "vitest";
import { parseFileReferences } from "@/utils/parseFileReferences";

const BLOCK = [
  "[Referenced files]",
  "The user referenced the following file(s) by absolute path. Read them yourself with your file tools before answering.",
  "- `D:\\AstrbotWorkSpace\\foo.py`",
  "- `/home/user/notes.md`",
].join("\n");

describe("parseFileReferences", () => {
  it("returns null when the marker is absent", () => {
    expect(parseFileReferences("just a normal message")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseFileReferences("")).toBeNull();
  });

  it("returns null when the block has no entries", () => {
    expect(parseFileReferences("[Referenced files]\nsome prose")).toBeNull();
  });

  it("parses a block-only message", () => {
    const r = parseFileReferences(BLOCK);
    expect(r).not.toBeNull();
    expect(r!.userText).toBe("");
    expect(r!.paths).toEqual([
      "D:\\AstrbotWorkSpace\\foo.py",
      "/home/user/notes.md",
    ]);
  });

  it("splits user text from the block", () => {
    const r = parseFileReferences(`please read these\n\n${BLOCK}`);
    expect(r!.userText).toBe("please read these");
    expect(r!.paths).toHaveLength(2);
  });

  it("keeps special characters in paths verbatim", () => {
    const r = parseFileReferences(
      "[Referenced files]\n- `C:\\weird dir\\my file (v2).ts`",
    );
    expect(r!.paths).toEqual(["C:\\weird dir\\my file (v2).ts"]);
  });
});
