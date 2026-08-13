// Author: elecvoid243, 2026-08-09
// Spec: docs/superpowers/specs/2026-08-09-sidebar-drag-file-reference-design.md §4.1
//
// In-memory store for sidebar-drag file references. A reference is just
// an absolute path + basename: at send time Chat.vue appends
// formatForLLM()'s "[Referenced files]" block to the outgoing message so
// the agent reads the files itself — nothing is uploaded.
//
// Module-level singleton (same rationale as useFileComments): ChatInput
// (chip row) and Chat.vue (send path) live in the same tree but are
// separate components; a singleton avoids prop drilling without Pinia.
import { computed, reactive } from "vue";

export interface FileReference {
  /** UUID, stable until removal. */
  id: string;
  /** Absolute path. Dedup key. */
  path: string;
  /** Basename shown on the chip. */
  name: string;
}

let _instance: ReturnType<typeof createFileReferences> | null = null;

function createFileReferences() {
  const references = reactive<FileReference[]>([]);
  const totalCount = computed(() => references.length);

  function newId(): string {
    return (
      (globalThis.crypto?.randomUUID?.() as string | undefined) ??
      `${Date.now()}-${Math.random()}`
    );
  }

  /** Add a reference; deduped by absolute path (repeat drags are no-ops
   *  returning the existing entry). Returns null for empty input. */
  function addReference(path: string, name: string): FileReference | null {
    if (!path || !name) return null;
    const existing = references.find((r) => r.path === path);
    if (existing) return existing;
    const entry: FileReference = { id: newId(), path, name };
    references.push(entry);
    return entry;
  }

  function removeReference(id: string): void {
    const idx = references.findIndex((r) => r.id === id);
    if (idx >= 0) references.splice(idx, 1);
  }

  /** Clear everything. Called by Chat.vue after a successful send (spec
   *  decision D3: references are per-message attachments). */
  function clearAll(): void {
    references.splice(0, references.length);
  }

  /** Session-switch hook, named for parity with
   *  useFileComments.resetForSession. */
  function resetForSession(): void {
    clearAll();
  }

  /** Render the LLM-facing block appended to the outgoing user message.
   *  Returns "" when there are no references. The output shape is the
   *  contract parsed back by utils/parseFileReferences.ts — keep the two
   *  byte-for-byte aligned. 2026-08-13: directories are referenceable
   *  too; the prose tells the agent to read files or list directories
   *  (the parser ignores the prose line, so old messages still parse). */
  function formatForLLM(): string {
    if (references.length === 0) return "";
    const lines = [
      "[Referenced files]",
      "The user referenced the following file(s) or directory(ies) by absolute path. Read each file or list each directory yourself with your file tools before answering.",
    ];
    for (const r of references) lines.push(`- \`${r.path}\``);
    return lines.join("\n");
  }

  return {
    references,
    totalCount,
    addReference,
    removeReference,
    clearAll,
    resetForSession,
    formatForLLM,
  };
}

export function useFileReferences() {
  if (!_instance) _instance = createFileReferences();
  return _instance;
}
