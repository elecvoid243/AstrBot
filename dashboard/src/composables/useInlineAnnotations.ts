// Author: elecvoid243, 2026-07-30
// Inline annotations store for the "Ask Inline" feature.
// Module-level singleton (same pattern as useFileComments) so
// FileBrowserFilePreview, DocumentManager, and FileBrowserCodeView
// all share the same reactive state without provide/inject.
//
// Each annotation represents a user question about a selected text
// range, plus the LLM's reply (or loading/error state). Annotations
// are session-scoped: resetForSession() drops them all.

import { reactive, computed } from "vue";

/** A single inline annotation anchored to a text range. */
export interface InlineAnnotation {
  /** UUID, stable across edits/deletes. */
  id: string;
  /** Absolute file path. */
  filePath: string;
  /** 1-based start line of the selection. */
  startLine: number;
  /** 1-based end line of the selection. */
  endLine: number;
  /** Verbatim selected text at annotation time. */
  selection: string;
  /** The user's question / command text. */
  question: string;
  /** LLM reply text. Null while loading or on error. */
  reply: string | null;
  /** True while the LLM request is in-flight. */
  loading: boolean;
  /** Error message if the request failed. Null on success/loading. */
  error: string | null;
  createdAt: number;
}

// ── Module-level singleton state ──────────────────────────────────
const annotations = reactive<Map<string, InlineAnnotation>>(new Map());

function genId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

/**
 * Composable for managing inline annotations (Ask Inline feature).
 *
 * Returns reactive accessors and mutators. All consumers share the
 * same underlying Map, so mutations in one component are immediately
 * visible in another.
 */
export function useInlineAnnotations() {
  /** All annotations for a given file path. */
  function annotationsForFile(filePath: string): InlineAnnotation[] {
    const result: InlineAnnotation[] = [];
    for (const a of annotations.values()) {
      if (a.filePath === filePath) result.push(a);
    }
    return result;
  }

  /** Check whether a given line is covered by any annotation. */
  function annotationCoversLine(
    ann: InlineAnnotation,
    line: number,
  ): boolean {
    return line >= ann.startLine && line <= ann.endLine;
  }

  /** Find the first annotation covering a line in a file. */
  function annotationForLine(
    filePath: string,
    line: number,
  ): InlineAnnotation | null {
    for (const a of annotations.values()) {
      if (a.filePath === filePath && annotationCoversLine(a, line)) return a;
    }
    return null;
  }

  /** Find annotation by id. */
  function findAnnotation(id: string): InlineAnnotation | undefined {
    return annotations.get(id);
  }

  /**
   * Create a new annotation in loading state.
   *
   * Args:
   *   filePath: Absolute file path.
   *   startLine: 1-based start line.
   *   endLine: 1-based end line.
   *   selection: Verbatim selected text.
   *   question: User's question text.
   *
   * Returns:
   *   The created InlineAnnotation.
   */
  function addAnnotation(params: {
    filePath: string;
    startLine: number;
    endLine: number;
    selection: string;
    question: string;
  }): InlineAnnotation {
    const ann: InlineAnnotation = {
      id: genId(),
      filePath: params.filePath,
      startLine: params.startLine,
      endLine: params.endLine,
      selection: params.selection,
      question: params.question,
      reply: null,
      loading: true,
      error: null,
      createdAt: Date.now(),
    };
    annotations.set(ann.id, ann);
    return ann;
  }

  /** Update the LLM reply for an annotation (success). */
  function setReply(id: string, reply: string): void {
    const ann = annotations.get(id);
    if (!ann) return;
    ann.reply = reply;
    ann.loading = false;
    ann.error = null;
  }

  /** Mark an annotation as failed. */
  function setError(id: string, error: string): void {
    const ann = annotations.get(id);
    if (!ann) return;
    ann.error = error;
    ann.loading = false;
  }

  /** Delete an annotation by id. */
  function deleteAnnotation(id: string): void {
    annotations.delete(id);
  }

  /** Total annotation count across all files. */
  const totalCount = computed(() => annotations.size);

  /** Clear all annotations (e.g. on session switch). */
  function resetForSession(): void {
    annotations.clear();
  }

  return {
    annotationsForFile,
    annotationCoversLine,
    annotationForLine,
    findAnnotation,
    addAnnotation,
    setReply,
    setError,
    deleteAnnotation,
    totalCount,
    resetForSession,
  };
}
