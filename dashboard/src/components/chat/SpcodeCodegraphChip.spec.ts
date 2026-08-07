// SpcodeCodegraphChip.spec.ts
// Author: elecvoid243 @ 2026-08-06
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/v1", () => ({
  pluginExtensionApi: { get: vi.fn(), post: vi.fn() },
}));

vi.mock("@/composables/useSpcodeCodegraphStatus", () => ({
  useSpcodeCodegraphStatus: () => ({
    status: { value: { mcpRunning: true, activeProject: "" } },
    refresh: vi.fn(),
  }),
}));

vi.mock("@/composables/useSpcodeProjectStatus", () => ({
  useSpcodeProjectStatus: () => ({
    status: { value: { loaded: false, directory: null } },
    refresh: vi.fn(),
  }),
}));

import { useSpcodeOperationProgress } from "@/composables/useSpcodeOperationProgress";
import SpcodeCodegraphChip from "./SpcodeCodegraphChip.vue";

const tooltipStub = defineComponent({
  template: `<div><slot name="activator" :props="{}" /><slot /></div>`,
});
const stubs = {
  "v-tooltip": tooltipStub,
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

describe("SpcodeCodegraphChip progress states", () => {
  afterEach(() => useSpcodeOperationProgress().clear());

  it("shows current step during codegraph set and suppresses click", async () => {
    setProgress("running", "codegraph_set", {
      currentStep: "🔄 正在重启 codegraph MCP...",
    });
    const wrapper = mount(SpcodeCodegraphChip, { global: { stubs } });
    expect(wrapper.text()).toContain("🔄 正在重启 codegraph MCP...");
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("open-codegraph-dialog")).toBeUndefined();
  });

  it("shows failed label on set failure and still opens dialog", async () => {
    setProgress("failed", "codegraph_set", {
      messages: ["❌ codegraph MCP 重启失败: boom"],
      reason: "mcp_restart_failed",
    });
    const wrapper = mount(SpcodeCodegraphChip, { global: { stubs } });
    expect(wrapper.text()).toContain("Codegraph 设置失败");
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("open-codegraph-dialog")).toHaveLength(1);
  });

  it("project operations do not hijack the codegraph chip", () => {
    setProgress("running", "project_load", { currentStep: "⏳ [1/3] init" });
    const wrapper = mount(SpcodeCodegraphChip, { global: { stubs } });
    expect(wrapper.text()).not.toContain("⏳ [1/3] init");
  });
});
