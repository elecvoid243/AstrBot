// Author: elecvoid243 @ 2026-08-03
// Spec: docs/superpowers/specs/2026-08-03-git-squash-design.md §4.2
// Selection checkboxes + validity + squash payload for GitLogView.
// Heavy-stub strategy mirrors GitLogView.branchPicker.spec.ts.

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import GitLogView from "./GitLogView.vue";
import type { SpcodeLogSnapshot } from "@/composables/parseSpcodeGitWorkflow";

const vuetifyStubs = {
  "v-icon": { template: "<i />" },
  "v-btn": {
    name: "v-btn",
    props: ["disabled", "title", "size", "variant"],
    template:
      '<button class="v-btn-stub" :disabled="disabled" :title="title"><slot /></button>',
  },
  "v-text-field": {
    name: "v-text-field",
    props: ["modelValue", "label", "placeholder"],
    template: "<div />",
  },
  "v-combobox": {
    name: "v-combobox",
    props: ["modelValue", "items", "label", "placeholder", "hideNoData"],
    template: "<div />",
  },
  "v-progress-circular": { template: "<i />" },
  GitStatsPanel: { template: "<div />" },
  FilePatchPanel: { template: "<div />" },
};

function makeCommit(sha: string) {
  return {
    sha,
    shaShort: sha.slice(0, 7),
    author: { name: "alice", email: "alice@example.com" },
    committer: { name: "alice", email: "alice@example.com" },
    date: "2026-08-01T10:00:00+08:00",
    subject: `commit ${sha.slice(0, 7)}`,
    body: null,
    parents: [],
    shortstat: { files: 1, additions: 2, deletions: 3 },
  };
}

const SHAS = ["a".repeat(40), "b".repeat(40), "c".repeat(40), "d".repeat(40)];

function makeSnapshot(): SpcodeLogSnapshot {
  return {
    success: true,
    reason: null,
    loaded: true,
    elapsedMs: 1,
    umo: "u",
    worktree: "w",
    directory: "d",
    ref: "HEAD",
    count: SHAS.length,
    hasMore: false,
    truncated: false,
    maxBytes: 1024,
    commits: SHAS.map(makeCommit), // newest → oldest (git log order)
  };
}

function mountView(props: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mount(GitLogView as any, {
    props: {
      state: { kind: "ok", snapshot: makeSnapshot() },
      hasMore: false,
      isLoading: false,
      gitShow: {
        getState: () => ({ kind: "idle" }),
        getData: () => null,
        getFileState: () => ({ kind: "idle" }),
        fetch: () => Promise.resolve(),
        fetchFile: () => Promise.resolve(),
      },
      focusedCommitSha: null,
      gitStats: { state: { value: { kind: "idle" } }, refresh: () => {} },
      statsOpen: false,
      range: null,
      topFilesLimit: 10,
      branchItems: ["main", "dev"],
      currentBranch: "main",
      activeRef: "HEAD",
      squashResetToken: 0,
      ...props,
    },
    global: { stubs: vuetifyStubs },
  });
}

function findSquashButton(w: ReturnType<typeof mountView>) {
  // The squash toolbar button is the only one carrying this class
  // (added in Task 4); the v-btn stub merges fallthrough classes
  // onto its root <button>.
  return w.find(".git-log-squash-btn");
}

describe("GitLogView squash selection (spec 2026-08-03, revised interaction)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders no checkboxes before entering selection mode; button is clickable", () => {
    const w = mountView();
    expect(w.findAll(".git-log-item-select")).toHaveLength(0);
    const btn = findSquashButton(w);
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("first click arms selection mode (checkboxes appear, no submit)", async () => {
    const w = mountView();
    await findSquashButton(w).trigger("click");
    expect(w.findAll(".git-log-item-select")).toHaveLength(SHAS.length);
    // Nothing submitted yet, and with 0 selected the button is grey.
    expect(w.emitted("squash")).toBeUndefined();
    expect(findSquashButton(w).attributes("disabled")).toBeDefined();
  });

  it("hides everything when viewing another ref", async () => {
    const w = mountView({ activeRef: "dev" });
    expect(w.findAll(".git-log-item-select")).toHaveLength(0);
    expect(findSquashButton(w).exists()).toBe(false);
    // Arming first, then switching refs, also tears the mode down.
    await w.setProps({ activeRef: "HEAD" });
    await findSquashButton(w).trigger("click");
    expect(w.findAll(".git-log-item-select")).toHaveLength(SHAS.length);
    await w.setProps({ activeRef: "dev" });
    await w.setProps({ activeRef: "HEAD" });
    expect(w.findAll(".git-log-item-select")).toHaveLength(0);
  });

  it("single selection stays grey; top-2 contiguous enables submit", async () => {
    const w = mountView();
    await findSquashButton(w).trigger("click");
    const boxes = w.findAll(".git-log-item-select");
    await boxes[0].trigger("click");
    expect(findSquashButton(w).attributes("disabled")).toBeDefined();
    await boxes[1].trigger("click");
    expect(findSquashButton(w).attributes("disabled")).toBeUndefined();
  });

  it("non-contiguous selection (gap) stays grey", async () => {
    const w = mountView();
    await findSquashButton(w).trigger("click");
    const boxes = w.findAll(".git-log-item-select");
    await boxes[0].trigger("click");
    await boxes[2].trigger("click"); // skips row 1 → gap
    expect(findSquashButton(w).attributes("disabled")).toBeDefined();
  });

  it("missing-HEAD selection stays grey", async () => {
    const w = mountView();
    await findSquashButton(w).trigger("click");
    const boxes = w.findAll(".git-log-item-select");
    await boxes[1].trigger("click");
    await boxes[2].trigger("click");
    expect(findSquashButton(w).attributes("disabled")).toBeDefined();
  });

  it("second click with a valid selection emits payload oldest → newest", async () => {
    const w = mountView();
    await findSquashButton(w).trigger("click");
    const boxes = w.findAll(".git-log-item-select");
    await boxes[0].trigger("click");
    await boxes[1].trigger("click");
    await findSquashButton(w).trigger("click");
    const events = w.emitted("squash");
    expect(events).toHaveLength(1);
    const payload = events![0][0] as {
      commits: { sha: string; subject: string }[];
    };
    expect(payload.commits.map((c) => c.sha)).toEqual([SHAS[1], SHAS[0]]);
    expect(payload.commits[0].subject).toBe(`commit ${SHAS[1].slice(0, 7)}`);
  });

  it("cancel button exits selection mode and clears the selection", async () => {
    const w = mountView();
    await findSquashButton(w).trigger("click");
    const boxes = w.findAll(".git-log-item-select");
    await boxes[0].trigger("click");
    await boxes[1].trigger("click");
    await w.find(".git-log-squash-cancel-btn").trigger("click");
    expect(w.findAll(".git-log-item-select")).toHaveLength(0);
    // Re-entering starts from a clean selection.
    await findSquashButton(w).trigger("click");
    expect(w.findAll(".git-log-item-select.is-selected")).toHaveLength(0);
  });

  it("clears the selection and exits the mode when squashResetToken changes", async () => {
    const w = mountView();
    await findSquashButton(w).trigger("click");
    const boxes = w.findAll(".git-log-item-select");
    await boxes[0].trigger("click");
    await boxes[1].trigger("click");
    await w.setProps({ squashResetToken: 1 });
    expect(w.findAll(".git-log-item-select")).toHaveLength(0);
    await findSquashButton(w).trigger("click");
    expect(w.findAll(".git-log-item-select.is-selected")).toHaveLength(0);
  });
});
