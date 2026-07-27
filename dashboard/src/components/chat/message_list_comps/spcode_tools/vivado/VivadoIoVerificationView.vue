<!--
  VivadoIoVerificationView
  ─────────────────────────────────────────────────────────────────────
  verify_io_placement_tool 专用展示。
  GT / GPIO 不匹配分组 + 一致数量徽章。

  Author: elecvoid243, 2026-07-27
-->
<template>
  <div v-if="isError" class="result-status error">
    <v-icon size="16">mdi-alert-circle</v-icon>
    <span>{{ props.result.split('\n')[0].replace('[ERROR]', '').trim() || 'Unknown error' }}</span>
  </div>

  <div v-else class="vivado-card">
    <div class="vivado-card-header">
      <v-icon size="14" class="vivado-card-header-icon">mdi-vector-link</v-icon>
      <span class="vivado-card-header-title">IO 引脚分配验证</span>
      <span v-if="criticalCount > 0" class="num-cell error">{{ criticalCount }} CRITICAL</span>
      <span v-else-if="warningCount > 0" class="num-cell warn">{{ warningCount }} WARN</span>
      <span v-else class="num-cell success">✅ 一致</span>
    </div>

    <!-- CRITICAL (GT) -->
    <div v-if="criticalMismatches.length" class="vivado-section section-error">
      <div class="vivado-section-title">
        <v-icon size="12">mdi-alert-circle</v-icon>
        CRITICAL 不匹配（GT 端口，{{ criticalMismatches.length }} 个）
      </div>
      <table class="mismatch-table">
        <thead>
          <tr><th>Port</th><th>XDC 约束</th><th>实际分配</th></tr>
        </thead>
        <tbody>
          <tr v-for="(m, i) in criticalMismatches" :key="i">
            <td>
              <CopyableText :value="m.port" mode="code" />
            </td>
            <td>
              <CopyableText :value="m.xdc" mode="code" />
            </td>
            <td>
              <span class="mismatch-arrow">→</span>
              <CopyableText :value="m.actual" mode="code" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- WARNING (GPIO) -->
    <div v-if="warningMismatches.length" class="vivado-section section-warn">
      <div class="vivado-section-title">
        <v-icon size="12">mdi-alert</v-icon>
        WARNING 不匹配（GPIO 端口，{{ warningMismatches.length }} 个）
      </div>
      <table class="mismatch-table">
        <thead>
          <tr><th>Port</th><th>XDC 约束</th><th>实际分配</th></tr>
        </thead>
        <tbody>
          <tr v-for="(m, i) in warningMismatches" :key="i">
            <td>
              <CopyableText :value="m.port" mode="code" />
            </td>
            <td>
              <CopyableText :value="m.xdc" mode="code" />
            </td>
            <td>
              <span class="mismatch-arrow">→</span>
              <CopyableText :value="m.actual" mode="code" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 一致数量 -->
    <div v-if="data.matches > 0" class="matches-block">
      <v-icon size="12" color="#2da44e">mdi-check-circle</v-icon>
      <span>✅ 一致（{{ data.matches }} 个）</span>
    </div>

    <!-- 原始 -->
    <button
      type="button"
      class="vivado-more"
      :aria-expanded="showRaw"
      @click="showRaw = !showRaw"
    >
      <v-icon size="12" class="vivado-more-chevron" :class="{ open: showRaw }">mdi-chevron-down</v-icon>
      <span v-if="!showRaw">Show raw report</span>
      <span v-else>Hide raw report</span>
    </button>
    <pre v-if="showRaw" class="vivado-pre">{{ props.result }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import CopyableText from "../../__shared__/CopyableText.vue";
import { parseIoVerificationFromText, type ParsedIoVerification } from "./vivadoParsers";

const props = defineProps<{ result: string }>();
const data = computed<ParsedIoVerification>(() =>
  parseIoVerificationFromText(props.result) ?? { matches: 0, mismatches: [], raw: props.result },
);

const criticalMismatches = computed(() => data.value.mismatches.filter((m) => m.severity === "CRITICAL"));
const warningMismatches = computed(() => data.value.mismatches.filter((m) => m.severity === "WARNING"));
const criticalCount = computed(() => criticalMismatches.value.length);
const warningCount = computed(() => warningMismatches.value.length);
const isError = computed(() => props.result.trim().startsWith("[ERROR]"));
const showRaw = ref(false);
</script>

<style scoped>
.vivado-card {
    border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
    border-radius: 4px;
    overflow: hidden;
    font-size: 12px;
    line-height: 1.55;
}
.vivado-card-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.vivado-card-header-icon { color: rgba(var(--v-theme-on-surface), 0.5); flex-shrink: 0; }
.vivado-card-header-title {
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.75);
    font-size: 11.5px;
    flex: 1;
}

.num-cell {
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    border-radius: 9px;
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    font-weight: 600;
}
.num-cell.error   { background: rgba(207, 34, 46, 0.10); color: #cf222e; }
.num-cell.warn    { background: rgba(255, 180, 0, 0.10); color: #b58400; }
.num-cell.success { background: rgba(70, 200, 70, 0.10); color: #2da44e; }

.vivado-section {
    margin: 0;
    padding: 6px 10px;
    background: rgba(var(--v-theme-on-surface), 0.03);
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
    border-radius: 0;
}
.vivado-section.section-error { background: rgba(207, 34, 46, 0.04); }
.vivado-section.section-warn  { background: rgba(255, 180, 0, 0.04); }
.vivado-section-title {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: rgba(var(--v-theme-on-surface), 0.55);
    margin-bottom: 4px;
}
.vivado-section.section-error .vivado-section-title { color: #cf222e; }
.vivado-section.section-warn  .vivado-section-title { color: #b58400; }

.mismatch-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    font-family: ui-monospace, monospace;
}
.mismatch-table th, .mismatch-table td {
    padding: 3px 6px;
    text-align: left;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.mismatch-table th {
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.55);
    font-size: 10.5px;
    text-transform: uppercase;
}
.mismatch-arrow { color: rgba(var(--v-theme-on-surface), 0.4); margin-right: 4px; }

.matches-block {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
    font-size: 11px;
    color: #2da44e;
}

.vivado-more {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0;
    padding: 4px 10px;
    width: 100%;
    background: transparent;
    border: none;
    border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.12);
    font-size: 11px;
    font-style: italic;
    color: rgba(var(--v-theme-on-surface), 0.55);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
}
.vivado-more:hover { background: rgba(var(--v-theme-on-surface), 0.04); color: rgba(var(--v-theme-on-surface), 0.8); }
.vivado-more-chevron { transition: transform 0.2s; color: rgba(var(--v-theme-on-surface), 0.4); }
.vivado-more-chevron.open { transform: rotate(180deg); }
.vivado-pre {
    margin: 0;
    padding: 8px 10px;
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
    background: rgba(var(--v-theme-on-surface), 0.04);
    font-family: ui-monospace, monospace;
    font-size: 11.5px;
    color: rgba(var(--v-theme-on-surface), 0.8);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 300px;
    overflow-y: auto;
}

.result-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 12px;
    background: rgba(255, 100, 100, 0.08);
    color: #cf222e;
}
</style>
