// Author: elecvoid243 @ 2026-08-08
//
// Component spec for InteractiveChoiceProse — extra_content fold.
// Markdown prose longer than 200 chars is collapsed behind an expand
// toggle; short content renders directly without any toggle.
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

  it("collapses long content behind an expand toggle", async () => {
    const long = "长".repeat(300);
    const wrapper = mount(InteractiveChoiceProse, {
      props: { content: long, uid: "rid-1" },
      global: { stubs },
    });
    // Collapsed: toggle only, markdown not rendered yet.
    const toggle = wrapper.find(".choice-prose-toggle");
    expect(toggle.exists()).toBe(true);
    expect(toggle.text()).toContain("展开补充说明");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find(".md-render-stub").exists()).toBe(false);

    // Expand → markdown rendered + collapse toggle.
    await toggle.trigger("click");
    expect(wrapper.find(".md-render-stub").exists()).toBe(true);
    const afterToggle = wrapper.find(".choice-prose-toggle");
    expect(afterToggle.exists()).toBe(true);
    expect(afterToggle.text()).toContain("收起补充说明");
    expect(afterToggle.attributes("aria-expanded")).toBe("true");
  });
});
