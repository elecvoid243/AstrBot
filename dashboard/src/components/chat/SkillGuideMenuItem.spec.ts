// SkillGuideMenuItem.spec.ts
// Author: elecvoid243 @ 2026-08-16
//
// Unit tests for the "手动加载 Skill" entry inside the chat input's "+"
// menu (astrbot_plugin_skill_guide companion UI).
//
// The skill list is a COMPLETELY SEPARATE v-menu (content teleported to
// <body>, positioned next to the item via location="end") — it never
// participates in the "+" menu's DOM/layout. The card is a plain div so
// hover close binds directly to it. Open/close is self-managed: the menu
// ALWAYS closes when the pointer leaves, even after a skill was selected.
// Un-selecting one skill keeps the others.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/v1", () => ({
  pluginExtensionApi: { get: vi.fn(), post: vi.fn() },
}));

// Self-contained i18n mock (returns the key + k=v params), same shape
// as GitRepoInitPrompt.spec.ts — no dependency on the real tables.
const tmMock = vi.fn(
  (key: string, params?: Record<string, string | number>) => {
    if (!params) return key;
    return Object.entries(params).reduce(
      (acc, [k, v]) => `${acc} ${k}=${String(v)}`,
      key,
    );
  },
);
vi.mock("@/i18n/composables", () => ({
  useModuleI18n: () => ({ tm: tmMock, getRaw: vi.fn() }),
}));

import { pluginExtensionApi } from "@/api/v1";
import { useSkillGuide } from "@/composables/useSkillGuide";
import SkillGuideMenuItem from "./SkillGuideMenuItem.vue";

const getMock = pluginExtensionApi.get as ReturnType<typeof vi.fn>;
const postMock = pluginExtensionApi.post as ReturnType<typeof vi.fn>;

const UMO = "webchat:FriendMessage:webchat!alice!sess-1";

const ACTIVE_PAYLOAD = {
  status: "ok",
  data: {
    persona: { id: "p1", name: "Default" },
    skills: [
      {
        name: "brainstorming",
        description: "Explore intent before implementation",
        path: "skills/brainstorming",
        source_type: "builtin",
      },
      {
        name: "pdf",
        description: "Work with PDF files",
        path: "skills/pdf",
        source_type: "builtin",
      },
    ],
  },
};

const okLoad = (skillName: string) => ({
  data: { status: "ok", data: { skill_name: skillName, queued: true } },
});
const okClear = (cleared: string[]) => ({
  data: { status: "ok", data: { cleared } },
});

// v-menu stub: driven by v-model (the component owns `open`), content
// renders only while open. The activator forwards clicks so "open on
// click" keeps working (hover is handled by the component itself).
const menuStub = defineComponent({
  props: { modelValue: { type: Boolean, default: false } },
  emits: ["update:modelValue"],
  setup(props) {
    const open = computed(() => props.modelValue);
    return { open };
  },
  template: `<div class="v-menu-stub"><slot name="activator" :props="{ onClick: () => $emit('update:modelValue', true) }" /><slot v-if="open" /></div>`,
});

// The card and skill rows are plain elements (not Vuetify components), so
// only the activator v-list-item needs a stub.
const stubs = {
  "v-menu": menuStub,
  "v-icon": { template: "<i><slot /></i>" },
  "v-list-item": {
    props: ["disabled"],
    emits: ["click"],
    template: `<div v-bind="$attrs" class="v-list-item-stub" :disabled="disabled" @click="$emit('click')"><slot name="prepend" /><slot /></div>`,
  },
  "v-list-item-title": { template: "<span><slot /></span>" },
};

function mountItem(props: Record<string, unknown> = {}) {
  return mount(SkillGuideMenuItem, {
    props: { sessionId: "sess-1", ...props },
    global: { stubs },
  });
}

/** Prime the singleton with a successful /skill-guide/active fetch. */
async function primeSession(payload: unknown = ACTIVE_PAYLOAD) {
  getMock.mockResolvedValue({ data: payload });
  await useSkillGuide().setSession(UMO);
}

