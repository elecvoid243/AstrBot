// Author: elecvoid243, 2026-08-09
// Spec: docs/superpowers/specs/2026-08-09-sidebar-drag-file-reference-design.md §4.1
// Store semantics + the exact LLM-facing block format. The block shape
// asserted here is the contract that utils/parseFileReferences.ts parses
// back out of stored history — if one changes, the other must too.
import { describe, expect, it } from "vitest";
import { useFileReferences } from "@/composables/useFileReferences";

describe("useFileReferences", () => {
  it("adds, dedupes by path, removes, and clears references", () => {
    const store = useFileReferences();
    store.clearAll();
    const first = store.addReference("D:\\a\\foo.py", "foo.py");
    const dup = store.addReference("D:\\a\\foo.py", "foo.py");
    store.addReference("D:\\a\\bar.md", "bar.md");
    expect(store.totalCount.value).toBe(2);
    expect(dup?.id).toBe(first?.id);
    store.removeReference(first!.id);
    expect(store.totalCount.value).toBe(1);
    expect(store.references[0].path).toBe("D:\\a\\bar.md");
    store.clearAll();
    expect(store.totalCount.value).toBe(0);
  });

  it("addReference rejects empty path or name", () => {
    const store = useFileReferences();
    store.clearAll();
    expect(store.addReference("", "x")).toBeNull();
    expect(store.addReference("p", "")).toBeNull();
    expect(store.totalCount.value).toBe(0);
  });

  it("formatForLLM returns empty string when no references", () => {
    const store = useFileReferences();
    store.clearAll();
    expect(store.formatForLLM()).toBe("");
  });

  it("formatForLLM emits the exact LLM-facing block", () => {
    const store = useFileReferences();
    store.clearAll();
    store.addReference("D:\\a\\foo.py", "foo.py");
    store.addReference("/home/user/notes.md", "notes.md");
    expect(store.formatForLLM()).toBe(
      [
        "[Referenced files]",
        "The user referenced the following file(s) by absolute path. Read them yourself with your file tools before answering.",
        "- `D:\\a\\foo.py`",
        "- `/home/user/notes.md`",
      ].join("\n"),
    );
  });

  it("resetForSession clears all references", () => {
    const store = useFileReferences();
    store.clearAll();
    store.addReference("D:\\a\\foo.py", "foo.py");
    store.resetForSession();
    expect(store.totalCount.value).toBe(0);
  });
});
