// Author: elecvoid243, 2026-07-31
// ShikiCodeBlock — dispatch (diff vs shiki vs plain), theme recompute,
// streaming plain-text phase, copy button.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";

const { mockRenderShikiCode, mockGetShikiHighlighter, mockCopyToClipboard } =
  vi.hoisted(() => ({
    mockRenderShikiCode: vi.fn(
      () => '<pre class="shiki-mock"><code>highlighted</code></pre>',
    ),
    mockGetShikiHighlighter: vi.fn(async () => ({ __highlighter: true })),
    mockCopyToClipboard: vi.fn(async () => true),
  }));

vi.mock("@/utils/shiki", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/shiki")>();
  return {
    ...actual,
    getShikiHighlighter: mockGetShikiHighlighter,
    renderShikiCode: mockRenderShikiCode,
  };
});

vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: mockCopyToClipboard,
}));

import ShikiCodeBlock from "./ShikiCodeBlock.vue";

const stubs = {
  DiffPreview: {
    template: '<div class="diff-stub" />',
    props: ["content", "isDark", "maxLines"],
  },
  "v-icon": { template: '<i class="icon" />' },
};

function makeNode(overrides: Record<string, unknown> = {}) {
  return { lang: "vue", code: "<div />", loading: false, ...overrides };
}

beforeEach(() => {
  mockRenderShikiCode.mockClear();
  mockGetShikiHighlighter.mockClear();
  mockCopyToClipboard.mockClear();
});

describe("ShikiCodeBlock", () => {
  it("renders shiki-highlighted HTML for a normal language", async () => {
    const wrapper = mount(ShikiCodeBlock, {
      props: { node: makeNode(), isDark: false },
      global: { stubs },
    });
    await flushPromises();
    expect(mockRenderShikiCode).toHaveBeenCalledWith(
      expect.anything(),
      "<div />",
      "vue",
      "light",
    );
    expect(wrapper.find(".shiki-mock").exists()).toBe(true);
    expect(wrapper.find(".shiki-code-block__lang").text()).toBe("vue");
  });

  it("routes lang=diff to DiffPreview without calling shiki", async () => {
    const wrapper = mount(ShikiCodeBlock, {
      props: { node: makeNode({ lang: "diff", code: "-a\n+b" }), isDark: true },
      global: { stubs },
    });
    await flushPromises();
    expect(wrapper.find(".diff-stub").exists()).toBe(true);
    expect(mockRenderShikiCode).not.toHaveBeenCalled();
  });

  it("shows plain text while loading, then highlights when final", async () => {
    const wrapper = mount(ShikiCodeBlock, {
      props: { node: makeNode({ loading: true }), isDark: false },
      global: { stubs },
    });
    await flushPromises();
    expect(mockRenderShikiCode).not.toHaveBeenCalled();
    expect(wrapper.find("pre.shiki-code-block__plain").text()).toBe("<div />");

    await wrapper.setProps({ node: makeNode({ loading: false }) });
    await flushPromises();
    expect(mockRenderShikiCode).toHaveBeenCalledTimes(1);
  });

  it("recomputes with dark colorMode when isDark flips", async () => {
    const wrapper = mount(ShikiCodeBlock, {
      props: { node: makeNode(), isDark: false },
      global: { stubs },
    });
    await flushPromises();
    await wrapper.setProps({ isDark: true });
    await flushPromises();
    expect(mockRenderShikiCode).toHaveBeenLastCalledWith(
      expect.anything(),
      "<div />",
      "vue",
      "dark",
    );
  });

  it("copy button copies the code and emits copy", async () => {
    const wrapper = mount(ShikiCodeBlock, {
      props: { node: makeNode(), isDark: false },
      global: { stubs },
    });
    await flushPromises();
    await wrapper.get(".shiki-code-block__copy").trigger("click");
    await flushPromises();
    expect(mockCopyToClipboard).toHaveBeenCalledWith("<div />");
    expect(wrapper.emitted("copy")![0]).toEqual(["<div />"]);
  });

  // Regression (2026-08-01): an absent isDark prop must NOT default to
  // false (Vue Boolean-prop gotcha) — the Vuetify theme fallback decides
  // instead, which is what keeps document-manager dark renders dark.
  it("falls back to the Vuetify theme when isDark is not provided", async () => {
    const darkVuetify = createVuetify({ theme: { defaultTheme: "dark" } });
    mount(ShikiCodeBlock, {
      props: { node: makeNode() },
      global: { plugins: [darkVuetify], stubs },
    });
    await flushPromises();
    expect(mockRenderShikiCode).toHaveBeenCalledWith(
      expect.anything(),
      "<div />",
      "vue",
      "dark",
    );
  });

  // Regression (2026-08-01, round 2): markstream passes isDark=false to
  // custom code_block components in the document-view path even in dark
  // mode — the Vuetify theme must still win over the unreliable prop.
  it("ignores a false isDark prop when the Vuetify theme is dark", async () => {
    const darkVuetify = createVuetify({ theme: { defaultTheme: "dark" } });
    mount(ShikiCodeBlock, {
      props: { node: makeNode(), isDark: false },
      global: { plugins: [darkVuetify], stubs },
    });
    await flushPromises();
    expect(mockRenderShikiCode).toHaveBeenCalledWith(
      expect.anything(),
      "<div />",
      "vue",
      "dark",
    );
  });
});
