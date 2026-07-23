<!--
  Author: elecvoid243, 2026-07-09
  Spec: docs/superpowers/specs/2026-07-09-chat-input-chips-beautify-design.md §5.1, §5.2

  SpcodeCodegraphChip — status badge for codegraph MCP server state.

  Visual states (v2, 2026-07-23 — inline path removed to keep the
  status row compact when the Vivado chip sits to the right):
    - mcpRunning + matched → success dot + mdi-database-check + "Codegraph 已连接"
    - mcpRunning + mismatch → warning dot + mdi-alert-circle-outline + "Codegraph 路径不匹配"
    - mcp not running → empty neutral dot (NOT RED) + mdi-database-off-outline
    - mcp running but no project → empty neutral dot + mdi-database-remove-outline

  Path details are only visible via the hover tooltip.

  Event contract (unchanged):
    - Emits `open-codegraph-dialog` on click
-->
<script setup lang="ts">
import { computed } from "vue";
import { useSpcodeCodegraphStatus } from "@/composables/useSpcodeCodegraphStatus";
import { useSpcodeProjectStatus } from "@/composables/useSpcodeProjectStatus";

const emit = defineEmits<{
  (e: "open-codegraph-dialog"): void;
}>();

const { status } = useSpcodeCodegraphStatus();
const projectStatus = useSpcodeProjectStatus();

const mcpOk = computed<boolean>(() => status.value.mcpRunning);
const hasProject = computed<boolean>(
  () => status.value.activeProject.length > 0,
);
const loadedProjectDir = computed<string | null>(
  () => projectStatus.status.value.directory,
);
const projectMatch = computed<boolean>(() => {
  if (!loadedProjectDir.value || !hasProject.value) return false;
  return status.value.activeProject === loadedProjectDir.value;
});

const icon = computed<string>(() => {
  if (!mcpOk.value) return "mdi-database-off-outline";
  if (!hasProject.value) return "mdi-database-remove-outline";
  if (!projectMatch.value) return "mdi-alert-circle-outline";
  return "mdi-database-check";
});

const label = computed<string>(() => {
  if (!mcpOk.value) return "Codegraph 未启动";
  if (!hasProject.value) return "Codegraph 未加载";
  if (!projectMatch.value) return "Codegraph 路径不匹配";
  return "Codegraph 已连接";
});

const tooltipText = computed<string>(() => {
  if (!mcpOk.value) return "MCP 未运行, codegraph 不可用";
  if (!hasProject.value) return "Codegraph 未加载项目";
  if (!projectMatch.value) {
    const parts: string[] = [
      "警告: codegraph 项目与当前加载项目不一致",
      `codegraph: ${status.value.activeProject}`,
    ];
    if (loadedProjectDir.value) {
      parts.push(`加载项目: ${loadedProjectDir.value}`);
    }
    return parts.join(" · ");
  }
  return `Codegraph 已连接 · ${status.value.activeProject}`;
});

const isEmptyState = computed<boolean>(() => !mcpOk.value || !hasProject.value);
</script>

<template>
  <v-tooltip location="bottom" :open-delay="200">
    <template #activator="{ props: tipProps }">
      <button
        v-bind="tipProps"
        type="button"
        :class="['sp-status-badge', { 'sp-status-badge--empty': isEmptyState }]"
        :aria-label="tooltipText"
        @click="emit('open-codegraph-dialog')"
      >
        <span
          class="sp-status-badge__dot"
          :class="{
            'sp-status-badge__dot--success':
              mcpOk && hasProject && projectMatch,
            'sp-status-badge__dot--warning':
              mcpOk && hasProject && !projectMatch,
            'sp-status-badge__dot--neutral': !mcpOk || !hasProject,
          }"
          aria-hidden="true"
        />
        <v-icon size="14" class="sp-status-badge__icon">{{ icon }}</v-icon>
        <span class="sp-status-badge__label">{{ label }}</span>
      </button>
    </template>
    <span>{{ tooltipText }}</span>
  </v-tooltip>
</template>

<style scoped>
.sp-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--sp-chip-height);
  padding: 0 10px;
  border: 1px solid var(--sp-chip-border);
  border-radius: 12px;
  background: var(--sp-chip-bg);
  color: var(--sp-text-primary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 150ms ease;
  max-width: 100%;
  min-width: 0;
}

.sp-status-badge:hover {
  background: var(--sp-chip-hover-bg);
}
.sp-status-badge:active {
  background: var(--sp-chip-active-bg);
}
.sp-status-badge:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.sp-status-badge__dot {
  flex: 0 0 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--sp-status-dot-success);
  transition: background-color 200ms ease;
}

.sp-status-badge__dot--warning {
  background: var(--sp-status-dot-warning);
}
.sp-status-badge__dot--neutral {
  background: var(--sp-status-dot-neutral);
}

.sp-status-badge--empty .sp-status-badge__dot {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--sp-status-dot-neutral);
}

.sp-status-badge__icon {
  flex: 0 0 14px;
  color: rgb(var(--v-theme-primary));
}

.sp-status-badge__label {
  white-space: nowrap;
}
</style>