async function openByHover(wrapper: ReturnType<typeof mountItem>) {
  await wrapper.find('[data-test="skill-guide-menu-item"]').trigger("mouseenter");
  await flushPromises();
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  useSkillGuide().reset();
});

afterEach(() => {
  useSkillGuide().reset();
  vi.useRealTimers();
});

describe("SkillGuideMenuItem — rendering & hover", () => {
  it("renders as a regular menu item and disables it without a session", () => {
    const wrapper = mountItem({ sessionId: null });
    const item = wrapper.find('[data-test="skill-guide-menu-item"]');
    expect(item.exists()).toBe(true);
    expect(item.attributes("disabled")).toBeDefined();
  });

  it("opens the separate skill menu on hover and lists the session's skills", async () => {
    await primeSession();
    const wrapper = mountItem();
    expect(
      wrapper.find('[data-test="skill-guide-item-brainstorming"]').exists(),
    ).toBe(false);

    await openByHover(wrapper);

    expect(wrapper.text()).toContain("brainstorming");
    expect(wrapper.text()).toContain("pdf");
  });

  it("also opens on click", async () => {
    await primeSession();
    const wrapper = mountItem();
    await wrapper.find('[data-test="skill-guide-menu-item"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("brainstorming");
  });

  it("closes when the pointer leaves, even after a skill was selected", async () => {
    await primeSession();
    const wrapper = mountItem();
    await openByHover(wrapper);

    // Interact with the content: select a skill (real timers here — the
    // singleton's async toggle must complete before we fake timers).
    postMock.mockResolvedValue(okLoad("brainstorming"));
    await wrapper
      .find('[data-test="skill-guide-item-brainstorming"]')
      .trigger("click");
    await flushPromises();
    expect(
      wrapper.find('[data-test="skill-guide-item-brainstorming"]').exists(),
    ).toBe(true);

    // Leaving the card still closes the menu (uniform rule).
    vi.useFakeTimers();
    await wrapper
      .find('[data-test="skill-guide-menu-card"]')
      .trigger("mouseleave");
    await vi.advanceTimersByTimeAsync(200);
    expect(
      wrapper.find('[data-test="skill-guide-item-brainstorming"]').exists(),
    ).toBe(false);
  });
});

describe("SkillGuideMenuItem — independent menu & size caps", () => {
  it("is a separate v-menu (not part of the '+' menu layout) with teleported content", () => {
    const source = readFileSync(
      resolve("src/components/chat/SkillGuideMenuItem.vue"),
      "utf-8",
    );
    // The component root is its own <v-menu>, self-managed via v-model.
    expect(source).toMatch(/<v-menu/);
    expect(source).toMatch(/v-model="open"/);
    // Content is a plain card decoupled from the '+' menu's v-list layout.
    expect(source).toMatch(/class="skill-guide-menu-card"/);
  });

  it("caps height (scroll) and width (ellipsis truncation)", () => {
    const source = readFileSync(
      resolve("src/components/chat/SkillGuideMenuItem.vue"),
      "utf-8",
    );
    const listRule =
      source.match(/\.skill-guide-menu-card__list\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(listRule).toMatch(/max-height:\s*min\(48vh,\s*320px\)/);
    expect(listRule).toMatch(/overflow-y:\s*auto/);

    const cardRule =
      source.match(/\.skill-guide-menu-card\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(cardRule).toMatch(/min-width:\s*300px/);
    expect(cardRule).toMatch(/max-width:\s*340px/);

    const descRule =
      source.match(/\.skill-guide-menu-card__item-desc\s*\{([^}]*)\}/)?.[1] ??
      "";
    expect(descRule).toMatch(/text-overflow:\s*ellipsis/);
    expect(descRule).toMatch(/white-space:\s*nowrap/);
  });
});

describe("SkillGuideMenuItem — list states & queueing", () => {
  it("shows the empty state when the session has no active skills", async () => {
    await primeSession({
      status: "ok",
      data: { persona: null, skills: [] },
    });
    const wrapper = mountItem();
    await openByHover(wrapper);
    expect(wrapper.find('[data-test="skill-guide-empty"]').exists()).toBe(true);
  });

  it("shows the load-failed state when the plugin cannot be reached", async () => {
    getMock.mockRejectedValue(new Error("404"));
    await useSkillGuide().setSession(UMO);
    const wrapper = mountItem();
    await openByHover(wrapper);
    expect(wrapper.find('[data-test="skill-guide-load-failed"]').exists()).toBe(
      true,
    );
  });

  it("queues a skill via POST /skill-guide/load and marks it queued", async () => {
    await primeSession();
    postMock.mockResolvedValue(okLoad("brainstorming"));
    const wrapper = mountItem();
    await openByHover(wrapper);

    await wrapper
      .find('[data-test="skill-guide-item-brainstorming"]')
      .trigger("click");
    await flushPromises();

    expect(postMock).toHaveBeenCalledWith("skill-guide/load", {
      umo: UMO,
      skill_name: "brainstorming",
    });
    const item = wrapper.find('[data-test="skill-guide-item-brainstorming"]');
    expect(item.classes()).toContain(
      "skill-guide-menu-card__item--queued",
    );
    expect(item.text()).toContain("input.skillGuide.queued");
    expect(wrapper.find('[data-test="skill-guide-pop-count"]').text()).toBe(
      "1",
    );
  });

  it("un-queues a SINGLE skill and keeps the other selected skills", async () => {
    await primeSession();
    const wrapper = mountItem();
    await openByHover(wrapper);

    // Select two skills.
    postMock.mockResolvedValue(okLoad("brainstorming"));
    await wrapper
      .find('[data-test="skill-guide-item-brainstorming"]')
      .trigger("click");
    await flushPromises();
    postMock.mockResolvedValue(okLoad("pdf"));
    await wrapper.find('[data-test="skill-guide-item-pdf"]').trigger("click");
    await flushPromises();
    expect(useSkillGuide().queued.value).toEqual(["brainstorming", "pdf"]);

    // Un-select one: clear the whole server queue, then re-queue the rest.
    postMock.mockReset();
    postMock
      .mockResolvedValueOnce(okClear(["brainstorming", "pdf"]))
      .mockResolvedValueOnce(okLoad("pdf"));
    await wrapper
      .find('[data-test="skill-guide-item-brainstorming"]')
      .trigger("click");
    await flushPromises();

    expect(useSkillGuide().queued.value).toEqual(["pdf"]);
    expect(postMock.mock.calls).toEqual([
      ["skill-guide/clear", { umo: UMO }],
      ["skill-guide/load", { umo: UMO, skill_name: "pdf" }],
    ]);
    expect(
      wrapper
        .find('[data-test="skill-guide-item-brainstorming"]')
        .classes(),
    ).not.toContain("skill-guide-menu-card__item--queued");
    expect(
      wrapper.find('[data-test="skill-guide-item-pdf"]').classes(),
    ).toContain("skill-guide-menu-card__item--queued");
  });

  it("clears the whole queue via POST /skill-guide/clear", async () => {
    await primeSession();
    postMock.mockResolvedValue(okLoad("pdf"));
    await useSkillGuide().toggleSkill("pdf");

    const wrapper = mountItem();
    await openByHover(wrapper);

    postMock.mockReset();
    postMock.mockResolvedValue(okClear(["pdf"]));
    await wrapper.find('[data-test="skill-guide-clear-all"]').trigger("click");
    await flushPromises();

    expect(postMock).toHaveBeenCalledWith("skill-guide/clear", { umo: UMO });
    expect(
      wrapper.find('[data-test="skill-guide-item-pdf"]').classes(),
    ).not.toContain("skill-guide-menu-card__item--queued");
    expect(wrapper.find('[data-test="skill-guide-pop-count"]').exists()).toBe(
      false,
    );
  });
});
