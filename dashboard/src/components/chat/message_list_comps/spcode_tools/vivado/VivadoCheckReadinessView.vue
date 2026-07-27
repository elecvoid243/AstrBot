<!--
  VivadoCheckReadinessView
  ─────────────────────────────────────────────────────────────────────
  check_bitstream_readiness 专用展示。
  展示 READY / WARN / BLOCK verdict + 实现状态 + CW 数量 + 时序 + 阻塞/风险。

  Author: elecvoid243, 2026-07-27
-->
<template>
  <VivadoReportView
    :verdict="data.verdict"
    :verdict-message="verdictLabel"
    :raw-text="data.raw"
    raw-toggle-text="Show full report"
  >
    <!-- 状态卡片 -->
    <div class="state-grid">
      <div class="state-cell">
        <span class="state-cell-label">实现状态</span>
        <span class="state-cell-value">{{ data.status || 'UNKNOWN' }}</span>
      </div>
      <div class="state-cell">
        <span class="state-cell-label">CRITICAL WARNING</span>
        <span class="state-cell-value" :class="cwClass">{{ data.cwCount >= 0 ? data.cwCount : '—' }}</span>
      </div>
      <div class="state-cell" v-if="data.wns !== null">
        <span class="state-cell-label">时序</span>
        <span class="state-cell-value" :class="timingClass">
          <span v-if="data.failingEndpoints !== null">
            {{ data.failingEndpoints }}/{{ data.totalEndpoints }}
          </span>
          <span v-else>WNS {{ formatWns(data.wns) }} ns</span>
        </span>
      </div>
    </div>

    <!-- 阻塞问题 -->
    <div v-if="data.blockers.length" class="vivado-section section-error">
      <div class="vivado-section-title">
        <v-icon size="12">mdi-block-helper</v-icon>
        阻塞问题
      </div>
      <ul class="issue-list">
        <li v-for="(b, i) in data.blockers" :key="i">{{ b }}</li>
      </ul>
    </div>

    <!-- 风险提示 -->
    <div v-if="data.warnings.length" class="vivado-section section-warn">
      <div class="vivado-section-title">
        <v-icon size="12">mdi-alert</v-icon>
        风险提示
      </div>
      <ul class="issue-list">
        <li v-for="(w, i) in data.warnings" :key="i">{{ w }}</li>
      </ul>
    </div>

    <!-- CW 样本 -->
    <div v-if="data.samples.length" class="vivado-section section-warn">
      <div class="vivado-section-title">
        <v-icon size="12">mdi-alert-octagon-outline</v-icon>
        CRITICAL WARNING 样本（前 {{ data.samples.length }} 条）
      </div>
      <ul class="sample-list">
        <li v-for="(s, i) in data.samples" :key="i">
          <CopyableText :value="s" mode="code" />
        </li>
      </ul>
    </div>

    <!-- 建议 -->
    <div v-if="data.blockers.length" class="vivado-proposal">
      <div class="vivado-proposal-label">
        <v-icon size="12">mdi-lightbulb-on-outline</v-icon>
        建议
      </div>
      <div class="vivado-proposal-text">
        运行 <code class="cmd-chip">get_critical_warnings</code> 查看详情，修复后再烧板。
      </div>
    </div>
  </VivadoReportView>
</template>

<script setup lang="ts">
/**
 * 接收 result 字符串（vivado 工具原始返回），
 * 用 parseBitstreamReadinessFromText 解析后展示。
 */
import { computed } from "vue";
import VivadoReportView from "./VivadoReportView.vue";
import { parseBitstreamReadinessFromText, type ParsedBitstreamReadiness } from "./vivadoParsers";
import CopyableText from "../../__shared__/CopyableText.vue";

const props = defineProps<{ result: string }>();

const data = computed<ParsedBitstreamReadiness>(() =>
  parseBitstreamReadinessFromText(props.result) ?? {
    verdict: "UNKNOWN", status: "", cwCount: 0, timingMet: null,
    wns: null, whs: null, failingEndpoints: null, totalEndpoints: null,
    blockers: [], warnings: [], samples: [], raw: props.result,
  },
);

const verdictLabel = computed(() => {
  const v = data.value.verdict;
  if (v === "READY") return "✅ READY · 可安全生成比特流";
  if (v === "WARN") return "⚠ WARN · 可生成但有风险";
  if (v.startsWith("BLOCK")) return "❌ BLOCK · 不建议生成比特流";
  return v;
});

const cwClass = computed(() => {
  const n = data.value.cwCount;
  if (n <= 0) return "good";
  if (n >= 5) return "bad";
  return "warn";
});

const timingClass = computed(() => {
  if (data.value.timingMet === true) return "good";
  if (data.value.timingMet === false) return "bad";
  return "neutral";
});

function formatWns(wns: number): string {
  return (wns >= 0 ? "+" : "") + wns.toFixed(3);
}
</script>

<style scoped>
.state-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 4px;
    margin: 4px 0 6px;
}
.state-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border-radius: 4px;
    background: rgba(var(--v-theme-on-surface), 0.04);
}
.state-cell-label {
    font-size: 10.5px;
    color: rgba(var(--v-theme-on-surface), 0.5);
    text-transform: uppercase;
    letter-spacing: 0.3px;
}
.state-cell-value {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.85);
}
.state-cell-value.good    { color: #2da44e; }
.state-cell-value.warn    { color: #b58400; }
.state-cell-value.bad     { color: #cf222e; }
.state-cell-value.neutral { color: rgba(var(--v-theme-on-surface), 0.55); }

.issue-list, .sample-list {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 11.5px;
    color: rgba(var(--v-theme-on-surface), 0.8);
}
.issue-list li {
    padding: 2px 0 2px 14px;
    position: relative;
}
.issue-list li::before {
    content: "•";
    position: absolute;
    left: 4px;
    color: rgba(var(--v-theme-on-surface), 0.4);
}
.sample-list li {
    padding: 2px 0;
    font-family: ui-monospace, monospace;
    font-size: 11px;
}

.vivado-section {
    margin-top: 6px;
    padding: 6px 10px;
    background: rgba(var(--v-theme-on-surface), 0.03);
    border-left: 2px solid rgba(var(--v-theme-on-surface), 0.12);
    border-radius: 0 4px 4px 0;
}
.vivado-section.section-error { border-left-color: rgba(207, 34, 46, 0.6); background: rgba(207, 34, 46, 0.05); }
.vivado-section.section-warn  { border-left-color: rgba(181, 132, 0, 0.6); background: rgba(181, 132, 0, 0.05); }
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

.vivado-proposal {
    margin-top: 6px;
    padding: 6px 10px;
    background: rgba(255, 180, 0, 0.06);
    border-left: 2px solid #b58400;
    border-radius: 0 4px 4px 0;
}
.vivado-proposal-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    font-weight: 600;
    color: #b58400;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-bottom: 3px;
}
.vivado-proposal-text {
    font-size: 11.5px;
    line-height: 1.5;
    color: rgba(var(--v-theme-on-surface), 0.8);
}
.cmd-chip {
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(var(--v-theme-on-surface), 0.08);
    color: rgba(var(--v-theme-on-surface), 0.8);
}
</style>
