// Author: elecvoid243
// Date: 2026-09-01
//
// The flat session list in Chat.vue excludes project sessions (backend
// `exclude_project_sessions=True`), so ProjectList is their only sidebar
// renderer. These tests pin the ask_user_choice highlight contract on the
// project session rows: rows and pulsing dots must react to the shared
// interactiveChoiceAttention store exactly like the flat list does.

import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useInteractiveChoiceAttentionStore } from "@/stores/interactiveChoiceAttention";
import ProjectList, { type Project } from "./ProjectList.vue";

const project: Project = {
  project_id: "p1",
  title: "Demo Project",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

function mountList() {
  return mount(ProjectList, {
    props: {
      projects: [project],
      projectSessions: {
        p1: [{ session_id: "sess-1", updated_at: "2026-09-01T00:00:00Z" }],
      },
      loadingProjectIds: [],
    },
    global: {
      plugins: [createPinia()],
      stubs: {
        "v-btn": true,
        "v-checkbox-btn": true,
        "v-list-item": true,
        "v-progress-circular": true,
      },
    },
  });
}

describe("ProjectList ask_user_choice highlight", () => {
  beforeEach(() => {
    localStorage.removeItem("chat.projectExpandedIds");
    localStorage.setItem("chat.projectExpandedIds", JSON.stringify(["p1"]));
  });

  it("renders plain rows without highlight when no choice is pending", () => {
    const wrapper = mountList();
    const row = wrapper.find(".project-session-row");

    expect(row.exists()).toBe(true);
    expect(row.classes()).not.toContain("needs-choice");
    expect(wrapper.find(".project-session-choice-dot").exists()).toBe(false);
  });

  it("highlights rows and shows the pulsing dot for pending sessions", async () => {
    const wrapper = mountList();
    const store = useInteractiveChoiceAttentionStore();
    store.add("sess-1");
    await wrapper.vm.$nextTick();

    const row = wrapper.find(".project-session-row");
    expect(row.classes()).toContain("needs-choice");
    expect(wrapper.find(".project-session-choice-dot").exists()).toBe(true);
  });

  it("drops the highlight reactively once the choice is resolved", async () => {
    const wrapper = mountList();
    const store = useInteractiveChoiceAttentionStore();
    store.add("sess-1");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".project-session-row").classes()).toContain(
      "needs-choice",
    );

    store.clear("sess-1");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".project-session-row").classes()).not.toContain(
      "needs-choice",
    );
    expect(wrapper.find(".project-session-choice-dot").exists()).toBe(false);
  });
});
