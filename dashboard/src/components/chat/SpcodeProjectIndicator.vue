<!--
  Author: elecvoid243, 2026-07-09
  Spec: docs/superpowers/specs/2026-07-09-chat-input-chips-beautify-design.md §5.1, §5.2

  SpcodeProjectIndicator — status badge for the loaded/unloaded spcode project.

  Visual states (locked by spec §5.2):
    - Not loaded → empty state (empty dot ring + mdi-folder-outline + "未加载项目")
    - Loaded → success dot + mdi-folder-check-outline + "项目已加载" + truncated path

  Event contract (unchanged from prior version):
    - Emits `open-load-dialog` on click (suppressed while a silent
      operation is running)

  Progress states (2026-08-06, driven by useSpcodeOperationProgress):
    - project_load / project_unload running → spinning mdi-loading + currentStep
    - project_load / project_unload failed  → red error icon + chevron popover
      with the full substep log; click still opens the dialog for retry
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import { useSpcodeProjectStatus } from "@/composables/useSpcodeProjectStatus";
import { useSpcodeOperationProgress } from "@/composables/useSpcodeOperationProgress";
import { useSpcodeCodegraphStatus } from "@/composables/useSpcodeCodegraphStatus";
import { useSpcodeVivadoStatus } from "@/composables/useSpcodeVivadoStatus";

const { status } = useSpcodeProjectStatus();
const { tm } = useModuleI18n("features/chat");
const { progress } = useSpcodeOperationProgress();
const popoverOpen = ref(false);

const emit = defineEmits<{
  (e: "open-load-dialog"): void;
  (e: "open-codegraph-dialog"): void;
}>();

// Only project load/unload operations drive THIS chip. codegraph_set
// progress had a dedicated badge on the removed SpcodeCodegraphChip; the
// services popover now reflects codegraph state reactively instead.
const isProjectOp = computed(
  () =>
    progress.value.operation === "project_load" ||
    progress.value.operation === "project_unload",
);
const isLoading = computed(
  () => isProjectOp.value && progress.value.status === "running",
);
const isFailed = computed(
  () => isProjectOp.value && progress.value.status === "failed",
);

/**
 * Show only the basename of a loaded path so the chip stays compact;
 * the full path is available via the hover tooltip.
 */
function pathBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

const displayPath = computed(() =>
  status.value.loaded && status.value.directory
    ? pathBasename(status.value.directory)
    : "",
);

const loadedAtDisplay = computed(() => {
  if (!status.value.loadedAt) return "";
  const ts = status.value.loadedAt;
  const ms = ts > 1e12 ? ts : ts * 1000;
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  } catch {
    return "";
  }
});

const icon = computed(() => {
  if (isLoading.value) return "mdi-loading";
  if (isFailed.value) return "mdi-alert-circle-outline";
  return status.value.loaded ? "mdi-folder-check-outline" : "mdi-folder-outline";
});

const label = computed(() => {
  if (isLoading.value) {
    return (
      progress.value.currentStep || tm("spcodeProjectLoad.indicator.loading")
    );
  }
  if (isFailed.value) return tm("spcodeProjectLoad.indicator.failed");
  return status.value.loaded
    ? tm("spcodeProjectLoad.indicator.loadedLabel")
    : tm("spcodeProjectLoad.indicator.noProject");
});

const tooltipText = computed(() => {
  if (isLoading.value) return label.value;
  if (isFailed.value) {
    return progress.value.messages.at(-1) ?? label.value;
  }
  if (status.value.loaded) {
    const parts: string[] = [];
    if (status.value.directory) {
      parts.push(
        `${tm("spcodeProjectLoad.indicator.loadedLabel")} ${status.value.directory}`,
      );
    }
    if (loadedAtDisplay.value) {
      parts.push(
        `${tm("spcodeProjectLoad.indicator.loadedAtPrefix")}: ${loadedAtDisplay.value}`,
      );
    }
    return parts.join(" · ");
  }
  return tm("spcodeProjectLoad.indicator.noProject");
});

// ── 服务状态 popover (2026-08-15) ─────────────────────────────────────
// 原 SpcodeCodegraphChip / SpcodeVivadoStatusChip 移除后,两个 MCP 服务的
// 状态查看整合到 project chip 旁的小按钮 popover 中。数据源仍是同一对
// 模块级单例 composable(useSpcodeCodegraphStatus / useSpcodeVivadoStatus),
// ChatInput 的轮询/前台刷新逻辑继续驱动它们。
const servicesMenuOpen = ref(false);

const codegraph = useSpcodeCodegraphStatus();
const vivado = useSpcodeVivadoStatus();

