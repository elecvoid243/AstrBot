// Author: elecvoid243, 2026-07-25
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { describe, expect, it } from "vitest";
import ProjectLoadDialog from "./ProjectLoadDialog.vue";

const dialogStub = defineComponent({
  props: {
    modelValue: { type: Boolean, default: false },
  },
  template: '<div v-if="modelValue"><slot /></div>',
});

const textFieldStub = defineComponent({
  props: {
    modelValue: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  template: `
    <input
      data-testid="project-path"
      :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
    />
  `,
});

const checkboxStub = defineComponent({
  props: {
    modelValue: { type: Boolean, default: false },
    label: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  template: `
    <label class="v-label">
      <input
        type="checkbox"
        :checked="modelValue"
        @change="$emit('update:modelValue', $event.target.checked)"
      />
      <span>{{ label }}</span>
    </label>
  `,
});

const buttonStub = defineComponent({
  props: {
    disabled: { type: Boolean, default: false },
  },
  emits: ["click"],
  template: `
    <button :disabled="disabled" @click="$emit('click')">
      <slot />
    </button>
  `,
});

const stubs = {
  "v-dialog": dialogStub,
  "v-card": { template: "<div><slot /></div>" },
  "v-card-title": { template: "<div><slot /></div>" },
  "v-card-text": { template: "<div><slot /></div>" },
  "v-card-actions": { template: "<div><slot /></div>" },
  "v-form": { template: "<form><slot /></form>" },
  "v-text-field": textFieldStub,
  "v-checkbox": checkboxStub,
  "v-btn": buttonStub,
  "v-divider": { template: "<hr />" },
  "v-spacer": { template: "<span />" },
  "v-list": { template: "<div><slot /></div>" },
  "v-list-item": { template: "<div><slot /></div>" },
  "v-list-item-title": { template: "<div><slot /></div>" },
  "v-expansion-panels": {
    props: {
      modelValue: { type: Array, default: () => [] },
    },
    emits: ["update:modelValue"],
    template: "<div><slot /></div>",
  },
  "v-expansion-panel": {
    props: { value: { type: String, default: "" } },
    emits: ["group:selected"],
    template: "<div :data-panel-value=\"value\"><slot /></div>",
  },
  "v-expansion-panel-title": { template: "<div><slot /></div>" },
  "v-expansion-panel-text": {
    props: { eager: { type: Boolean, default: false } },
    template: "<div :data-eager=\"eager\"><slot /></div>",
  },
};

function mountDialog(commandMode: "project" | "codegraph" = "project") {
  return mount(ProjectLoadDialog, {
    props: {
      wakePrefixes: ["/"],
      commandMode,
    },
    global: { stubs },
  });
}

async function openDialog(wrapper: VueWrapper): Promise<void> {
  (
    wrapper.vm as unknown as {
      openLoadDialog: () => void;
    }
  ).openLoadDialog();
  await nextTick();
}

async function submitPath(wrapper: VueWrapper, path: string): Promise<string> {
  await wrapper.get('[data-testid="project-path"]').setValue(path);
  const submitButton = wrapper
    .findAll("button")
    .find((button) => button.text() === "加载");
  expect(submitButton).toBeDefined();
  await submitButton!.trigger("click");
  return wrapper.emitted("submit")!.at(-1)![0] as string;
}

describe("ProjectLoadDialog load-step options", () => {
  it("shows both project load steps selected by default", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);

    const checkboxes = wrapper.findAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.map((checkbox) => checkbox.element.checked)).toEqual([
      true,
      true,
    ]);
    expect(wrapper.text()).toContain("加载 AGENTS.md");
    expect(wrapper.text()).toContain("加载 Codegraph");
  });

  it("collapses advanced settings by default and renders them eagerly", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);

    const panelText = wrapper.find(
      '[data-panel-value="advanced"] [data-eager="true"]',
    );
    expect(panelText.exists()).toBe(true);
    const checkboxes = wrapper.findAll<HTMLInputElement>(
      '.load-steps input[type="checkbox"]',
    );
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].element.checked).toBe(true);
    expect(checkboxes[1].element.checked).toBe(true);
  });

  it("keeps advanced checkbox labels at body text size", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);

    const labels = wrapper.findAll(".load-steps .v-label");
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.classes()).toContain("text-body-2");
    }
  });

  it.each([
    [true, true, "/project load C:/projects/demo"],
    [false, true, "/project load C:/projects/demo no_agentsmd"],
    [true, false, "/project load C:/projects/demo no_codegraph"],
    [
      false,
      false,
      "/project load C:/projects/demo no_agentsmd no_codegraph",
    ],
  ])(
    "maps AGENTS.md=%s and Codegraph=%s to the expected command",
    async (loadAgentsMd, loadCodegraph, expected) => {
      const wrapper = mountDialog();
      await openDialog(wrapper);
      const checkboxes = wrapper.findAll<HTMLInputElement>(
        'input[type="checkbox"]',
      );

      if (!loadAgentsMd) await checkboxes[0].setValue(false);
      if (!loadCodegraph) await checkboxes[1].setValue(false);

      expect(await submitPath(wrapper, "C:/projects/demo")).toBe(expected);
    },
  );

  it("quotes a whitespace path before appending flags", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);
    const checkboxes = wrapper.findAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    await checkboxes[1].setValue(false);

    expect(await submitPath(wrapper, "C:/projects/my app")).toBe(
      '/project load "C:/projects/my app" no_codegraph',
    );
  });

  it("restores both selections every time the dialog opens", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);
    let checkboxes = wrapper.findAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    await checkboxes[0].setValue(false);
    await checkboxes[1].setValue(false);

    (
      wrapper.vm as unknown as {
        closeLoadDialog: () => void;
      }
    ).closeLoadDialog();
    await nextTick();
    await openDialog(wrapper);

    checkboxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes.map((checkbox) => checkbox.element.checked)).toEqual([
      true,
      true,
    ]);
  });

  it("keeps the Codegraph-only dialog free of project load flags", async () => {
    const wrapper = mountDialog("codegraph");
    await openDialog(wrapper);

    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);
    expect(await submitPath(wrapper, "C:/projects/demo")).toBe(
      "/codegraph set C:/projects/demo",
    );
  });
});
