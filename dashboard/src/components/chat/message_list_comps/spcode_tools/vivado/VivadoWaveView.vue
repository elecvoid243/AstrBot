<!--
  VivadoWaveView
  ─────────────────────────────────────────────────────────────────────
  F 组 2 个波形工具：set_wave_zoom / set_wave_analog。
  各自一行核心信息 + 信号结果列表（analog）+ 折叠 raw。

  Author: elecvoid243, 2026-07-27
-->
<template>
  <!-- ── set_wave_zoom ── -->
  <div v-if="toolName === 'mcp_vivado__set_wave_zoom'">
    <div v-if="zoom.isError" class="result-status error">
      <v-icon size="16">mdi-alert-circle</v-icon>
      <span>{{ props.result.split('\n')[0].replace('[ERROR]', '').trim() || 'Unknown error' }}</span>
    </div>
    <div v-else class="vivado-card">
      <div class="vivado-card-header">
        <v-icon size="14" class="vivado-card-header-icon">mdi-magnify-scan</v-icon>
        <span class="vivado-card-header-title">Vivado 波形缩放</span>
        <span class="num-cell success">[OK]</span>
      </div>
      <div v-if="zoom.startNs > 0 || zoom.endNs > 0" class="vivado-row">
        <span class="vivado-row-label">范围</span>
        <span class="vivado-row-value">
          {{ zoom.startNs }} ~ {{ zoom.endNs }} <span class="unit">ns</span>
        </span>
      </div>
      <div v-if="zoom.wcfgPath" class="vivado-row">
        <span class="vivado-row-label">wcfg</span>
        <CopyableText :value="zoom.wcfgPath" mode="code" class="vivado-row-value" />
      </div>
    </div>
  </div>

  <!-- ── set_wave_analog ── -->
  <div v-else>
    <div v-if="analog.isError" class="result-status error">
      <v-icon size="16">mdi-alert-circle</v-icon>
      <span>{{ props.result.split('\n')[0].replace('[ERROR]', '').trim() || 'Unknown error' }}</span>
    </div>
    <div v-else class="vivado-card">
      <div class="vivado-card-header">
        <v-icon size="14" class="vivado-card-header-icon">mdi-chart-bell-curve</v-icon>
        <span class="vivado-card-header-title">Vivado 波形模拟显示</span>
        <span class="num-cell" :class="analog.signals.every(s => s.ok) ? 'success' : (analog.signals.some(s => s.ok) ? 'warn' : 'error')">
          {{ okCount }}/{{ analog.signals.length }} OK
        </span>
      </div>
      <div class="vivado-row">
        <span class="vivado-row-label">幅度</span>
        <span class="vivado-row-value">
          min <span class="num-cell neutral">{{ analog.min }}</span>
          · max <span class="num-cell neutral">{{ analog.max }}</span>
          · 插值 <span class="num-cell neutral">{{ analog.interp }}</span>
          <span v-if="analog.height > 0">· 高度 <span class="num-cell neutral">{{ analog.height }}px</span></span>
        </span>
      </div>

      <div v-if="analog.signals.length" class="signals-block">
        <div class="vivado-section-title">
          <v-icon size="12">mdi-format-list-bulleted</v-icon>
          信号
        </div>
        <div v-for="(s, i) in analog.signals" :key="i" class="signal-row" :class="{ 'signal-ok': s.ok, 'signal-fail': !s.ok }">
          <v-icon size="12" :color="s.ok ? '#2da44e' : '#cf222e'">
            {{ s.ok ? 'mdi-check' : 'mdi-close' }}
          </v-icon>
          <CopyableText :value="s.name" mode="code" />
          <span v-if="s.matched && s.matched !== s.name" class="signal-matched">(命中 {{ s.matched }})</span>
          <span v-if="s.reason && !s.ok" class="signal-reason">{{ s.reason }}</span>
        </div>
      </div>

      <button
        type="button"
        class="vivado-more"
        :aria-expanded="showRaw"
        @click="showRaw = !showRaw"
      >
        <v-icon size="12" class="vivado-more-chevron" :class="{ open: showRaw }">mdi-chevron-down</v-icon>
        <span v-if="!showRaw">Show raw output</span>
        <span v-else>Hide raw output</span>
      </button>
      <pre v-if="showRaw" class="vivado-pre">{{ props.result }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import CopyableText from "../../__shared__/CopyableText.vue";
import {
  parseWaveZoomFromText,
  parseWaveAnalogFromText,
  type ParsedWaveZoom,
  type ParsedWaveAnalog,
} from "./vivadoParsers";

const props = defineProps<{ toolName: string; result: string }>();

const zoom = computed<ParsedWaveZoom>(() =>
  parseWaveZoomFromText(props.result) ?? {
    startNs: 0, endNs: 0, wcfgPath: "", isError: true, raw: props.result,
  },
);
const analog = computed<ParsedWaveAnalog>(() =>
  parseWaveAnalogFromText(props.result) ?? {
    min: 0, max: 0, interp: "LINEAR", height: 0,
    signals: [], isError: true, raw: props.result,
  },
);

const okCount = computed(() => analog.value.signals.filter((s) => s.ok).length);
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

.vivado-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
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
    word-break: break-all;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
}
.unit { color: rgba(var(--v-theme-on-surface), 0.5); margin-left: 2px; }
.num-cell {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 9px;
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    font-weight: 600;
}
.num-cell.error   { background: rgba(207, 34, 46, 0.10); color: #cf222e; }
.num-cell.warn    { background: rgba(255, 180, 0, 0.10); color: #b58400; }
.num-cell.success { background: rgba(70, 200, 70, 0.10); color: #2da44e; }
.num-cell.neutral { background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.65); }

.signals-block { padding: 6px 10px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05); }
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
.signal-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 0;
    font-size: 11px;
    font-family: ui-monospace, monospace;
}
.signal-matched { color: rgba(var(--v-theme-on-surface), 0.5); font-size: 10.5px; }
.signal-reason { color: #cf222e; font-size: 10.5px; margin-left: 4px; }

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