// codegraph 状态只保留 3 态(mcpRunning × activeProject 两个维度)。
// 旧 SpcodeCodegraphChip 的"路径不匹配"(activeProject ≠ 当前加载项目目录,
// warning dot + "Codegraph 不匹配")已于 2026-08-15 随 chip 移除:system_prompt
// 已强制 LLM 每次调用 codegraph_explore 显式传 projectPath,默认目录与加载
// 项目是否一致不再影响查询结果,该提醒失去意义。
const codegraphState = computed(() => {
  const s = codegraph.status.value;
  const hasProject = s.activeProject.length > 0;
  if (s.mcpRunning && hasProject) {
    return {
      dot: "success",
      icon: "mdi-database-check",
      label: "Codegraph 已连接",
      detail: s.activeProject,
    };
  }
  if (s.mcpRunning) {
    return {
      dot: "neutral",
      icon: "mdi-database-remove-outline",
      label: "Codegraph 未加载",
      detail: "MCP 运行中但未设置项目",
    };
  }
  return {
    dot: "neutral",
    icon: "mdi-database-off-outline",
    label: "Codegraph 未启动",
    detail: "MCP 未运行, codegraph 不可用",
  };
});

const vivadoState = computed(() => {
  const s = vivado.status.value;
  switch (s.overall) {
    case "ok":
      return {
        dot: "success",
        icon: "mdi-chip",
        label: "Vivado 已就绪",
        detail: s.message,
      };
    case "degraded":
      return {
        dot: "warning",
        icon: "mdi-alert-circle-outline",
        label: "会话数据暂不可用",
        detail: s.message,
      };
    case "not_installed":
      return {
        dot: "error",
        icon: "mdi-package-variant-closed",
        label: "vivado-mcp 未安装",
        detail: s.message,
      };
    case "toolchain_missing":
      return {
        dot: "error",
        icon: "mdi-tools",
        label: "找不到Vivado",
        detail: s.message,
      };
    case "not_running":
      return {
        dot: "neutral",
        icon: "mdi-server-off",
        label: "Vivado 未启动",
        detail: s.message,
      };
    default:
      return {
        dot: "neutral",
        icon: "mdi-server-off-outline",
        label: "Vivado 未启用",
        detail: s.message,
      };
  }
});

/**
 * Codegraph 管理入口:关闭 popover 并委托给 ChatInput 打开
 * ``ProjectLoadDialog command-mode="codegraph"``(原 codegraph chip 的 click 行为)。
 */
function openCodegraphManager(): void {
  servicesMenuOpen.value = false;
  emit("open-codegraph-dialog");
}

function openLoadDialog(): void {
  if (isLoading.value) return; // one silent operation at a time
  emit("open-load-dialog");
}
</script>

<template>
  <div class="sp-chip-wrap">
    <v-tooltip location="bottom" :open-delay="200">
      <template #activator="{ props: tipProps }">
        <button
          v-bind="tipProps"
          type="button"
          :class="[
            'sp-status-badge',
            {
              'sp-status-badge--empty': !status.loaded && !isLoading && !isFailed,
              'sp-status-badge--failed': isFailed,
            },
          ]"
          :aria-label="tooltipText"
          @click="openLoadDialog"
        >
          <span
            class="sp-status-badge__dot"
            :class="{
              'sp-status-badge__dot--success': status.loaded && !isLoading && !isFailed,
              'sp-status-badge__dot--warning': isFailed,
              'sp-status-badge__dot--neutral': !status.loaded && !isLoading && !isFailed,
            }"
            aria-hidden="true"
          />
          <v-icon size="14" class="sp-status-badge__icon">{{ icon }}</v-icon>
          <span class="sp-status-badge__label">{{ label }}</span>
          <span
            v-if="displayPath && !isLoading && !isFailed"
            class="sp-status-badge__path"
            >{{ displayPath }}</span
          >
        </button>
      </template>
      <span>{{ tooltipText }}</span>
    </v-tooltip>

    <v-menu
      v-if="isFailed"
      v-model="popoverOpen"
      location="bottom start"
      transition="none"
    >
      <template #activator="{ props: menuProps }">
        <button
          v-bind="menuProps"
          class="sp-chip-details-btn"
          type="button"
          :aria-label="tm('spcodeProjectLoad.indicator.failedDetailTitle')"
          @click.stop
        >
          <v-icon size="14">mdi-chevron-down</v-icon>
        </button>
      </template>
      <v-card min-width="320" max-width="480">
        <v-card-text>
          <div class="sp-chip-popover-title">
            {{ tm("spcodeProjectLoad.indicator.failedDetailTitle") }}
          </div>
          <pre class="sp-chip-popover-messages">{{ progress.messages.join("\n") }}</pre>
        </v-card-text>
      </v-card>
    </v-menu>

    <!--
      Services status popover (2026-08-15): the codegraph + vivado status
      chips were removed from the input row; their status is now reachable
      through this small button next to the project chip. The popover shows
      both MCP services' state, plus a manage entry that re-opens the
      codegraph load dialog (same one the old chip opened).
    -->
    <v-menu
      v-model="servicesMenuOpen"
      location="bottom start"
      transition="none"
    >
      <template #activator="{ props: menuProps }">
        <v-tooltip location="bottom" :open-delay="200">
          <template #activator="{ props: tipProps }">
            <button
              v-bind="{ ...tipProps, ...menuProps }"
              type="button"
              class="sp-chip-services-btn"
              :aria-label="tm('spcodeProjectLoad.indicator.servicesTooltip')"
            >
              <v-icon size="14">mdi-server-network</v-icon>
            </button>
          </template>
          <span>{{ tm("spcodeProjectLoad.indicator.servicesTooltip") }}</span>
        </v-tooltip>
      </template>
      <v-card min-width="320" max-width="420">
        <v-card-text>
          <div class="sp-chip-popover-title">
            {{ tm("spcodeProjectLoad.indicator.servicesTitle") }}
          </div>
          <!-- Codegraph -->
          <div class="sp-svc-row">
            <span
              class="sp-svc-row__dot"
              :class="`sp-svc-row__dot--${codegraphState.dot}`"
              aria-hidden="true"
            />
            <v-icon size="14" class="sp-svc-row__icon">
              {{ codegraphState.icon }}
            </v-icon>
            <span class="sp-svc-row__label">{{ codegraphState.label }}</span>
            <button
              type="button"
              class="sp-svc-row__action"
              @click="openCodegraphManager"
            >
              {{ tm("spcodeProjectLoad.indicator.manageCodegraph") }}
            </button>
          </div>
          <div
            class="sp-svc-row__detail"
            :title="`${tm('spcodeProjectLoad.indicator.defaultProjectPrefix')}: ${codegraphState.detail}`"
          >
            {{ tm("spcodeProjectLoad.indicator.defaultProjectPrefix") }}:
            {{ codegraphState.detail }}
          </div>
          <!-- Vivado -->
          <div class="sp-svc-row">
            <span
              class="sp-svc-row__dot"
              :class="`sp-svc-row__dot--${vivadoState.dot}`"
              aria-hidden="true"
            />
            <v-icon size="14" class="sp-svc-row__icon">
              {{ vivadoState.icon }}
            </v-icon>
            <span class="sp-svc-row__label">{{ vivadoState.label }}</span>
          </div>
          <div class="sp-svc-row__detail" :title="vivadoState.detail">
            {{ vivadoState.detail }}
          </div>
        </v-card-text>
      </v-card>
    </v-menu>
  </div>
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
  max-width: min(240px, 100%);
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
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex-shrink: 1;
}

