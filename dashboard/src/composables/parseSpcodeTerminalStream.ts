/** SSE block parser for the spcode terminal stream endpoint. */

export interface SpcodeTerminalStreamPayload {
  type: "output" | "exit" | "error";
  data: unknown;
}

/** Parse one complete SSE block ("…\n\n" terminated) into a payload. */
export function parseSpcodeTerminalStreamBlock(
  block: string,
): SpcodeTerminalStreamPayload | null {
  let jsonLine = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) {
      jsonLine = line.slice(5).trimStart();
      break;
    }
  }
  if (!jsonLine) return null;
  try {
    const parsed = JSON.parse(jsonLine) as SpcodeTerminalStreamPayload;
    if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
      return parsed;
    }
  } catch {
    /* non-JSON heartbeat leftovers — ignore */
  }
  return null;
}

/** Split an accumulated buffer into complete blocks + the tail. */
export function splitSpcodeTerminalBlocks(buffer: string): {
  blocks: string[];
  remainder: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n\n");
  return {
    blocks: parts.slice(0, -1),
    remainder: parts[parts.length - 1] ?? "",
  };
}
