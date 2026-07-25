<!--
  Author: elecvoid243, 2026-07-23

  SpcodeVivadoStatusChip — status badge for vivado MCP server state.

  Visual states (derived from the /spcode/vivado-status API):
    - ok (running + sessions available)
        → success dot + mdi-chip + "Vivado 已就绪" + session count
    - degraded (running but sessions read failed)
        → warning dot + mdi-alert-circle-outline + "会话数据暂不可用"
    - not_installed (vivado-mcp package missing)
        → error dot + mdi-package-variant-closed + "vivado-mcp 未安装"
    - not_running (MCP server down)
        → neutral empty dot + mdi-server-off + "Vivado 未启动"
    - disabled (config disabled)
        → neutral empty dot + mdi-server-off-outline + "Vivado 未启用"

  Event contract:
    - Emits `open-vivado-dialog` on click (for future dialog expansion)
-->
<script setup lang="ts">
import { computed } from "vue";
import { useSpcodeVivadoStatus } from "@/composables/useSpcodeVivadoStatus";

const emit = defineEmits<{
  (e: "open-vivado-dialog"): void;
}>();

const { status } = useSpcodeVivadoStatus();

const isOk = computed<boolean>(() => status.value.overall === "ok");
const isDegraded = computed<boolean>(() => status.value.overall === "degraded");
const isNotInstalled = computed<boolean>(
  () => status.value.overall === "not_installed",
);
const isNotRunning = computed<boolean>(
  () => status.value.overall === "not_running",
);
const isDisabled = computed<boolean>(() => status.value.overall === "disabled");
const isToolchainMissing = computed<boolean>(
  () => status.value.overall === "toolchain_missing",
);

const dotClass = computed<Record<string, boolean>>(() => ({
  "sp-status-badge__dot--success": isOk.value,
  "sp-status-badge__dot--warning": isDegraded.value,
  "sp-status-badge__dot--error":
    isNotInstalled.value || isToolchainMissing.value,
  "sp-status-badge__dot--neutral": isNotRunning.value || isDisabled.value,
}));

const icon = computed<string>(() => {
  if (isOk.value) return "mdi-chip";
  if (isDegraded.value) return "mdi-alert-circle-outline";
  if (isNotInstalled.value) return "mdi-package-variant-closed";
  if (isToolchainMissing.value) return "mdi-tools";
  if (isNotRunning.value) return "mdi-server-off";
  return "mdi-server-off-outline";
});

const label = computed<string>(() => {
  if (isOk.value) return "Vivado 已就绪";
  if (isDegraded.value) return "会话数据暂不可用";
  if (isNotInstalled.value) return "vivado-mcp 未安装";
  if (isToolchainMissing.value) return "Vivado 工具链未找到";
  if (isNotRunning.value) return "Vivado 未启动";
  return "Vivado 未启用";
});

const isEmptyState = computed<boolean>(
  () => isNotRunning.value || isDisabled.value,
);

const sessionCount = computed<number>(() => status.value.sessions.length);
const activeCount = computed<number>(
  () => status.value.sessions.filter((s) => s.state === "busy").length,
);

const showMeta = computed<boolean>(
  () => isOk.value && sessionCount.value > 0,
);

const metaText = computed<string>(() => {
  if (!isOk.value) return "";
  if (activeCount.value > 0) {
    return `${sessionCount.value}s · ${activeCount.value}busy`;
  }
  return `${sessionCount.value}s`;
});

const metaTooltip = computed<string>(() => {
  if (!isOk.value) return "";
  const sessions = status.value.sessions
    .map((s) => `${s.id}: ${s.state}`)
    .join(" · ");
  return `会话: ${sessions}`;
});

const tooltipText = computed<string>(() => {
  const msg = status.value.message;
  if (isOk.value) {
    if (status.value.vivadoPath) {
      return `${msg} · ${status.value.vivadoPath}`;
    }
    return msg;
  }
  return msg;
});
</script>

<template>
  <v-tooltip location="bottom" :open-delay="200">
    <template #activator="{ props: tipProps }">
      <button
        v-bind="tipProps"
        type="button"
        :class="['sp-status-badge', { 'sp-status-badge--empty': isEmptyState }]"
        :aria-label="tooltipText"
        @click="emit('open-vivado-dialog')"
      >
        <span
          class="sp-status-badge__dot"
          :class="dotClass"
          aria-hidden="true"
        />
        <v-icon size="14" class="sp-status-badge__icon">{{ icon }}</v-icon>
        <span class="sp-status-badge__label">{{ label }}</span>
        <span
          v-if="showMeta"
          class="sp-status-badge__meta"
          :title="metaTooltip"
        >
          {{ metaText }}
        </span>
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
.sp-status-badge__dot--error {
  background: var(--sp-status-dot-error);
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

.sp-status-badge__meta {
  font-family: var(--v-font-mono, monospace);
  font-size: 11px;
  font-weight: 500;
  color: var(--sp-text-path);
  white-space: nowrap;
}
</style>
