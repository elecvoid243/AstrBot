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
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import DiffPreview from "./DiffPreview.vue";

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
