<!--
  VivadoCriticalWarningsView
  ─────────────────────────────────────────────────────────────────────
  get_critical_warnings 专用展示（F 组最复杂）。
  复用 CodeCheckResult issue-row 风格，按 [XXX-NNN] 警告 ID 分组，
  附 ERROR / CW / WARN 数字徽章 + 差分报告（可选）+ 折叠原始 log。

  Author: elecvoid243, 2026-07-27
-->
<template>
  <!-- 错误态 -->
  <div v-if="data.isError" class="result-status error">
    <v-icon size="16">mdi-alert-circle</v-icon>
    <span>{{ props.result.split('\n')[0].replace('[ERROR]', '').trim() || 'Unknown error' }}</span>
  </div>

  <div v-else class="vivado-card">
    <div class="vivado-card-header">
      <v-icon size="14" class="vivado-card-header-icon">mdi-alert-octagon-outline</v-icon>
      <span class="vivado-card-header-title">Vivado CRITICAL WARNING 诊断</span>
      <span class="num-cell" :class="errorsClass">{{ data.diagnostic.errors }}</span>
      <span class="num-cell" :class="cwClass">{{ data.diagnostic.criticalWarnings }}</span>
      <span class="num-cell neutral">{{ data.diagnostic.warnings }}</span>
    </div>

    <!-- 错误态横幅 -->
    <div v-if="data.diagnostic.errors > 0" class="banner banner-error">
      <v-icon size="14">mdi-alert-circle</v-icon>
      !! 发现 {{ data.diagnostic.errors }} 条 ERROR !! 请检查 runme.log 详情。
    </div>
    <div v-else-if="data.diagnostic.criticalWarnings > 0" class="banner banner-warn">
      <v-icon size="14">mdi-alert</v-icon>
      !! 发现 {{ data.diagnostic.criticalWarnings }} 条 CRITICAL WARNING !! 建议立即查看分类详情。
    </div>
    <div v-else-if="data.nonstandardSection" class="banner banner-warn">
      <v-icon size="14">mdi-bug-outline</v-icon>
      Vivado messageDb 显示无 ERROR/CW，但日志末尾发现非标错误
    </div>
    <div v-else class="banner banner-ok">
      <v-icon size="14">mdi-check-circle</v-icon>
      未发现 ERROR 或 CRITICAL WARNING
    </div>

    <!-- CW 分组 -->
    <div v-if="data.cwGroups.length" class="groups-block">
      <div v-for="(g, i) in data.cwGroups" :key="`cw-${i}`" class="cw-group">
        <div class="cw-group-header" @click="toggleGroup(`cw-${i}`)">
          <v-icon size="13" class="cw-group-chevron" :class="{ open: openSet[`cw-${i}`] }">mdi-chevron-right</v-icon>
          <span class="cw-id">{{ g.warningId }}</span>
          <span class="cw-category">{{ g.category }}</span>
          <span class="num-cell warn">×{{ g.count }}</span>
        </div>
        <div v-if="openSet[`cw-${i}`]" class="cw-group-body">
          <div v-if="g.sample" class="cw-sample">
            <span class="cw-sample-label">样本：</span>
            <CopyableText :value="g.sample" mode="code" />
          </div>
          <div v-if="g.fixTip" class="cw-fix">
            <v-icon size="12" color="#b58400">mdi-lightbulb-on-outline</v-icon>
            <span class="cw-fix-label">修复：</span>
            <CopyableText :value="g.fixTip" mode="code" />
          </div>
        </div>
      </div>
    </div>

    <!-- ERROR 分组（折叠默认） -->
    <button
      v-if="data.errorGroups.length"
      type="button"
      class="vivado-more"
      :aria-expanded="showErrors"
      @click="showErrors = !showErrors"
    >
      <v-icon size="12" class="vivado-more-chevron" :class="{ open: showErrors }">mdi-chevron-down</v-icon>
      <span v-if="!showErrors">ERROR 分组（{{ data.errorGroups.length }} 个，{{ data.diagnostic.errors }} 处）</span>
      <span v-else>Hide ERROR groups</span>
    </button>
    <div v-if="showErrors && data.errorGroups.length" class="groups-block">
      <div v-for="(g, i) in data.errorGroups" :key="`err-${i}`" class="cw-group error-group">
        <div class="cw-group-header" @click="toggleGroup(`err-${i}`)">
          <v-icon size="13" class="cw-group-chevron" :class="{ open: openSet[`err-${i}`] }">mdi-chevron-right</v-icon>
          <span class="cw-id">{{ g.warningId }}</span>
          <span class="cw-category">{{ g.category }}</span>
          <span class="num-cell error">×{{ g.count }}</span>
        </div>
        <div v-if="openSet[`err-${i}`]" class="cw-group-body">
          <div v-if="g.sample" class="cw-sample">
            <span class="cw-sample-label">样本：</span>
            <CopyableText :value="g.sample" mode="code" />
          </div>
        </div>
      </div>
    </div>

    <!-- 非标错误兜底段 -->
    <div v-if="data.nonstandardSection" class="nonstandard-block">
      <pre class="nonstandard-pre">{{ data.nonstandardSection }}</pre>
    </div>

    <!-- CW 差分（compare_with_last=True 触发） -->
    <div v-if="data.diff" class="diff-block">
      <div class="vivado-section-title">
        <v-icon size="12">mdi-vector-difference</v-icon>
        CW 差分报告
      </div>
      <div v-if="data.diff.resolved.length" class="diff-row diff-resolved">
        <span class="diff-icon">✅</span>
        <span class="diff-label">已消除（{{ data.diff.resolved.length }}）</span>
        <ul class="diff-list">
          <li v-for="(d, i) in data.diff.resolved.slice(0, 5)" :key="i">
            <CopyableText :value="d" mode="code" />
          </li>
          <li v-if="data.diff.resolved.length > 5" class="diff-more">+{{ data.diff.resolved.length - 5 }} more</li>
        </ul>
      </div>
      <div v-if="data.diff.added.length" class="diff-row diff-added">
        <span class="diff-icon">❌</span>
        <span class="diff-label">新增（{{ data.diff.added.length }}）</span>
        <ul class="diff-list">
          <li v-for="(d, i) in data.diff.added.slice(0, 5)" :key="i">
            <CopyableText :value="d" mode="code" />
          </li>
        </ul>
      </div>
      <div v-if="data.diff.stillPresent.length" class="diff-row diff-still">
        <span class="diff-icon">⚠</span>
        <span class="diff-label">仍存在（{{ data.diff.stillPresent.length }}）</span>
        <ul class="diff-list">
          <li v-for="(d, i) in data.diff.stillPresent.slice(0, 5)" :key="i">
            <CopyableText :value="d" mode="code" />
          </li>
        </ul>
      </div>
    </div>

    <!-- 原始 log 折叠 -->
    <button
      type="button"
      class="vivado-more"
      :aria-expanded="showRaw"
      @click="showRaw = !showRaw"
    >
      <v-icon size="12" class="vivado-more-chevron" :class="{ open: showRaw }">mdi-chevron-down</v-icon>
      <span v-if="!showRaw">Show raw log</span>
      <span v-else>Hide raw log</span>
    </button>
    <pre v-if="showRaw" class="vivado-pre">{{ props.result }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import CopyableText from "../../__shared__/CopyableText.vue";
import { parseCriticalWarningsFromText, type ParsedCriticalWarnings } from "./vivadoParsers";

const props = defineProps<{ result: string }>();

const data = computed<ParsedCriticalWarnings>(() =>
  parseCriticalWarningsFromText(props.result) ?? {
    diagnostic: { errors: 0, criticalWarnings: 0, warnings: 0 },
    cwGroups: [], errorGroups: [], nonstandardSection: "", diff: null,
    isError: true, raw: props.result,
  },
);

const openSet = reactive<Record<string, boolean>>({});
const showErrors = ref(false);
const showRaw = ref(false);

function toggleGroup(key: string) {
  openSet[key] = !openSet[key];
}

const errorsClass = computed(() => data.value.diagnostic.errors > 0 ? "error" : "neutral");
const cwClass = computed(() => {
  const n = data.value.diagnostic.criticalWarnings;
  if (n === 0) return "neutral";
  if (n >= 5) return "error";
  return "warn";
});
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

.banner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    font-size: 11.5px;
    font-weight: 600;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.banner-error { background: rgba(207, 34, 46, 0.08); color: #cf222e; }
.banner-warn  { background: rgba(255, 180, 0, 0.08); color: #b58400; }
.banner-ok    { background: rgba(70, 200, 70, 0.06); color: #2da44e; }

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
.num-cell.neutral { background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.65); }

.groups-block { padding: 0; }
.cw-group {
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.cw-group.error-group { background: rgba(207, 34, 46, 0.02); }
.cw-group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    cursor: pointer;
    transition: background 0.15s;
}
.cw-group-header:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.cw-group-chevron {
    color: rgba(var(--v-theme-on-surface), 0.4);
    transition: transform 0.2s;
    flex-shrink: 0;
}
.cw-group-chevron.open { transform: rotate(90deg); }
.cw-id {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    font-weight: 600;
    color: #b58400;
    flex-shrink: 0;
}
.cw-group.error-group .cw-id { color: #cf222e; }
.cw-category {
    font-size: 11.5px;
    color: rgba(var(--v-theme-on-surface), 0.8);
    flex: 1;
    min-width: 0;
}
.cw-group-body {
    padding: 4px 10px 8px 30px;
    background: rgba(var(--v-theme-on-surface), 0.02);
}
.cw-sample, .cw-fix {
    display: flex;
    align-items: baseline;
    gap: 4px;
    padding: 2px 0;
    font-size: 11px;
}
.cw-sample-label, .cw-fix-label {
    color: rgba(var(--v-theme-on-surface), 0.5);
    flex-shrink: 0;
}
.cw-fix {
    color: rgba(var(--v-theme-on-surface), 0.75);
}

.nonstandard-block { padding: 0; }
.nonstandard-pre {
    margin: 0;
    padding: 8px 10px;
    background: rgba(255, 180, 0, 0.04);
    border-top: 1px solid rgba(255, 180, 0, 0.15);
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: rgba(var(--v-theme-on-surface), 0.8);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
}

.diff-block {
    padding: 6px 10px;
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
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
.diff-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 3px 0;
    font-size: 11px;
}
.diff-icon { flex-shrink: 0; }
.diff-label {
    flex-shrink: 0;
    font-weight: 600;
    min-width: 90px;
}
.diff-resolved .diff-label { color: #2da44e; }
.diff-added .diff-label    { color: #cf222e; }
.diff-still .diff-label    { color: #b58400; }
.diff-list {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    min-width: 0;
}
.diff-list li {
    padding: 1px 0 1px 8px;
    position: relative;
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
}
.diff-list li::before {
    content: "•";
    position: absolute;
    left: 0;
    color: rgba(var(--v-theme-on-surface), 0.4);
}
.diff-more {
    color: rgba(var(--v-theme-on-surface), 0.45);
    font-style: italic;
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
