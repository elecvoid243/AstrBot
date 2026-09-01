import { describe, expect, it } from "vitest";
import {
  parseSpcodeTerminalStreamBlock,
  splitSpcodeTerminalBlocks,
} from "./parseSpcodeTerminalStream";

describe("parseSpcodeTerminalStreamBlock", () => {
  it("parses an output event", () => {
    const block = 'data: {"type":"output","data":"hello"}';
    expect(parseSpcodeTerminalStreamBlock(block)).toEqual({
      type: "output",
      data: "hello",
    });
  });

  it("parses an exit event with object data", () => {
    const block = 'data: {"type":"exit","data":{"code":0,"status":"completed"}}';
    const parsed = parseSpcodeTerminalStreamBlock(block);
    expect(parsed?.type).toBe("exit");
    expect((parsed?.data as { code: number }).code).toBe(0);
  });

  it("returns null for heartbeat comment and empty block", () => {
    expect(parseSpcodeTerminalStreamBlock(": hb")).toBeNull();
    expect(parseSpcodeTerminalStreamBlock("")).toBeNull();
  });

  it("returns null for invalid json", () => {
    expect(parseSpcodeTerminalStreamBlock("data: not-json")).toBeNull();
  });
});

describe("splitSpcodeTerminalBlocks", () => {
  it("keeps the incomplete tail in remainder", () => {
    const { blocks, remainder } = splitSpcodeTerminalBlocks(
      'data: {"type":"output","data":"a"}\n\ndata: {"type":"outp',
    );
    expect(blocks).toHaveLength(1);
    expect(remainder).toContain("outp");
  });

  it("handles crlf normalization", () => {
    const { blocks, remainder } = splitSpcodeTerminalBlocks(
      'data: {"type":"output","data":"x"}\r\n\r\n',
    );
    expect(blocks).toHaveLength(1);
    expect(remainder).toBe("");
  });
});
