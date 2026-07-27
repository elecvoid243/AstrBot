<!--
  VivadoTimingView
  ─────────────────────────────────────────────────────────────────────
  get_timing_report 专用展示。
  WNS / WHS / 失败端点 / 数据源阶段。

  Author: elecvoid243, 2026-07-27
-->
<template>
  <VivadoReportView
    :verdict="data.status"
    :source-stage="data.sourceStage"
    :raw-text="data.raw"
  >
    <!-- 时序数字 grid -->
    <div class="timing-grid">
      <div class="timing-cell">
        <span class="timing-cell-label">WNS</span>
        <span class="timing-cell-value" :class="wnsClass">
          {{ formatNs(data.wns) }}<span class="unit">ns</span>
        </span>
      </div>
      <div class="timing-cell">
        <span class="timing-cell-label">WHS</span>
        <span class="timing-cell-value" :class="whsClass">
          {{ formatNs(data.whs) }}<span class="unit">ns</span>
        </span>
      </div>
      <div class="timing-cell">
        <span class="timing-cell-label">失败端点</span>
        <span class="timing-cell-value" :class="endpointClass">
          {{ data.failingEndpoints }}<span class="divider">/</span>{{ data.totalEndpoints }}
        </span>
      </div>
    </div>

    <!-- 状态行 -->
    <div class="vivado-row" v-if="data.status !== 'unknown'">
      <span class="vivado-row-label">状态</span>
      <span class="vivado-row-value" :class="statusClass">
        <v-icon size="13" class="status-icon">{{ statusIcon }}</v-icon>
        {{ statusLabel }}
      </span>
    </div>
  </VivadoReportView>
</template>

<script setup lang="ts">
import { computed } from "vue";
import VivadoReportView from "./VivadoReportView.vue";
import { parseTimingReportFromText, type ParsedTimingReport } from "./vivadoParsers";

const props = defineProps<{ result: string }>();

const data = computed<ParsedTimingReport>(() =>
  parseTimingReportFromText(props.result) ?? {
    status: "unknown", wns: 0, whs: 0, failingEndpoints: 0, totalEndpoints: 0, sourceStage: "unknown", raw: props.result,
  },
);

const wnsClass = computed(() => data.value.wns >= 0 ? "good" : "bad");
const whsClass = computed(() => data.value.whs >= 0 ? "good" : "bad");
const endpointClass = computed(() =>
  data.value.failingEndpoints === 0 ? "good" : "bad"
);

const statusIcon = computed(() => {
  if (data.value.status === "met") return "mdi-check-circle";
  if (data.value.status === "fail") return "mdi-alert-circle";
  if (data.value.status === "na") return "mdi-help-circle-outline";
  return "mdi-help-circle-outline";
});

const statusLabel = computed(() => {
  if (data.value.status === "met") return "Timing MET · 时序满足";
  if (data.value.status === "fail") return "Timing NOT MET · 时序违例";
  if (data.value.status === "na") return "N/A · 无时序约束";
  return "Unknown";
});

const statusClass = computed(() => {
  if (data.value.status === "met") return "good";
  if (data.value.status === "fail") return "bad";
  return "neutral";
});

function formatNs(v: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(3);
}
</script>

<style scoped>
.timing-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    margin: 4px 0 6px;
}
.timing-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border-radius: 4px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    align-items: center;
}
.timing-cell-label {
    font-size: 10.5px;
    color: rgba(var(--v-theme-on-surface), 0.5);
    text-transform: uppercase;
    letter-spacing: 0.3px;
}
.timing-cell-value {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 16px;
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.85);
}
.timing-cell-value.good    { color: #2da44e; }
.timing-cell-value.bad     { color: #cf222e; }
.timing-cell-value.neutral { color: rgba(var(--v-theme-on-surface), 0.55); }
.unit {
    font-size: 11px;
    font-weight: 400;
    color: rgba(var(--v-theme-on-surface), 0.5);
    margin-left: 2px;
}
.divider {
    color: rgba(var(--v-theme-on-surface), 0.3);
    margin: 0 1px;
}
.vivado-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    font-size: 11px;
    line-height: 1.55;
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.vivado-row-label {
    flex-shrink: 0;
    width: 64px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.5);
}
.vivado-row-value {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: rgba(var(--v-theme-on-surface), 0.8);
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
.vivado-row-value.good    { color: #2da44e; }
.vivado-row-value.bad     { color: #cf222e; }
.vivado-row-value.neutral { color: rgba(var(--v-theme-on-surface), 0.55); }
.status-icon { flex-shrink: 0; }
</style>
