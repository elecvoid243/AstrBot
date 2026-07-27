<!--
  VivadoReportView
  ─────────────────────────────────────────────────────────────────────
  vivado-mcp E 组 10 个工具的通用结构化报告卡片：
    get_io_report, get_timing_report, get_utilization_report,
    get_project_info, get_run_progress, get_ip_status,
    get_next_suggestion, get_pre_commit_summary,
    check_bitstream_readiness, inspect_ip_params

  设计：
    - 顶部 verdict 状态行（沿用 .status-row 配色）
    - 中间是自定义 slot（每个工具的特化展示）
    - 底部 "Show raw / Hide raw" 折叠完整原始输出
    - 全部类名 scoped，不污染 spcode_tools 命名空间

  Author: elecvoid243, 2026-07-27
-->
<template>
  <div class="vivado-report-view">
    <!-- 顶部 verdict 状态行 -->
    <div v-if="verdictLabel" class="status-row" :class="verdictMeta.bgClass">
      <v-icon size="14">{{ verdictMeta.icon }}</v-icon>
      <span class="status-text">{{ verdictLabel }}</span>
      <span v-if="verdictSourceStage" class="num-cell neutral">{{ verdictSourceStage }}</span>
    </div>

    <!-- 主展示区（每个工具的特化实现） -->
    <slot />

    <!-- 底部原始输出（折叠） -->
    <button
      v-if="rawText && rawText.length > 0"
      type="button"
      class="vivado-more"
      :aria-expanded="showRaw"
      @click="showRaw = !showRaw"
    >
      <v-icon size="12" class="vivado-more-chevron" :class="{ open: showRaw }">
        mdi-chevron-down
      </v-icon>
      <span v-if="!showRaw">{{ rawToggleText || 'Show raw output' }}</span>
      <span v-else>Hide raw output</span>
    </button>
    <pre v-if="showRaw && rawText" class="vivado-pre">{{ rawText }}</pre>
  </div>
</template>

<script setup lang="ts">
/**
 * 通用 props：verdict 归一化 + 折叠 raw。
 * 子组件只负责"verdict 之下"的具体可视化。
 */
import { computed, ref } from "vue";
import { VERDICT_META, normalizeVerdict, type VivadoVerdict } from "./vivadoLabels";

const props = withDefaults(
  defineProps<{
    /** 原始 verdict 字符串 ("READY" / "WARN" / "BLOCK" / "PASS" / "FAIL" 等) */
    verdict?: string;
    /** 人类可读的 verdict 消息（覆盖默认 i18n） */
    verdictMessage?: string;
    /** 数据源阶段 ("post-synth" / "post-route")，显示在 verdict 右侧 chip */
    sourceStage?: string;
    /** 完整原始文本，底部可折叠 */
    rawText?: string;
    /** 折叠按钮文字（可选，默认 "Show raw output"） */
    rawToggleText?: string;
  }>(),
  { verdict: "unknown", verdictMessage: "", sourceStage: "", rawText: "", rawToggleText: "" },
);

const showRaw = ref(false);

const verdictKind = computed<VivadoVerdict>(() => normalizeVerdict(props.verdict));
const verdictMeta = computed(() => VERDICT_META[verdictKind.value]);
const verdictLabel = computed(() => props.verdictMessage || props.verdict || "");
const verdictSourceStage = computed(() => props.sourceStage);
</script>

<style scoped>
.vivado-report-view {
    font-size: 12px;
    line-height: 1.5;
}
.status-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11.5px;
    margin-bottom: 6px;
}
.status-row.success { background: rgba(70, 200, 70, 0.08); color: #2da44e; }
.status-row.error   { background: rgba(255, 100, 100, 0.08); color: #cf222e; }
.status-row.warn    { background: rgba(255, 180, 0, 0.10); color: #b58400; }
.status-row.neutral { background: rgba(var(--v-theme-on-surface), 0.04); color: rgba(var(--v-theme-on-surface), 0.65); }
.status-row.running { background: rgba(var(--v-theme-primary), 0.08); color: rgb(var(--v-theme-primary)); }
.status-row.degraded {
    background: rgba(207, 34, 46, 0.05);
    color: #cf222e;
    border: 1px dashed rgba(207, 34, 46, 0.4);
}
.status-text { font-weight: 600; }
.num-cell {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    border-radius: 9px;
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    font-weight: 600;
}
.num-cell.neutral { background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.65); }
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
