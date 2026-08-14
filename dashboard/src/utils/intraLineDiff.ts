/**
 * intraLineDiff — intra-line (word-level) diff for paired del/add
 * lines (2026-08-14). Lets users spot *what* changed inside a
 * modified line instead of only seeing whole-line red/green rows.
 *
 * Algorithm (dependency-free, bounded cost):
 *   1. Trim the common character prefix/suffix (O(N)).
 *   2. Tokenize the differing middles into words
 *      (identifier chars / whitespace / punctuation runs).
 *   3. LCS over the word arrays; matching words are "unchanged",
 *      the rest are "changed".
 *
 * Performance guards (evaluated before implementation):
 *   - Middles longer than MAX_MIDDLE_CHARS or with more than
 *     MAX_WORDS tokens fall back to prefix/suffix trimming only
 *     (whole middle marked changed) — this caps the O(W1*W2) LCS
 *     matrix at 300*300 entries and keeps minified-file lines cheap.
 *   - Callers should additionally cap the total changed characters
 *     per diff (DiffPreview uses 200k, mirroring HIGHLIGHT_MAX_CHARS).
 *
 * Author: elecvoid243 | 2026-08-14
 */

export interface IntraLineSegment {
  text: string;
  changed: boolean;
}

export interface IntraLineSegments {
  oldSegments: IntraLineSegment[];
  newSegments: IntraLineSegment[];
}

/** Middles longer than this skip the word LCS (prefix/suffix only). */
export const INTRA_LINE_MAX_MIDDLE_CHARS = 500;
/** Word arrays longer than this skip the word LCS. */
export const INTRA_LINE_MAX_WORDS = 300;

// Word tokens: identifier runs, whitespace runs, or punctuation runs.
// Keeping whitespace as its own tokens lets the LCS align "foo bar"
// vs "foo  bar" without marking the words themselves as changed.
const WORD_RE = /[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]+/g;

function tokenize(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

/** Longest shared character prefix length of a and b. */
function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** Longest shared character suffix length that does not overlap the
 *  already-consumed prefix of either string. */
function commonSuffixLen(a: string, b: string, prefixLen: number): number {
  const max = Math.min(a.length, b.length) - prefixLen;
  let i = 0;
  while (
    i < max &&
    a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)
  ) {
    i++;
  }
  return i;
}

/** Merge consecutive segments with the same `changed` flag. */
function mergeSegments(segs: IntraLineSegment[]): IntraLineSegment[] {
  const out: IntraLineSegment[] = [];
  for (const seg of segs) {
    if (!seg.text) continue;
    const last = out[out.length - 1];
    if (last && last.changed === seg.changed) {
      last.text += seg.text;
    } else {
      out.push({ text: seg.text, changed: seg.changed });
    }
  }
  return out;
}

/** Word-level LCS on the two middles; returns the segments of each
 *  side (without the shared prefix/suffix, which callers re-attach). */
function diffMiddleWords(
  aMid: string,
  bMid: string,
): { aSegs: IntraLineSegment[]; bSegs: IntraLineSegment[] } {
  const aWords = tokenize(aMid);
  const bWords = tokenize(bMid);
  if (
    aWords.length > INTRA_LINE_MAX_WORDS ||
    bWords.length > INTRA_LINE_MAX_WORDS
  ) {
    return {
      aSegs: [{ text: aMid, changed: true }],
      bSegs: [{ text: bMid, changed: true }],
    };
  }

  // dp[i][j] = LCS length of aWords[i:] and bWords[j:].
  const rows = aWords.length + 1;
  const cols = bWords.length + 1;
  const dp = new Int32Array(rows * cols);
  for (let i = aWords.length - 1; i >= 0; i--) {
    for (let j = bWords.length - 1; j >= 0; j--) {
      dp[i * cols + j] =
        aWords[i] === bWords[j]
          ? dp[(i + 1) * cols + j + 1] + 1
          : Math.max(dp[(i + 1) * cols + j], dp[i * cols + j + 1]);
    }
  }

  // Backtrack: equal words are unchanged on both sides; otherwise
  // consume from the side whose skip keeps the larger LCS.
  const aSegs: IntraLineSegment[] = [];
  const bSegs: IntraLineSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < aWords.length && j < bWords.length) {
    if (aWords[i] === bWords[j]) {
      aSegs.push({ text: aWords[i], changed: false });
      bSegs.push({ text: bWords[j], changed: false });
      i++;
      j++;
    } else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) {
      aSegs.push({ text: aWords[i], changed: true });
      i++;
    } else {
      bSegs.push({ text: bWords[j], changed: true });
      j++;
    }
  }
  while (i < aWords.length) aSegs.push({ text: aWords[i++], changed: true });
  while (j < bWords.length) bSegs.push({ text: bWords[j++], changed: true });
  return { aSegs, bSegs };
}

/**
 * Compute intra-line segments for a paired (old, new) line. Each
 * side's segments concatenate back to its original text.
 */
export function computeIntraLineSegments(
  oldText: string,
  newText: string,
): IntraLineSegments {
  if (oldText === newText) {
    return {
      oldSegments: [{ text: oldText, changed: false }],
      newSegments: [{ text: newText, changed: false }],
    };
  }

  const prefixLen = commonPrefixLen(oldText, newText);
  const suffixLen = commonSuffixLen(oldText, newText, prefixLen);
  const prefix = oldText.slice(0, prefixLen);
  const suffix = suffixLen ? oldText.slice(oldText.length - suffixLen) : "";
  const aMid = oldText.slice(prefixLen, oldText.length - suffixLen);
  const bMid = newText.slice(prefixLen, newText.length - suffixLen);

  let aMidSegs: IntraLineSegment[];
  let bMidSegs: IntraLineSegment[];
  if (
    aMid.length > INTRA_LINE_MAX_MIDDLE_CHARS ||
    bMid.length > INTRA_LINE_MAX_MIDDLE_CHARS
  ) {
    // Long-middle fallback: prefix/suffix trim only.
    aMidSegs = [{ text: aMid, changed: true }];
    bMidSegs = [{ text: bMid, changed: true }];
  } else {
    const middle = diffMiddleWords(aMid, bMid);
    aMidSegs = middle.aSegs;
    bMidSegs = middle.bSegs;
  }

  const unchanged = (text: string): IntraLineSegment[] =>
    text ? [{ text, changed: false }] : [];
  return {
    oldSegments: mergeSegments([
      ...unchanged(prefix),
      ...aMidSegs,
      ...unchanged(suffix),
    ]),
    newSegments: mergeSegments([
      ...unchanged(prefix),
      ...bMidSegs,
      ...unchanged(suffix),
    ]),
  };
}
