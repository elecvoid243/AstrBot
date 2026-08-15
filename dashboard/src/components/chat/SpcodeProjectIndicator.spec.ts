// SpcodeProjectIndicator.spec.ts
// Author: elecvoid243 @ 2026-08-06
// Updated: 2026-08-15 — services popover (codegraph / vivado status
// integrated from the removed SpcodeCodegraphChip / SpcodeVivadoStatusChip).
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/v1", () => ({
  pluginExtensionApi: { get: vi.fn(), post: vi.fn() },
}));

import { useSpcodeOperationProgress } from "@/composables/useSpcodeOperationProgress";
import { useSpcodeProjectStatus } from "@/composables/useSpcodeProjectStatus";
import { useSpcodeCodegraphStatus } from "@/composables/useSpcodeCodegraphStatus";
import { useSpcodeVivadoStatus } from "@/composables/useSpcodeVivadoStatus";
import SpcodeProjectIndicator from "./SpcodeProjectIndicator.vue";

// Minimal stubs: v-tooltip renders its activator slot directly; v-menu
// forwards an onClick to its activator so tests can toggle the popover.
const tooltipStub = defineComponent({
  template: `<div><slot name="activator" :props="{}" /><slot /></div>`,
});
const menuStub = defineComponent({
  props: { modelValue: { type: Boolean, default: false } },
  template: `<div class="v-menu-stub"><slot name="activator" :props="{ onClick: () => $emit('update:modelValue', true) }" /><slot v-if="modelValue" /></div>`,
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

/** Put both MCP services into a healthy state so popover rows show labels. */
function setServicesHealthy() {
  useSpcodeCodegraphStatus().status.value = {
    enabled: true,
    mcpRunning: true,
    activeProject: "F:/proj",
    fetchedAt: 1,
  };
  useSpcodeVivadoStatus().status.value = {
    overall: "ok",
    enabled: true,
    mcpRunning: true,
    vivadoPath: "C:/vivado/bin/vivado",
    installMissing: false,
    degraded: false,
    sessions: [{ id: "s1", state: "idle" }],
    fetchedAt: 1,
    message: "Vivado 运行中 · 1 会话",
  };
}

describe("SpcodeProjectIndicator progress states", () => {
  afterEach(() => {
    useSpcodeOperationProgress().clear();
    useSpcodeProjectStatus().reset();
    useSpcodeCodegraphStatus().reset();
    useSpcodeVivadoStatus().reset();
  });

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

  it("shows only the basename of a loaded project path", () => {
    useSpcodeProjectStatus().setLoaded(
      "F:/project/python/pycharm/testproj1",
    );
    const wrapper = mount(SpcodeProjectIndicator, { global: { stubs } });
    // Visible badge: label + basename only.
    const badgeText = wrapper.find(".sp-status-badge").text();
    expect(badgeText).toContain("已加载项目");
    expect(badgeText).toContain("testproj1");
    expect(badgeText).not.toContain("F:/project");
    // Hover tooltip still exposes the full path.
    expect(wrapper.text()).toContain("F:/project/python/pycharm/testproj1");
  });

  it("strips trailing separators before taking the basename", () => {
    useSpcodeProjectStatus().setLoaded("C:\\proj\\demo\\");
    const wrapper = mount(SpcodeProjectIndicator, { global: { stubs } });
    const badgeText = wrapper.find(".sp-status-badge").text();
    expect(badgeText).toContain("demo");
    expect(badgeText).not.toContain("C:\\proj");
  });
});

describe("SpcodeProjectIndicator services popover", () => {
  afterEach(() => {
    useSpcodeOperationProgress().clear();
    useSpcodeProjectStatus().reset();
    useSpcodeCodegraphStatus().reset();
    useSpcodeVivadoStatus().reset();
  });

  it("renders the services side button next to the project chip", () => {
    const wrapper = mount(SpcodeProjectIndicator, { global: { stubs } });
    expect(wrapper.find(".sp-chip-services-btn").exists()).toBe(true);
  });

  it("opens the popover and shows codegraph + vivado status rows", async () => {
    setServicesHealthy();
    const wrapper = mount(SpcodeProjectIndicator, { global: { stubs } });
    expect(wrapper.findAll(".sp-svc-row").length).toBe(0);
    await wrapper.find(".sp-chip-services-btn").trigger("click");
    expect(wrapper.findAll(".sp-svc-row").length).toBe(2);
    expect(wrapper.text()).toContain("Codegraph 已连接");
    expect(wrapper.text()).toContain("Vivado 已就绪");
  });

  it("codegraph row falls back to the not-running label when MCP is down", async () => {
    useSpcodeCodegraphStatus().reset();
    const wrapper = mount(SpcodeProjectIndicator, { global: { stubs } });
    await wrapper.find(".sp-chip-services-btn").trigger("click");
    expect(wrapper.text()).toContain("Codegraph 未启动");
  });

  it("manage button emits open-codegraph-dialog and closes the popover", async () => {
    setServicesHealthy();
    const wrapper = mount(SpcodeProjectIndicator, { global: { stubs } });
    await wrapper.find(".sp-chip-services-btn").trigger("click");
    expect(wrapper.findAll(".sp-svc-row").length).toBe(2);
    await wrapper.find(".sp-svc-row__action").trigger("click");
    expect(wrapper.emitted("open-codegraph-dialog")).toHaveLength(1);
    await nextTick();
    // Popover closed after delegating to the codegraph dialog.
    expect(wrapper.findAll(".sp-svc-row").length).toBe(0);
  });
});
