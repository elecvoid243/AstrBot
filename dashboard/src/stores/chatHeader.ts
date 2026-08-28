import { defineStore } from "pinia";

/** Summary shown on the app-bar todo entry button; null = no active todos. */
export interface TodoBadge {
  done: number;
  total: number;
  attention: number;
}

export const useChatHeaderStore = defineStore("chatHeader", {
  state: () => ({
    title: "",
    subtitle: "",
    projectId: "",
    workspaceFilesOpen: false,
    // 2026-08-28: persistent TodoSidebar entry. The floating todo
    // summary bar is not always present (it disappears on refresh until
    // the history replay lands, and vanishes on todo_clear), so the
    // open state + a compact progress badge live here where the
    // VerticalHeader app-bar button can reach them. Chat.vue owns the
    // badge content (it has the useMessages snapshot) and syncs it in.
    todoSidebarOpen: false,
    todoBadge: null as TodoBadge | null,
  }),

  actions: {
    SET_CONTEXT(payload: {
      title?: string;
      subtitle?: string;
      projectId?: string;
    }) {
      const nextProjectId = payload.projectId || "";
      if (this.projectId !== nextProjectId) {
        this.workspaceFilesOpen = false;
      }
      this.title = payload.title || "";
      this.subtitle = payload.subtitle || "";
      this.projectId = nextProjectId;
    },
    TOGGLE_WORKSPACE_FILES() {
      if (this.projectId) {
        this.workspaceFilesOpen = !this.workspaceFilesOpen;
      }
    },
    SET_WORKSPACE_FILES_OPEN(open: boolean) {
      this.workspaceFilesOpen = Boolean(open && this.projectId);
    },
    TOGGLE_TODO_SIDEBAR() {
      this.todoSidebarOpen = !this.todoSidebarOpen;
    },
    SET_TODO_SIDEBAR_OPEN(open: boolean) {
      this.todoSidebarOpen = Boolean(open);
    },
    SET_TODO_BADGE(badge: TodoBadge | null) {
      this.todoBadge = badge;
    },
    CLEAR_CONTEXT() {
      this.title = "";
      this.subtitle = "";
      this.projectId = "";
      this.workspaceFilesOpen = false;
      this.todoSidebarOpen = false;
      this.todoBadge = null;
    },
  },
});
