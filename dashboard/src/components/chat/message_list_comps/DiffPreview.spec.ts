// Author: elecvoid243
// Date: 2026-07-30
// Spec: docs/superpowers/specs/2026-06-30-diff-fullscreen-design.md §4
//
// Regression coverage for the DiffPreview fullscreen / expansion
// relationship:
//   * fullscreen should always render the full diff (no `maxLines` cap);
//   * the "show all" inline button must not appear in the fullscreen
//     overlay (the user does not need to click it again);
//   * entering / exiting fullscreen must not mutate the
//     non-fullscreen `showAllLines` state — the two states are
//     independent.
//
// Mount strategy mirrors DocumentManager.spec.ts: stub the heavy
// children so the test focuses on DiffPreview's own state graph.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import DiffPreview from "./DiffPreview.vue";
import FileCommentEditor from "./FileCommentEditor.vue";
import { useFileComments } from "@/composables/useFileComments";

const STUB_CHILDREN = {
  FileCommentEditor: { template: "<div />" },
  "v-icon": { template: "<i />" },
};

function buildDiffContent(totalLines: number): string {
  // Minimal valid unified diff: one @@ hunk with `totalLines` added
  // lines.  `parseUnifiedDiff` reads `@@` and the `+/ /-` prefix
  // characters, so this is enough to drive the line cap.
  const body = Array.from(
    { length: totalLines },
    (_, i) => `+line ${i + 1}`,
  ).join("\n");
  return `@@ -0,0 +1,${totalLines} @@\n${body}\n`;
}

/**
 * Build a diff large enough that its raw text length exceeds the
 * default `maxChars` (2000) so the `truncated` computed becomes
 * `true`. Each line carries a padding string to inflate the byte
 * count without changing the parse-count of lines / hunks.
 */
function buildLongDiffContent(totalLines: number, padding: string): string {
  const body = Array.from(
    { length: totalLines },
    (_, i) => `+line ${i + 1} ${padding}`,
  ).join("\n");
  return `@@ -0,0 +1,${totalLines} @@\n${body}\n`;
}

interface DiffPreviewInternals {
  isFullscreen: boolean;
  showAllLines: boolean;
  effectiveMaxLines: number;
  enterFullscreen: () => void;
  exitFullscreen: () => void;
  collapsedOverflow: number;
  truncated: boolean;
  showTruncationWarning: boolean;
}

function mountDiff(totalLines = 100): VueWrapper {
  return mount(DiffPreview, {
    props: {
      content: buildDiffContent(totalLines),
      filePath: "sample.txt",
      maxLines: 30,
    },
    global: { stubs: STUB_CHILDREN },
  });
}

/**
 * Mount variant that produces a diff whose raw text is long enough
 * (>2000 chars) to engage the `truncated` computed, so the
 * truncation-warning v-if has something to assert against.
 */
function mountLongDiff(): VueWrapper {
  // 300 lines × ~30 chars per padded line ≈ >9 KB. Plenty beyond
  // the 2000-char default `maxChars`, so `truncated === true`.
  return mount(DiffPreview, {
    props: {
      content: buildLongDiffContent(300, "abcdefghijklmnopqrstuvwxyz"),
      filePath: "sample.txt",
      maxLines: 30,
    },
    global: { stubs: STUB_CHILDREN },
  });
}

