// Tests for FileChangeCard.vue — the per-file change card pinned on
// top of the ReasoningTimeline (2026-08-11 file-change visibility).
//
// Mount strategy mirrors DiffPreview.spec.ts: stub the heavy children
// (DiffPreview / CopyableText / v-icon) so the test focuses on the
// card's own state graph (collapse/expand, running/done/error).
//
// Author: elecvoid243 | 2026-08-11

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FileChangeCard from "./FileChangeCard.vue";
import type { FileChangeEntry } from "@/utils/fileChangeTool";

const STUBS = {
  DiffPreview: {
    name: "DiffPreview",
    props: ["content", "filePath", "summary", "isDark", "maxLines", "collapsible"],
    template: "<div class='diff-preview-stub' />",
  },
  CopyableText: {
    name: "CopyableText",
    props: ["value"],
    template: "<span class='copyable-stub'>{{ value }}</span>",
  },
  "v-icon": { template: "<i />" },
  "v-progress-circular": { template: "<span class='progress-stub' />" },
};

const WRITE_ENTRY: FileChangeEntry = {
  callId: "w1",
  kind: "write",
  filePath: "F:\\proj\\b.txt",
  status: "done",
  diffStat: null,
  lineCount: 3,
  tool: {
    id: "w1",
    name: "astrbot_file_write_tool",
    args: { path: "F:\\proj\\b.txt", content: "a\nb\nc" },
    result: "File written successfully: F:\\proj\\b.txt",
    finished_ts: 2,
  },
};

const EDIT_ENTRY: FileChangeEntry = {
  callId: "e1",
  kind: "edit",
  filePath: "F:\\proj\\a.py",
  status: "done",
  diffStat: { adds: 2, dels: 1 },
  lineCount: null,
  tool: {
    id: "e1",
    name: "astrbot_file_edit_tool",
    args: { path: "F:\\proj\\a.py" },
    result: [
      "Edited F:\\proj\\a.py. Replaced 1 occurrence(s) of the target text.",
      "",
      "Diff:",
      "```diff",
      "@@ -1,3 +1,4 @@",
      " line1",
      "-old line",
      "+new line",
      "+another line",
      "```",
    ].join("\n"),
    finished_ts: 2,
  },
};

const RUNNING_EDIT_ENTRY: FileChangeEntry = {
  ...EDIT_ENTRY,
  callId: "e2",
  status: "running",
  diffStat: null,
  tool: { id: "e2", name: "astrbot_file_edit_tool", args: { path: "F:\\proj\\a.py" } },
};

function mountCard(entry: FileChangeEntry) {
  return mount(FileChangeCard, {
    props: { entry, isDark: false },
    global: { stubs: STUBS },
  });
}

describe("FileChangeCard", () => {
  it("shows basename and line count for a write entry", () => {
    const wrapper = mountCard(WRITE_ENTRY);
    expect(wrapper.text()).toContain("b.txt");
    expect(wrapper.text()).toContain("3");
    // collapsed by default: no content visible
    expect(wrapper.text()).not.toContain("a\nb\nc");
  });

  it("reveals the written content after expanding", async () => {
    const wrapper = mountCard(WRITE_ENTRY);
    await wrapper.find(".file-change-card-header").trigger("click");
    expect(wrapper.text()).toContain("a\nb\nc");
  });

  it("shows the diff stat for an edit entry", () => {
    const wrapper = mountCard(EDIT_ENTRY);
    expect(wrapper.text()).toContain("+2");
    expect(wrapper.text()).toContain("−1");
  });

  it("renders DiffPreview with the parsed diff when expanded", async () => {
    const wrapper = mountCard(EDIT_ENTRY);
    await wrapper.find(".file-change-card-header").trigger("click");
    const diff = wrapper.findComponent(STUBS.DiffPreview);
    expect(diff.exists()).toBe(true);
    expect(diff.props("filePath")).toBe("F:\\proj\\a.py");
    expect(diff.props("content")).toContain("-old line");
  });

  it("shows a spinner instead of a diff while the call is running", async () => {
    const wrapper = mountCard(RUNNING_EDIT_ENTRY);
    await wrapper.find(".file-change-card-header").trigger("click");
    expect(wrapper.find(".progress-stub").exists()).toBe(true);
    expect(wrapper.findComponent(STUBS.DiffPreview).exists()).toBe(false);
  });

  it("tints the whole card by change kind (write=green, edit=yellow, remove=red)", () => {
    expect(mountCard(WRITE_ENTRY).classes()).toContain(
      "file-change-card--green",
    );
    expect(mountCard(EDIT_ENTRY).classes()).toContain(
      "file-change-card--yellow",
    );
    const removeEntry: FileChangeEntry = {
      callId: "r1",
      kind: "remove",
      filePath: "F:\\proj\\old.txt",
      status: "done",
      diffStat: null,
      lineCount: null,
      tool: {
        id: "r1",
        name: "astrbot_file_remove_tool",
        args: { path: "F:\\proj\\old.txt" },
        result: "File removed: F:\\proj\\old.txt",
        finished_ts: 2,
      },
    };
    expect(mountCard(removeEntry).classes()).toContain(
      "file-change-card--red",
    );
  });

  it("colors the +adds green and the −dels red", () => {
    const wrapper = mountCard(EDIT_ENTRY);
    const adds = wrapper.find(".file-change-stat .stat-adds");
    const dels = wrapper.find(".file-change-stat .stat-dels");
    expect(adds.exists()).toBe(true);
    expect(adds.text()).toBe("+2");
    expect(dels.exists()).toBe(true);
    expect(dels.text()).toBe("−1");
  });
});