.sp-status-badge__path {
  font-family: var(--v-font-mono, monospace);
  font-size: 11px;
  font-weight: 400;
  color: var(--sp-text-path);
  max-width: 12rem;
  min-width: 0;
  flex-shrink: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Silent-operation progress states (2026-08-06) ── */
.sp-chip-wrap {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.sp-status-badge--failed {
  color: rgb(var(--v-theme-error));
}

.sp-status-badge--failed .sp-status-badge__icon {
  color: rgb(var(--v-theme-error));
}

.sp-status-badge .mdi-loading {
  animation: sp-rotate 1s linear infinite;
}

@keyframes sp-rotate {
  to {
    transform: rotate(360deg);
  }
}

.sp-chip-details-btn {
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-error));
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  padding: 0;
}

.sp-chip-popover-title {
  font-weight: 600;
  margin-bottom: 8px;
}

.sp-chip-popover-messages {
  margin: 0;
  white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
  max-height: 240px;
  overflow-y: auto;
}

/* ── Services status popover (2026-08-15) ── */
.sp-chip-services-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--sp-chip-height);
  height: var(--sp-chip-height);
  padding: 0;
  border: 1px solid var(--sp-chip-border);
  border-radius: 10px;
  background: var(--sp-chip-bg);
  color: var(--sp-text-primary);
  cursor: pointer;
  transition: background-color 150ms ease;
}

.sp-chip-services-btn:hover {
  background: var(--sp-chip-hover-bg);
}
.sp-chip-services-btn:active {
  background: var(--sp-chip-active-bg);
}
.sp-chip-services-btn:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.sp-svc-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.sp-svc-row__dot {
  flex: 0 0 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.sp-svc-row__dot--success {
  background: var(--sp-status-dot-success);
}
.sp-svc-row__dot--warning {
  background: var(--sp-status-dot-warning);
}
.sp-svc-row__dot--error {
  background: var(--sp-status-dot-error);
}
.sp-svc-row__dot--neutral {
  background: var(--sp-status-dot-neutral);
}

.sp-svc-row__icon {
  flex: 0 0 14px;
  color: rgb(var(--v-theme-primary));
}

.sp-svc-row__label {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sp-svc-row__action {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-primary));
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  flex-shrink: 0;
}

.sp-svc-row__action:hover {
  background: var(--sp-chip-hover-bg);
}

.sp-svc-row__detail {
  margin: 2px 0 0 20px;
  font-size: 11px;
  color: var(--sp-text-path);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
