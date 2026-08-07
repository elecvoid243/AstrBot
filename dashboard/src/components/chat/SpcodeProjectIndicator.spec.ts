// SpcodeProjectIndicator.spec.ts
// Author: elecvoid243 @ 2026-08-06
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/v1", () => ({
  pluginExtensionApi: { get: vi.fn(), post: vi.fn() },
}));

import { useSpcodeOperationProgress } from "@/composables/useSpcodeOperationProgress";
import SpcodeProjectIndicator from "./SpcodeProjectIndicator.vue";

// Minimal stubs: v-tooltip renders its activator slot directly; v-menu
// renders activator + (when open) content slot.
const tooltipStub = defineComponent({
  template: `<div><slot name="activator" :props="{}" /><slot /></div>`,
});
const menuStub = defineComponent({
  props: { modelValue: { type: Boolean, default: false } },
  template: `<div class="v-menu-stub"><slot name="activator" :props="{}" /><slot v-if="modelValue" /></div>`,
});
const stubs = {
  "v-tooltip": tooltipStub,
  "v-menu": menuStub,
  "v-card": { template: "<div><slot /></div>" },
  "v-card-text": { template: "<div><slot /></div>" },
  "v-icon": { template: "<i><slot /></i>" },
};

function setProgress(
  status: "idle" | "running" | "done" | "failed",
  operation: "project_load" | "project_unload" | "codegraph_set" | null,
  extra: Partial<{ currentStep: string; messages: string[]; reason: string }> = {},
) {
  const { progress } = useSpcodeOperationProgress();
  progress.value = {
    status,
    operation,
    currentStep: extra.currentStep ?? "",
    messages: extra.messages ?? [],
    reason: extra.reason ?? null,
  };
}

describe("SpcodeProjectIndicator progress states", () => {
  afterEach(() => useSpcodeOperationProgress().clear());

  it("shows current step while loading and suppresses click", async () => {
    setProgress("running", "project_load", {
      currentStep: "⏳ [2/3] codegraph init",
    });
    const wrapper = mount(SpcodeProjectIndicator, { global: { stubs } });
    expect(wrapper.text()).toContain("⏳ [2/3] codegraph init");
    await wrapper.find(".sp-status-badge").trigger("click");
    expect(wrapper.emitted("open-load-dialog")).toBeUndefined();
  });

  it("shows failed state with detail popover button", async () => {
    setProgress("failed", "project_load", {
      messages: ["⏳ [1/3] init", "❌ path unsafe"],
      reason: "path_unsafe",
    });
    const wrapper = mount(SpcodeProjectIndicator, { global: { stubs } });
    expect(wrapper.text()).toContain("加载失败");
    expect(wrapper.find(".sp-chip-details-btn").exists()).toBe(true);
    // failed state still allows opening the dialog (retry)
    await wrapper.find(".sp-status-badge").trigger("click");
    expect(wrapper.emitted("open-load-dialog")).toHaveLength(1);
  });

  it("non-project operations do not hijack the chip", () => {
    setProgress("running", "codegraph_set", { currentStep: "🔄 restart" });
    const wrapper = mount(SpcodeProjectIndicator, { global: { stubs } });
    expect(wrapper.text()).not.toContain("🔄 restart");
    expect(wrapper.find(".sp-chip-details-btn").exists()).toBe(false);
  });

  it("idle progress falls back to the unloaded badge", () => {
    const wrapper = mount(SpcodeProjectIndicator, { global: { stubs } });
    expect(wrapper.text()).toContain("未加载项目");
    expect(wrapper.find(".sp-chip-details-btn").exists()).toBe(false);
  });
});
