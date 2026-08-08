// Author: elecvoid243 @ 2026-08-08
//
// Component spec for InteractiveChoiceProse — extra_content fold.
// Markdown prose longer than 200 chars is expanded by default with a
// collapse toggle; short content renders directly without any toggle.
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("markstream-vue", () => ({
  MarkdownRender: {
    name: "MarkdownRender",
    template: "<div class='md-render-stub' />",
  },
}));

import InteractiveChoiceProse from "./InteractiveChoiceProse.vue";

const stubs = {
  "v-icon": { template: "<i><slot /></i>" },
};

describe("InteractiveChoiceProse — extra_content fold (>200 chars)", () => {
  it("renders short content without a toggle", () => {
    const wrapper = mount(InteractiveChoiceProse, {
      props: { content: "**推荐 A**", uid: "rid-1" },
      global: { stubs },
    });
    expect(wrapper.find(".choice-prose-toggle").exists()).toBe(false);
    expect(wrapper.find(".md-render-stub").exists()).toBe(true);
  });

  it("expands long content by default and collapses on toggle", async () => {
    const long = "长".repeat(300);
    const wrapper = mount(InteractiveChoiceProse, {
      props: { content: long, uid: "rid-1" },
      global: { stubs },
    });
    // Default: expanded → markdown rendered + collapse toggle.
    expect(wrapper.find(".md-render-stub").exists()).toBe(true);
    const collapseToggle = wrapper.find(".choice-prose-toggle");
    expect(collapseToggle.exists()).toBe(true);
    expect(collapseToggle.text()).toContain("收起补充说明");
    expect(collapseToggle.attributes("aria-expanded")).toBe("true");

    // Collapse → toggle only, markdown hidden.
    await collapseToggle.trigger("click");
    expect(wrapper.find(".md-render-stub").exists()).toBe(false);
    const expandToggle = wrapper.find(".choice-prose-toggle");
    expect(expandToggle.text()).toContain("展开补充说明");
    expect(expandToggle.attributes("aria-expanded")).toBe("false");

    // Expand again → markdown back + collapse toggle.
    await expandToggle.trigger("click");
    expect(wrapper.find(".md-render-stub").exists()).toBe(true);
    expect(wrapper.find(".choice-prose-toggle").text()).toContain("收起补充说明");
  });
});
