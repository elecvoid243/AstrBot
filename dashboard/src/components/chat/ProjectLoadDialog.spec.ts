// Author: elecvoid243, 2026-07-25 (redesigned 2026-07-31)
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, nextTick, ref, type PropType } from "vue";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────
// The redesigned dialog reads the loaded-project chip (to decide whether
// to prompt for overwrite) and the injected confirm dialog directly, so
// both are mocked here. The hoisted factory must NOT use `ref` (importing
// `vue` at module top level while also mocking a composable creates an
// init-cycle), so it only builds plain data + a plain vi.fn; the reactive
// ref is created below, after the vue import has finished initializing.
const { plainStatus, mockConfirm } = vi.hoisted(() => ({
  plainStatus: {
    loaded: false,
    directory: null,
    loadedAt: null,
    umo: null,
    allLoadedCount: 0,
    fetchedAt: 0,
  },
  mockConfirm: vi.fn(),
}));

vi.mock("@/composables/useSpcodeProjectStatus", () => ({
  useSpcodeProjectStatus: () => ({ status: mockStatus }),
}));

vi.mock("@/utils/confirmDialog", () => ({
  useConfirmDialog: () => mockConfirm,
}));

// Reactive view of the plain hoisted status. Re-assigning
// `mockStatus.value` in `beforeEach` flips `loaded` per test.
const mockStatus = ref(plainStatus);

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

// `buttonStub` mirrors the `value` prop (passed via fallthrough attrs by
// `v-btn` inside a `v-btn-toggle`) onto a `data-value` attribute so the
// `v-btn-toggle` stub below can read which option was clicked from the
// native click event that bubbles up to it.
const buttonStub = defineComponent({
  props: {
    disabled: { type: Boolean, default: false },
  },
  emits: ["click"],
  template: `
    <button :disabled="disabled" :data-value="$attrs.value" @click="$emit('click')">
      <slot />
    </button>
  `,
});

