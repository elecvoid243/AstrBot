// Author: elecvoid243, 2026-08-13
// Regression/source-contract tests for the sidebar file-browser
// drag-to-reference entry rules. Same style as ChatTodoSummaryBar.spec.ts
// and UserPlainMessagePart.spec.ts: no component-mount harness exists
// for this file, so we assert the source wiring directly.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readSiblingSource(filename: string): string {
  return readFileSync(fileURLToPath(new URL(filename, import.meta.url)), "utf8");
}

describe("FileBrowserEntryList drag-to-reference entry rules", () => {
  it("allows directories to be dragged (2026-08-13)", () => {
    const source = readSiblingSource("./FileBrowserEntryList.vue");
    // Files and directories are both referenceable; only dangling
    // symlinks stay undraggable.
    expect(source).toMatch(
      /if \(entry\.type === "file"\) return true;[\s\S]*?if \(entry\.type === "directory"\) return true;/,
    );
  });

  it("still rejects dangling symlinks", () => {
    const source = readSiblingSource("./FileBrowserEntryList.vue");
    expect(source).toContain(
      'if (entry.type === "symlink" && entry.target_exists !== false) return true;',
    );
    expect(source).toMatch(/Dangling symlinks? remain NOT draggable/);
  });

  it("keeps the cursor cue keyed off the same drag predicate", () => {
    const source = readSiblingSource("./FileBrowserEntryList.vue");
    // The template binds :draggable and the .is-draggable cursor class to
    // canDragEntry, so directories automatically get the grab cursor.
    expect(source).toMatch(/:draggable="canDragEntry\(entry\)"/);
    expect(source).toMatch(/'is-draggable': canDragEntry\(entry\),/);
  });
});