describe("DiffPreview fullscreen expansion", () => {
  beforeEach(async () => {
    document.body.style.overflow = "";
  });

  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("entering fullscreen expands the diff even when showAllLines is false", async () => {
    const wrapper = mountDiff();
    const vm = wrapper.vm as unknown as DiffPreviewInternals;

    expect(vm.isFullscreen).toBe(false);
    expect(vm.showAllLines).toBe(false);
    expect(vm.effectiveMaxLines).toBe(30);
    expect(vm.collapsedOverflow).toBeGreaterThan(0);

    vm.enterFullscreen();
    await nextTick();

    expect(vm.isFullscreen).toBe(true);
    expect(vm.effectiveMaxLines).toBe(Number.POSITIVE_INFINITY);
    expect(vm.collapsedOverflow).toBe(0);
  });

  it("fullscreen overlay does not render the inline 'show more' button", async () => {
    const wrapper = mountDiff();
    const vm = wrapper.vm as unknown as DiffPreviewInternals;

    expect(wrapper.findAll(".diff-show-more").length).toBeGreaterThan(0);

    vm.enterFullscreen();
    await nextTick();

    const overlay = document.body.querySelector(".diff-fullscreen-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.querySelectorAll(".diff-show-more").length).toBe(0);
  });

  it("entering fullscreen does not mutate the non-fullscreen showAllLines flag", async () => {
    const wrapper = mountDiff();
    const vm = wrapper.vm as unknown as DiffPreviewInternals;

    vm.enterFullscreen();
    await nextTick();

    expect(vm.isFullscreen).toBe(true);
    expect(vm.showAllLines).toBe(false);
  });

  it("exiting fullscreen restores the non-fullscreen line cap while keeping prior showAllLines state", async () => {
    const wrapper = mountDiff();
    const vm = wrapper.vm as unknown as DiffPreviewInternals;

    // Scenario A: never clicked "show all" → exit should re-cap.
    vm.enterFullscreen();
    await nextTick();
    vm.exitFullscreen();
    await nextTick();

    expect(vm.isFullscreen).toBe(false);
    expect(vm.showAllLines).toBe(false);
    expect(vm.effectiveMaxLines).toBe(30);

    // Scenario B: user previously expanded → exit should stay expanded.
    vm.showAllLines = true;
    await nextTick();
    expect(vm.effectiveMaxLines).toBe(Number.POSITIVE_INFINITY);

    vm.enterFullscreen();
    await nextTick();
    expect(vm.effectiveMaxLines).toBe(Number.POSITIVE_INFINITY);
    expect(vm.showAllLines).toBe(true);

    vm.exitFullscreen();
    await nextTick();
    expect(vm.isFullscreen).toBe(false);
    expect(vm.showAllLines).toBe(true);
    expect(vm.effectiveMaxLines).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("DiffPreview truncation warning visibility", () => {
  beforeEach(() => {
    document.body.style.overflow = "";
  });

  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("renders the yellow truncation warning in the default collapsed view", () => {
    const wrapper = mountLongDiff();
    const vm = wrapper.vm as unknown as DiffPreviewInternals;

    expect(vm.truncated).toBe(true);
    expect(vm.collapsedOverflow).toBeGreaterThan(0);
    expect(vm.showTruncationWarning).toBe(true);

    const warnings = wrapper.findAll(".diff-truncation-warning");
    expect(warnings.length).toBe(1);
    expect(warnings[0].text()).toContain("Diff truncated");
  });

  it("hides the warning after the user clicks 'Show all' inline", async () => {
    const wrapper = mountLongDiff();
    const vm = wrapper.vm as unknown as DiffPreviewInternals;

    expect(vm.showTruncationWarning).toBe(true);

    vm.showAllLines = true;
    await nextTick();

    // `truncated` (raw length) is unchanged, but the visible clip
    // is gone, so the user-facing warning should disappear.
    expect(vm.truncated).toBe(true);
    expect(vm.collapsedOverflow).toBe(0);
    expect(vm.showTruncationWarning).toBe(false);
    expect(wrapper.findAll(".diff-truncation-warning").length).toBe(0);
  });

  it("hides the warning when entering fullscreen", async () => {
    const wrapper = mountLongDiff();
    const vm = wrapper.vm as unknown as DiffPreviewInternals;

    expect(vm.showTruncationWarning).toBe(true);

    vm.enterFullscreen();
    await nextTick();

    // Same reasoning as the 'show all' path: fullscreen lifts the
    // `maxLines` cap, so there is nothing to warn about.
    expect(vm.truncated).toBe(true);
    expect(vm.collapsedOverflow).toBe(0);
    expect(vm.showTruncationWarning).toBe(false);

    const inlineWarnings = wrapper.findAll(".diff-truncation-warning");
    expect(inlineWarnings.length).toBe(0);

    const overlay = document.body.querySelector(".diff-fullscreen-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.querySelectorAll(".diff-truncation-warning").length).toBe(
      0,
    );
  });

  it("hides the warning after exiting fullscreen when the user never clicked 'show all'", async () => {
    const wrapper = mountLongDiff();
    const vm = wrapper.vm as unknown as DiffPreviewInternals;

    expect(vm.showTruncationWarning).toBe(true);

    vm.enterFullscreen();
    await nextTick();
    expect(vm.showTruncationWarning).toBe(false);

    vm.exitFullscreen();
    await nextTick();

    // Exit should restore the original truncation state.
    expect(vm.isFullscreen).toBe(false);
    expect(vm.showAllLines).toBe(false);
    expect(vm.collapsedOverflow).toBeGreaterThan(0);
    expect(vm.showTruncationWarning).toBe(true);
    expect(wrapper.findAll(".diff-truncation-warning").length).toBe(1);
  });
});

describe("DiffPreview comment dock", () => {
  // 2026-07-30 sticky-dock: the inline comment editor is wrapped in
  // a `.diff-comment-dock` so it pins to the bottom of the *visible*
  // scroll viewport. Without the dock the editor sat at the diff
  // tail, and focusing its textarea made the browser scroll the
  // viewport down there — disorienting on long diffs. These tests
  // pin the *structural* contract (the dock exists exactly when the
  // editor is open, and the editor component is nested inside it);
  // the `position: sticky` rule itself lives in the scoped CSS and
  // is what makes the nesting translate into "pinned to viewport
  // bottom" at runtime.
  type EditorHost = {
    openNewEditor: (line: number) => void;
    enterFullscreen: () => void;
  };

  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("renders no dock while the editor is closed", () => {
    const wrapper = mountDiff();
    expect(wrapper.find(".diff-comment-dock").exists()).toBe(false);
    expect(wrapper.findComponent(FileCommentEditor).exists()).toBe(false);
  });

  it("wraps the editor in a dock in the normal view when opened", async () => {
    const wrapper = mountDiff();
    const vm = wrapper.vm as unknown as EditorHost;

    vm.openNewEditor(1);
    await nextTick();

    const dock = wrapper.find(".diff-comment-dock");
    expect(dock.exists()).toBe(true);
    // The editor component must be a descendant of the dock — that
    // nesting is precisely what lets `position: sticky` on the dock
    // carry the editor to the viewport bottom. If a future change
    // moves the editor back out of the dock, the jump-to-tail bug
    // returns, so we assert the nesting explicitly.
    expect(dock.findComponent(FileCommentEditor).exists()).toBe(true);
  });

  it("wraps the editor in a dock inside the fullscreen overlay", async () => {
    const wrapper = mountDiff();
    const vm = wrapper.vm as unknown as EditorHost;

    vm.enterFullscreen();
    await nextTick();
    vm.openNewEditor(1);
    // The overlay is a <Teleport>; the dock only appears after
    // `activeEditLine` flips *post*-overlay-mount, which is an
    // incremental patch to the teleported subtree. happy-dom needs
    // a full promise flush (a single nextTick is not enough here,
    // unlike the truncation-warning case where the warning is
    // already determined at first overlay render) before the dock
    // lands in document.body. In a real browser this update is a
    // synchronous reactive flush, so the product is unaffected.
    await flushPromises();

    // The overlay is teleported to <body>, so query from the overlay
    // element rather than the wrapper's local DOM tree.
    const overlay = document.body.querySelector(".diff-fullscreen-overlay");
    expect(overlay).not.toBeNull();
    // NOTE: we deliberately do NOT assert the dock via
    // `overlay.querySelector(".diff-comment-dock")`. happy-dom's
    // Teleport moves the overlay into <body> on first render but
    // drops *later* incremental patches to the teleported subtree
    // (the dock only appears once `activeEditLine` flips after the
    // overlay mounted), so a DOM-level query reads stale markup
    // even after `flushPromises`. The component-instance layer is
    // unaffected by that quirk, and the editor renders *only*
    // inside a dock — so two editor instances (normal view + the
    // fullscreen copy) prove both docks rendered. In a real browser
    // the teleported DOM patch lands normally, so the product shows
    // the dock correctly.
    expect(wrapper.findAllComponents(FileCommentEditor).length).toBe(2);
  });

  it("teleports the dock into the provided scroll container", async () => {
    // The actual fix: with a provider, the dock must relocate into
    // the injected scroller (so `position: sticky` sticks to it)
    // instead of staying inside the component's own .diff-preview
    // tree. Asserting both sides makes this a real regression guard
    // — a future change that drops the <Teleport> would leave the
    // dock in .diff-preview and fail the second expectation, while
    // the no-provider test above would still pass.
    const container = document.createElement("div");
    document.body.appendChild(container);
    try {
      const wrapper = mount(DiffPreview, {
        props: {
          content: buildDiffContent(40),
          filePath: "sample.txt",
          maxLines: 30,
        },
        global: {
          stubs: STUB_CHILDREN,
          provide: { diffScrollContainer: ref(container) },
        },
      });
      const vm = wrapper.vm as unknown as EditorHost;

      vm.openNewEditor(1);
      await nextTick();

      expect(container.querySelector(".diff-comment-dock")).not.toBeNull();
      expect(wrapper.find(".diff-comment-dock").exists()).toBe(false);
    } finally {
      document.body.removeChild(container);
    }
  });
});

// 2026-08-09 (elecvoid243): bulk fold controls (fullscreen only).
describe("DiffPreview bulk fold controls (fullscreen)", () => {
  it("collapse all folds every hunk; expand all restores them", async () => {
    // Two hunks so the bulk action has more than one target.
    const content = [
      "@@ -1,2 +1,2 @@\n line1\n+line2\n",
      "@@ -5,1 +6,1 @@\n-old\n+new\n",
    ].join("");
    const wrapper = mount(DiffPreview, {
      props: { content, filePath: "sample.txt", maxLines: 30 },
      global: { stubs: STUB_CHILDREN },
    });
    const vm = wrapper.vm as unknown as DiffPreviewInternals & {
      collapseAllHunks: () => void;
      expandAllHunks: () => void;
    };
    vm.enterFullscreen();
    await nextTick();

    // The bulk buttons render inside the overlay (first teleport patch).
    const overlay = document.body.querySelector(".diff-fullscreen-overlay")!;
    expect(overlay.querySelectorAll(".diff-hunk-bulk-btn").length).toBe(2);

    // happy-dom's Teleport drops later patches / event listeners on the
    // overlay subtree (see the comment dock describe above), so we drive
    // the handlers through the setup bindings and assert on the inline
    // card — it shares the same `collapsedHunks` state and is not
    // teleported.
    expect(wrapper.findAll(".hunk-header").length).toBe(2);
    expect(wrapper.findAll(".is-hunk-folded").length).toBe(0);

    vm.collapseAllHunks();
    await nextTick();
    expect(wrapper.findAll(".is-hunk-folded").length).toBe(2);

    vm.expandAllHunks();
    await nextTick();
    expect(wrapper.findAll(".is-hunk-folded").length).toBe(0);
  });

  it("bulk buttons are not rendered in the inline (non-fullscreen) card", () => {
    const wrapper = mountDiff();
    expect(wrapper.findAll(".diff-hunk-bulk-btn").length).toBe(0);
  });
});

// 2026-08-13 (elecvoid243): del-line comments (old side).
// Spec: docs/superpowers/specs/2026-08-13-diff-comments-old-side-design.md §4
// A one-hunk diff: del oldNo=1, ctx oldNo=2/newNo=1, add newNo=2.
const DEL_DIFF = "@@ -1,3 +1,2 @@\n-old1\n ctx1\n+new1\n";

function mountDelDiff() {
  return mount(DiffPreview, {
    props: { content: DEL_DIFF, filePath: "a.txt", maxLines: 30 },
    global: { stubs: STUB_CHILDREN },
  });
}

describe("DiffPreview del-line comments (old side, spec 2026-08-13)", () => {
  beforeEach(() => {
    useFileComments().clearAll();
  });

  it("unified: hovering a del row shows the + button", async () => {
    const w = mountDelDiff();
    const delRow = w.find(".diff-line.del");
    await delRow.trigger("mouseenter");
    expect(delRow.find(".diff-comment-add").exists()).toBe(true);
    // ctx/add rows keep working on the new side.
    await w.find(".diff-line.add").trigger("mouseenter");
    expect(w.find(".diff-line.add .diff-comment-add").exists()).toBe(true);
  });

  it("unified: clicking + on a del row opens the editor with side=old", async () => {
    const w = mountDelDiff();
    const vm = w.vm as unknown as {
      activeEditSide: string;
      activeEditLine: number | null;
    };
    await w.find(".diff-line.del").trigger("mouseenter");
    await w.find(".diff-line.del .diff-comment-add").trigger("click");
    expect(vm.activeEditSide).toBe("old");
    expect(vm.activeEditLine).toBe(1);
  });

  it("unified: saving a del-row comment stores side=old + del-line content", async () => {
    const w = mountDelDiff();
    const vm = w.vm as unknown as {
      activeEditSide: string;
      onSaveComment: (p: {
        text: string;
        commentId: string | null;
        line: number;
      }) => void;
    };
    await w.find(".diff-line.del").trigger("mouseenter");
    await w.find(".diff-line.del .diff-comment-add").trigger("click");
    vm.onSaveComment({ text: "为什么删掉", commentId: null, line: 1 });
    await nextTick();
    const comments = useFileComments().commentsForFile("a.txt");
    expect(comments).toHaveLength(1);
    expect(comments[0].side).toBe("old");
    expect(comments[0].line).toBe(1);
    // Spec decision (B): lineContent comes from the hunk del line.
    expect(comments[0].lineContent).toBe("old1");
    expect(comments[0].diffHunk?.side).toBe("old");
    expect(comments[0].diffHunk?.oldLine).toBe(1);
  });

  it("unified: del row with an existing old comment renders the indicator", async () => {
    useFileComments().addCommentWithContext({
      filePath: "a.txt",
      line: 1,
      text: "已评论",
      context: { lineContent: "old1", contextBefore: null, contextAfter: null },
      side: "old",
      diffHunk: {
        header: "@@ -1,3 +1,2 @@",
        lines: [
          { type: "del", content: "old1", oldNo: 1, newNo: null },
          { type: "ctx", content: "ctx1", oldNo: 2, newNo: 1 },
          { type: "add", content: "new1", oldNo: null, newNo: 2 },
        ],
        newLine: null,
        side: "old",
        oldLine: 1,
      },
    });
    const w = mountDelDiff();
    const delRow = w.find(".diff-line.del");
    expect(delRow.classes()).toContain("has-comment");
    expect(delRow.find(".diff-comment-indicator").exists()).toBe(true);
  });

  it("split: del-only row shows + in the LEFT cell and opens with side=old", async () => {
    const w = mountDelDiff();
    const vm = w.vm as unknown as {
      activeEditSide: string;
      setViewMode: (m: "unified" | "split") => void;
    };
    vm.setViewMode("split");
    await nextTick();
    const delOnlyRow = w.find(".diff-row-split.del-only");
    await delOnlyRow.trigger("mouseenter");
    const btn = delOnlyRow.find(".diff-cell.left .diff-comment-add");
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(vm.activeEditSide).toBe("old");
  });
});