// Lightweight `v-btn-toggle` stub: it renders its `v-btn` slot and, on a
// bubbling native click, re-emits the clicked button's `data-value` as
// the new model value. This lets tests drive the segmented controls
// (load mode / project kind) without a full Vuetify group binding.
const btnToggleStub = defineComponent({
  props: {
    modelValue: { type: String as PropType<string | null>, default: null },
  },
  emits: ["update:modelValue"],
  template: `<div class="v-btn-toggle" @click="onClick"><slot /></div>`,
  methods: {
    onClick(e: Event) {
      const target = e.target as HTMLElement | null;
      const button = target?.closest?.("button") as HTMLElement | null;
      const value = button?.dataset?.value;
      if (value !== undefined && value !== "") {
        this.$emit("update:modelValue", value);
      }
    },
  },
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
  "v-btn-toggle": btnToggleStub,
  "v-divider": { template: "<hr />" },
  "v-spacer": { template: "<span />" },
  "v-list": { template: "<div><slot /></div>" },
  "v-list-item": { template: "<div><slot /></div>" },
  "v-list-item-title": { template: "<div><slot /></div>" },
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

function buttonByText(wrapper: VueWrapper, text: string) {
  const found = wrapper
    .findAll("button")
    .find((button) => button.text().trim() === text);
  expect(found, `button with text "${text}" not found`).toBeDefined();
  return found!;
}

async function clickOption(wrapper: VueWrapper, text: string): Promise<void> {
  await buttonByText(wrapper, text).trigger("click");
  await nextTick();
}

async function submitPath(wrapper: VueWrapper, path: string): Promise<string> {
  await wrapper.get('[data-testid="project-path"]').setValue(path);
  await buttonByText(wrapper, "加载").trigger("click");
  await nextTick();
  return wrapper.emitted("submit")!.at(-1)![0] as string;
}

function checkboxStates(wrapper: VueWrapper): boolean[] {
  return wrapper
    .findAll<HTMLInputElement>('input[type="checkbox"]')
    .map((checkbox) => checkbox.element.checked);
}

beforeEach(() => {
  mockStatus.value = {
    loaded: false,
    directory: null,
    loadedAt: null,
    umo: null,
    allLoadedCount: 0,
    fetchedAt: 0,
  };
  mockConfirm.mockReset();
});

describe("ProjectLoadDialog load-step options", () => {
  it("shows both project load steps selected by default (existing + code)", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);

    expect(checkboxStates(wrapper)).toEqual([true, true]);
    expect(wrapper.text()).toContain("加载 AGENTS.md");
    expect(wrapper.text()).toContain("加载 Codegraph");
  });

  it("renders the mode and kind segmented controls with always-visible options", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);

    const text = wrapper.text();
    expect(text).toContain("加载已有项目");
    expect(text).toContain("新建一个项目");
    expect(text).toContain("代码项目");
    expect(text).toContain("普通项目");
    // The old "Advanced settings" expansion panel is gone: the two
    // checkboxes are visible without expanding anything.
    expect(text).not.toContain("高级设置");
  });

  it("switching to create hides AGENTS.md/Codegraph and shows auto-init-git on", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);

    await clickOption(wrapper, "新建一个项目");

    expect(checkboxStates(wrapper)).toEqual([true]);
    expect(wrapper.text()).toContain("自动初始化 Git 仓库");
    expect(wrapper.text()).not.toContain("加载 AGENTS.md");
    expect(wrapper.text()).not.toContain("加载 Codegraph");
  });

  it("switching kind to plain unchecks both, switching back to code rechecks", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);

    await clickOption(wrapper, "普通项目");
    expect(checkboxStates(wrapper)).toEqual([false, false]);

    await clickOption(wrapper, "代码项目");
    expect(checkboxStates(wrapper)).toEqual([true, true]);
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

  it("create mode submits with create + git_init and skips AGENTS.md/Codegraph", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);
    await clickOption(wrapper, "新建一个项目");

    expect(await submitPath(wrapper, "C:/projects/new")).toBe(
      "/project load C:/projects/new no_agentsmd no_codegraph create git_init",
    );
  });

  it("create mode without auto-init-git omits git_init", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);
    await clickOption(wrapper, "新建一个项目");
    await wrapper
      .findAll<HTMLInputElement>('input[type="checkbox"]')[0]
      .setValue(false);

    expect(await submitPath(wrapper, "C:/projects/new")).toBe(
      "/project load C:/projects/new no_agentsmd no_codegraph create",
    );
  });

  it("existing plain project submits without create/git_init", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);
    await clickOption(wrapper, "普通项目");

    expect(await submitPath(wrapper, "C:/projects/notes")).toBe(
      "/project load C:/projects/notes no_agentsmd no_codegraph",
    );
  });

  it("appends replace when a project is loaded and the user confirms overwrite", async () => {
    mockStatus.value.loaded = true;
    mockConfirm.mockResolvedValueOnce(true);
    const wrapper = mountDialog();
    await openDialog(wrapper);

    const command = await submitPath(wrapper, "C:/projects/other");

    expect(command).toBe("/project load C:/projects/other replace");
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not submit when the overwrite prompt is cancelled", async () => {
    mockStatus.value.loaded = true;
    mockConfirm.mockResolvedValueOnce(false);
    const wrapper = mountDialog();
    await openDialog(wrapper);
    await wrapper.get('[data-testid="project-path"]').setValue("C:/x");

    await buttonByText(wrapper, "加载").trigger("click");
    await nextTick();

    expect(wrapper.emitted("submit")).toBeUndefined();
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });

  it("restores every option to its default each time the dialog opens", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);
    await clickOption(wrapper, "新建一个项目");
    await clickOption(wrapper, "加载已有项目");
    await clickOption(wrapper, "普通项目");

    (
      wrapper.vm as unknown as {
        closeLoadDialog: () => void;
      }
    ).closeLoadDialog();
    await nextTick();
    await openDialog(wrapper);

    expect(checkboxStates(wrapper)).toEqual([true, true]);
    expect(wrapper.text()).not.toContain("自动初始化 Git 仓库");
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
