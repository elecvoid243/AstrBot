<!--
  VivadoRunProgressView
  ─────────────────────────────────────────────────────────────────────
  get_run_progress 专用展示。
  进度条 + 状态/耗时 + Phase 列表 + 日志尾部（折叠）。

  Author: elecvoid243, 2026-07-27
-->
<template>
  <VivadoReportView :verdict="data.progress >= 100 ? 'complete' : 'running'" :raw-text="data.raw">
    <!-- 进度条 -->
    <div class="vivado-progress">
      <div class="vivado-progress-line">
        <v-progress-linear
          :model-value="data.progress"
          :color="data.progress >= 100 ? 'success' : 'primary'"
          height="6"
          rounded
          class="vivado-progress-bar"
        />
        <span class="vivado-progress-status">{{ data.progress }}%</span>
      </div>
      <div class="vivado-progress-meta">
        <span>{{ data.status || 'UNKNOWN' }}</span>
        <span v-if="data.elapsed" class="vivado-progress-divider">·</span>
        <span v-if="data.elapsed">{{ data.elapsed }}</span>
        <span v-if="data.runName" class="vivado-progress-divider">·</span>
        <CopyableText v-if="data.runName" :value="data.runName" mode="code" class="run-name" />
      </div>
    </div>

    <!-- Phase 列表 -->
    <div v-if="data.phases.length" class="phase-list">
      <div class="vivado-section-title">
        <v-icon size="12">mdi-flag-checkered</v-icon>
        Phase ({{ data.phases.length }})
      </div>
      <ul class="phase-ul">
        <li v-for="(p, i) in data.phases" :key="i" class="phase-item">
          <v-icon size="11" class="phase-icon">mdi-chevron-right</v-icon>
          <span>{{ p }}</span>
        </li>
      </ul>
    </div>

    <!-- 日志尾部折叠 -->
    <button
      v-if="data.logTail.length"
      type="button"
      class="vivado-more"
      :aria-expanded="showLog"
      @click="showLog = !showLog"
    >
      <v-icon size="12" class="vivado-more-chevron" :class="{ open: showLog }">mdi-chevron-down</v-icon>
      <span v-if="!showLog">Show log tail ({{ data.logTail.length }} lines)</span>
      <span v-else>Hide log tail</span>
    </button>
    <pre v-if="showLog && data.logTail.length" class="vivado-pre">{{ data.logTail.join('\n') }}</pre>
  </VivadoReportView>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import VivadoReportView from "./VivadoReportView.vue";
import { parseRunProgressFromText, type ParsedRunProgress } from "./vivadoParsers";
import CopyableText from "../../__shared__/CopyableText.vue";

const props = defineProps<{ result: string }>();
const data = computed<ParsedRunProgress>(() =>
  parseRunProgressFromText(props.result) ?? {
    runName: "", status: "", progress: 0, elapsed: "", phases: [], logTail: [], raw: props.result,
  },
);
const showLog = ref(false);
</script>

<style scoped>
.vivado-progress {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 10px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    border-radius: 4px;
    margin-bottom: 6px;
}
.vivado-progress-line { display: flex; align-items: center; gap: 8px; font-size: 11.5px; }
.vivado-progress-bar { flex: 1; min-width: 0; }
.vivado-progress-status {
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    color: rgba(var(--v-theme-on-surface), 0.65);
    flex-shrink: 0;
    min-width: 40px;
    text-align: right;
}
.vivado-progress-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    color: rgba(var(--v-theme-on-surface), 0.55);
    flex-wrap: wrap;
}
.vivado-progress-divider { color: rgba(var(--v-theme-on-surface), 0.3); user-select: none; }
.run-name { font-size: 10.5px; }

.phase-list { margin-top: 4px; }
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
.phase-ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 160px;
    overflow-y: auto;
    background: rgba(var(--v-theme-on-surface), 0.03);
    border-radius: 4px;
}
.phase-item {
    display: flex;
    align-items: baseline;
    gap: 4px;
    padding: 2px 8px;
    font-size: 11px;
    font-family: ui-monospace, monospace;
    color: rgba(var(--v-theme-on-surface), 0.75);
}
.phase-item + .phase-item {
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.04);
}
.phase-icon { color: rgba(var(--v-theme-on-surface), 0.35); flex-shrink: 0; }

.vivado-more {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 6px;
    padding: 4px 8px;
    width: 100%;
    background: transparent;
    border: 1px dashed rgba(var(--v-theme-on-surface), 0.12);
    border-radius: 4px;
    font-size: 11px;
    font-style: italic;
    color: rgba(var(--v-theme-on-surface), 0.55);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.vivado-more:hover {
    background: rgba(var(--v-theme-on-surface), 0.04);
    border-color: rgba(var(--v-theme-on-surface), 0.22);
    color: rgba(var(--v-theme-on-surface), 0.8);
}
.vivado-more-chevron { transition: transform 0.2s; color: rgba(var(--v-theme-on-surface), 0.4); }
.vivado-more-chevron.open { transform: rotate(180deg); }

.vivado-pre {
    margin: 4px 0 0;
    padding: 8px 10px;
    border-radius: 4px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11.5px;
    line-height: 1.55;
    color: rgba(var(--v-theme-on-surface), 0.8);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 300px;
    overflow-y: auto;
}
</style>
