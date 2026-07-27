<!--
  VivadoUtilizationView
  ─────────────────────────────────────────────────────────────────────
  get_utilization_report 专用展示。
  资源表格（LUT / FF / BRAM / DSP / IOB），高亮 >90% / 70-90%。

  Author: elecvoid243, 2026-07-27
-->
<template>
  <VivadoReportView verdict="ok" :raw-text="data.raw" raw-toggle-text="Show full report">
    <table v-if="data.resources.length" class="vivado-table">
      <thead>
        <tr>
          <th>Resource</th>
          <th class="num">Used</th>
          <th class="num">Available</th>
          <th class="num">Util%</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(r, i) in data.resources"
          :key="i"
          :class="{ 'row-critical': r.critical, 'row-warn': r.warn }"
        >
          <td>
            <v-icon v-if="r.critical" size="12" color="#cf222e" class="row-icon">mdi-alert-circle</v-icon>
            <v-icon v-else-if="r.warn" size="12" color="#b58400" class="row-icon">mdi-alert</v-icon>
            {{ r.name }}
          </td>
          <td class="num">{{ r.used.toLocaleString() }}</td>
          <td class="num">{{ r.available.toLocaleString() }}</td>
          <td class="num pct">{{ r.percent.toFixed(1) }}%</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty-note">未解析到资源占用（无表数据或格式不识别）</div>
  </VivadoReportView>
</template>

<script setup lang="ts">
import { computed } from "vue";
import VivadoReportView from "./VivadoReportView.vue";
import { parseUtilizationFromText, type ParsedUtilization } from "./vivadoParsers";

const props = defineProps<{ result: string }>();
const data = computed<ParsedUtilization>(() =>
  parseUtilizationFromText(props.result) ?? { resources: [], parseError: "", raw: props.result },
);
</script>

<style scoped>
.vivado-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    margin: 4px 0;
}
.vivado-table th,
.vivado-table td {
    padding: 3px 8px;
    text-align: left;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.vivado-table th {
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.55);
    background: rgba(var(--v-theme-on-surface), 0.04);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
}
.vivado-table td.num {
    text-align: right;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.vivado-table .row-critical td.pct { color: #cf222e; font-weight: 600; }
.vivado-table .row-warn td.pct { color: #b58400; }
.row-icon { margin-right: 4px; vertical-align: middle; }
.empty-note {
    padding: 8px;
    font-size: 11px;
    font-style: italic;
    color: rgba(var(--v-theme-on-surface), 0.45);
    text-align: center;
}
</style>
