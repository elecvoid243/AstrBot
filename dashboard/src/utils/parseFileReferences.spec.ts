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

  it("parses references when a comments block precedes them", () => {
    // Combined message layout mirrors the send-time concat in Chat.vue:
    // [userText][comments block][references block]. The references
    // marker sits AFTER the comments block, so a parser that only
    // looked at the comments parser's userText would miss it — this
    // locks in that parseFileReferences scans the FULL text.
    const commentsBlock = [
      "[File review comments]",
      "`F:\\a\\main.py` line 25:",
      "````",
      "  >   25 │     x = 1",
      "         │ Comment: hello",
      "````",
    ].join("\n");
    const r = parseFileReferences(`${commentsBlock}\n\n${BLOCK}`);
    expect(r).not.toBeNull();
    expect(r!.paths).toEqual([
      "D:\\AstrbotWorkSpace\\foo.py",
      "/home/user/notes.md",
    ]);
  });
});
