<!--
  VivadoProgramDeviceView
  ─────────────────────────────────────────────────────────────────────
  program_device 专用展示。
  比特流路径 + 步骤表 + 烧板结果。
  ⚠ program_device 不可逆，加显眼的红色警告横幅。

  Author: elecvoid243, 2026-07-27
-->
<template>
  <div v-if="data.isError" class="result-status error">
    <v-icon size="16">mdi-alert-circle</v-icon>
    <span>{{ props.result.split('\n')[0].replace('[ERROR]', '').trim() || 'Unknown error' }}</span>
  </div>

  <div v-else class="vivado-card program-card">
    <div class="vivado-card-header danger-header">
      <v-icon size="14" class="vivado-card-header-icon">mdi-upload-outline</v-icon>
      <span class="vivado-card-header-title">Vivado 烧板</span>
      <span class="num-cell" :class="data.device ? 'success' : 'neutral'">
        <v-icon size="11" class="cell-icon">mdi-chip</v-icon>
        {{ data.device || 'OK' }}
      </span>
    </div>

    <!-- 不可逆警告 -->
    <div class="danger-banner">
      <v-icon size="14">mdi-alert-octagon</v-icon>
      <span>烧板操作不可逆，请确认比特流文件正确</span>
    </div>

    <div v-if="data.bitstreamPath" class="vivado-row">
      <span class="vivado-row-label">比特流</span>
      <CopyableText :value="data.bitstreamPath" mode="code" class="vivado-row-value" />
    </div>
    <div v-if="data.hwServerUrl" class="vivado-row">
      <span class="vivado-row-label">HW Server</span>
      <CopyableText :value="data.hwServerUrl" mode="code" class="vivado-row-value" />
    </div>
    <div v-if="data.target" class="vivado-row">
      <span class="vivado-row-label">目标</span>
      <CopyableText :value="data.target" mode="code" class="vivado-row-value" />
    </div>

    <!-- 步骤表 -->
    <div v-if="data.steps.length" class="steps-block">
      <div class="vivado-section-title">
        <v-icon size="12">mdi-format-list-numbered</v-icon>
        烧板过程
      </div>
      <div v-for="(s, i) in data.steps" :key="i" class="step-row">
        <v-icon size="12" :color="s.ok ? '#2da44e' : '#cf222e'">
          {{ s.ok ? 'mdi-check-circle' : 'mdi-alert-circle' }}
        </v-icon>
        <span class="step-name">{{ s.name }}</span>
        <span v-if="s.detail" class="step-detail">{{ s.detail }}</span>
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
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import CopyableText from "../../__shared__/CopyableText.vue";
import { parseProgramDeviceFromText, type ParsedProgramDevice } from "./vivadoParsers";

const props = defineProps<{ result: string }>();
const data = computed<ParsedProgramDevice>(() =>
  parseProgramDeviceFromText(props.result) ?? {
    bitstreamPath: "", target: "", hwServerUrl: "", steps: [], device: "", isError: true, raw: props.result,
  },
);
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
.program-card { border-color: rgba(207, 34, 46, 0.3); }
.vivado-card-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.danger-header {
    background: rgba(207, 34, 46, 0.06);
    border-bottom-color: rgba(207, 34, 46, 0.2);
}
.vivado-card-header-icon { color: rgba(var(--v-theme-on-surface), 0.5); flex-shrink: 0; }
.danger-header .vivado-card-header-icon { color: #cf222e; }
.vivado-card-header-title {
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.75);
    font-size: 11.5px;
    flex: 1;
}
.danger-header .vivado-card-header-title { color: #cf222e; }

.num-cell {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 7px;
    border-radius: 9px;
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    font-weight: 600;
}
.num-cell.success { background: rgba(70, 200, 70, 0.10); color: #2da44e; }
.num-cell.neutral { background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.65); }
.cell-icon { vertical-align: middle; }

.danger-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: rgba(207, 34, 46, 0.08);
    color: #cf222e;
    font-size: 11px;
    font-weight: 600;
    border-bottom: 1px solid rgba(207, 34, 46, 0.2);
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
    width: 70px;
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
}

.steps-block { padding: 6px 10px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05); }
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
.step-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 11px;
    font-family: ui-monospace, monospace;
}
.step-name { color: rgba(var(--v-theme-on-surface), 0.8); font-weight: 500; }
.step-detail { color: rgba(var(--v-theme-on-surface), 0.55); }

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
