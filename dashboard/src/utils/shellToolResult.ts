/**
 * Parser for the `astrbot_execute_shell` tool result.
 *
 * The backend returns `json.dumps({"stdout", "stderr", "exit_code"})`,
 * optionally followed by a system-notice suffix (`[SYSTEM NOTICE] …` and/or
 * the tool-result overflow notice).  Two complications:
 *
 * 1. The stdout/stderr content may contain arbitrary `{` / `}` characters,
 *    so the JSON boundary must be located with string-aware brace tracking
 *    (braces inside JSON string literals do not affect the depth).
 * 2. Oversized results are truncated mid-string by the backend overflow
 *    mechanism, producing malformed JSON.  In that case only the genuine
 *    system-notice suffix should be treated as "extra" — never the whole
 *    result text (which would duplicate the entire output in the UI).
 */

import { findSystemNoticeIndex } from "@/utils/systemNotice";

export interface ShellToolResult {
  /** The parsed result object, or null when the JSON is truncated/malformed. */
  json: Record<string, unknown> | null;
  /** Trailing non-JSON content (system notices), or null when absent. */
  extra: string | null;
}

/**
 * Parse a shell tool result into its JSON payload and trailing notice text.
 *
 * @param text  The raw tool result text.
 * @returns The parsed JSON object and the optional notice suffix.
 */
export function parseShellToolResult(text: string): ShellToolResult {
  const start = text.indexOf("{");
  if (start < 0) {
    // Not a JSON result at all (e.g. "Error executing command: …").
    // Nothing belongs in the extra box — the caller shows the text as-is.
    return { json: null, extra: null };
  }

  // String-aware brace tracking: braces inside JSON string literals
  // (e.g. within stdout content) must not affect the depth.
  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end >= 0) {
    try {
      const parsed = JSON.parse(text.slice(start, end));
      if (parsed && typeof parsed === "object") {
        return { json: parsed, extra: text.slice(end).trim() || null };
      }
    } catch {
      // Not valid JSON — fall through to the notice-splitting fallback.
    }
  }

  // The JSON is truncated or malformed (e.g. oversized output cut mid-string
  // by the backend overflow mechanism).  Split off any genuine system-notice
  // suffix so ONLY the notice goes to the extra box, not the whole result.
  const noticeIdx = findSystemNoticeIndex(text);
  return {
    json: null,
    extra: noticeIdx >= 0 ? text.slice(noticeIdx).trim() : null,
  };
}
