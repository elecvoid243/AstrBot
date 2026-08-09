// Author: elecvoid243, 2026-08-09
// Parser for the "[Referenced files]" block that the dashboard appends to
// outgoing user messages (see useFileReferences.formatForLLM). Same
// rationale as parseFileReviewComments.ts: the block is stored verbatim
// in the message history, so parsing it back into structured data lets
// the chat UI render a references card for BOTH freshly sent and
// historical messages — no backend change required.
//
// Grammar (byte-for-byte mirrors formatForLLM):
//   [Referenced files]     <- block marker (first line)
//   <1 prose line for LLM> <- ignored for display
//   - `<abs path>`         <- one line per reference

/** The parsed references block plus the user's free-form text before it. */
export interface FileReferencesBlock {
  userText: string;
  /** Absolute paths in send order. */
  paths: string[];
}

const BLOCK_MARKER = "[Referenced files]";
const ENTRY = /^- `(.+)`\s*$/;

/**
 * Parse a user message that may end with a "[Referenced files]" block.
 *
 * Returns `null` when the marker is absent or no entry line could be
 * parsed, so callers fall back to rendering the raw text unchanged.
 *
 * @param raw - The full plain-text content of a user message part.
 * @returns The structured block, or `null` if not present/parseable.
 */
export function parseFileReferences(raw: string): FileReferencesBlock | null {
  if (!raw) return null;
  const lines = raw.split("\n");
  const start = lines.findIndex((l) => l.trim() === BLOCK_MARKER);
  if (start < 0) return null;

  const userText = lines.slice(0, start).join("\n").trim();
  const paths: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(ENTRY);
    if (m) paths.push(m[1]);
  }
  if (paths.length === 0) return null;
  return { userText, paths };
}
