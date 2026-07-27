<!--
  VivadoFlowResultView
  ─────────────────────────────────────────────────────────────────────
  B 组 3 个工具的展示：run_synthesis / run_implementation / generate_bitstream。
  进度条 + 数字徽章 + BLOCK 状态特化 + 折叠 raw。

  Author: elecvoid243, 2026-07-27
-->
<template>
  <!-- 错误态 -->
  <div v-if="data.isError" class="result-status error">
    <v-icon size="16">mdi-alert-circle</v-icon>
    <span>{{ data.status || props.result.split('\n')[0] }}</span>
  </div>

  <!-- BLOCK 状态 (generate_bitstream 专属, force=false 但有 CW) -->
  <div v-else-if="data.blocked" class="vivado-card block-state">
    <div class="vivado-card-header block-header">
      <v-icon size="14">mdi-block-helper</v-icon>
      <span class="vivado-card-header-title">安全检查未通过</span>
      <span class="num-cell warn">{{ data.blockSamples.length }} CRITICAL WARNING</span>
    </div>
    <div v-if="data.blockTitle" class="block-title">{{ data.blockTitle }}</div>
    <div v-if="data.status" class="vivado-row">
      <span class="vivado-row-label">实现状态</span>
      <CopyableText :value="data.status" mode="code" class="vivado-row-value" />
    </div>
    <div class="vivado-section section-warn">
      <div class="vivado-section-title">
        <v-icon size="12">mdi-alert-octagon-outline</v-icon>
        CW 样本（前 {{ Math.min(data.blockSamples.length, 10) }} 条）
      </div>
      <ul class="sample-list">
        <li v-for="(s, i) in data.blockSamples.slice(0, 10)" :key="i">
          <CopyableText :value="s" mode="code" />
        </li>
      </ul>
    </div>
    <div class="vivado-proposal">
      <div class="vivado-proposal-label">
        <v-icon size="12">mdi-lightbulb-on-outline</v-icon>
        建议
      </div>
      <div class="vivado-proposal-text">
        先运行 <code class="cmd-chip">get_critical_warnings</code> 查看详情并修复。
        如确认可忽略，使用 <code class="cmd-chip">force=true</code> 跳过安全检查。
      </div>
    </div>
  </div>

  <!-- 正常流程结果 -->
  <div v-else class="vivado-card">
    <div class="vivado-card-header">
      <v-icon size="14" class="vivado-card-header-icon">{{ icon }}</v-icon>
      <span class="vivado-card-header-title">Vivado {{ data.label }}结果</span>
      <span v-if="verdictLabel" class="num-cell" :class="verdictClass">{{ verdictLabel }}</span>
    </div>

    <!-- 进度条 -->
    <div class="vivado-progress">
      <div class="vivado-progress-line">
        <v-progress-linear
          :model-value="data.progress"
          :color="progressColor"
          height="6"
          rounded
          class="vivado-progress-bar"
        />
        <span class="vivado-progress-status">{{ data.progress }}%</span>
      </div>
      <div class="vivado-progress-meta">
        <CopyableText v-if="data.status" :value="data.status" mode="code" />
        <span v-if="data.elapsed" class="vivado-progress-divider">·</span>
        <span v-if="data.elapsed">{{ data.elapsed }}</span>
      </div>
    </div>

    <!-- 诊断徽章 -->
    <div class="diag-row">
      <span class="diag-item">
        <span class="num-cell" :class="errorsClass">{{ data.diagnostic.errors }}</span>
        <span class="diag-label">ERROR</span>
      </span>
      <span class="diag-item">
        <span class="num-cell" :class="cwClass">{{ data.diagnostic.criticalWarnings }}</span>
        <span class="diag-label">CRITICAL WARNING</span>
      </span>
      <span class="diag-item">
        <span class="num-cell neutral">{{ data.diagnostic.warnings }}</span>
        <span class="diag-label">WARNING</span>
      </span>
    </div>

    <!-- CW 警告（>0 时显示） -->
    <div v-if="data.diagnostic.criticalWarnings > 0" class="vivado-section section-warn">
      <div class="vivado-section-title">
        <v-icon size="12">mdi-alert</v-icon>
        发现 {{ data.diagnostic.criticalWarnings }} 条 CRITICAL WARNING
      </div>
      <div class="vivado-proposal-text">
        建议立即运行 <code class="cmd-chip">get_critical_warnings</code> 查看分类详情和修复建议。
      </div>
    </div>

    <!-- Fileset 参数覆盖（综合/实现） -->
    <div v-if="data.overrideLines.length" class="vivado-section">
      <div class="vivado-section-title">
        <v-icon size="12">mdi-cog-outline</v-icon>
        Fileset 参数覆盖
      </div>
      <div v-for="(line, i) in data.overrideLines" :key="i" class="override-line">
        <CopyableText :value="line" mode="code" />
      </div>
    </div>

    <!-- 比特流目录（仅 bitstream） -->
    <div v-if="data.bitstreamDir" class="vivado-row">
      <span class="vivado-row-label">比特流目录</span>
      <CopyableText :value="data.bitstreamDir" mode="code" class="vivado-row-value" />
    </div>

    <!-- open_run 提示 -->
    <div v-if="data.openNote" class="vivado-row">
      <span class="vivado-row-label">自动打开</span>
      <span class="vivado-row-value vivado-row-value-dim">{{ data.openNote }}</span>
    </div>

    <!-- 原始输出折叠 -->
    <button
      type="button"
      class="vivado-more"
      :aria-expanded="showRaw"
      @click="showRaw = !showRaw"
    >
      <v-icon size="12" class="vivado-more-chevron" :class="{ open: showRaw }">mdi-chevron-down</v-icon>
      <span v-if="!showRaw">Show full output</span>
      <span v-else>Hide full output</span>
    </button>
    <pre v-if="showRaw" class="vivado-pre">{{ props.result }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import CopyableText from "../../__shared__/CopyableText.vue";
import { parseFlowResultFromText, parseBitstreamBlockFromText, type ParsedFlowResult } from "./vivadoParsers";

const props = defineProps<{
  toolName: string;
  result: string;
}>();

const data = computed<ParsedFlowResult>(() => {
  // 先尝试正常解析
  const label = labelOf(props.toolName);
  const parsed = parseFlowResultFromText(props.result, label);
  if (parsed) {
    // 检测 BLOCK 模式（generate_bitstream force=false 但有 CW）
    if (props.toolName === "mcp_vivado__generate_bitstream" && props.result.includes("安全检查未通过")) {
      const block = parseBitstreamBlockFromText(props.result);
      parsed.blocked = true;
      parsed.blockTitle = `发现 ${block?.samples.length ?? 0} 条 CRITICAL WARNING`;
      parsed.blockSamples = block?.samples ?? [];
    }
    return parsed;
  }
  return {
    label, status: "", progress: 0, elapsed: "",
    diagnostic: { errors: 0, criticalWarnings: 0, warnings: 0 },
    bitstreamDir: "", overrideLines: [], openNote: "",
    blocked: false, blockTitle: "", blockSamples: [],
    isError: true, raw: props.result,
  };
});

const icon = computed(() => {
  if (props.toolName === "mcp_vivado__run_synthesis") return "mdi-rocket-launch-outline";
  if (props.toolName === "mcp_vivado__run_implementation") return "mdi-cog-outline";
  if (props.toolName === "mcp_vivado__generate_bitstream") return "mdi-chip";
  return "mdi-wrench";
});

const verdictLabel = computed(() => {
  if (data.value.progress >= 100 && data.value.status.includes("Complete")) return "✅ COMPLETE";
  if (data.value.progress > 0 && data.value.progress < 100) return "运行中";
  if (data.value.status.toUpperCase().includes("ERROR")) return "❌ ERROR";
  return data.value.status || "UNKNOWN";
});

const verdictClass = computed(() => {
  if (data.value.progress >= 100 && data.value.status.includes("Complete")) return "success";
  if (data.value.progress > 0 && data.value.progress < 100) return "running";
  if (data.value.status.toUpperCase().includes("ERROR")) return "error";
  return "neutral";
});

const progressColor = computed(() => {
  if (data.value.progress >= 100) return "success";
  if (data.value.diagnostic.errors > 0) return "error";
  if (data.value.diagnostic.criticalWarnings > 0) return "warning";
  return "primary";
});

const errorsClass = computed(() => data.value.diagnostic.errors > 0 ? "error" : "neutral");
const cwClass = computed(() => {
  const n = data.value.diagnostic.criticalWarnings;
  if (n === 0) return "neutral";
  if (n >= 5) return "error";
  return "warn";
});

const showRaw = ref(false);

function labelOf(tool: string): string {
  if (tool === "mcp_vivado__run_synthesis") return "综合";
  if (tool === "mcp_vivado__run_implementation") return "实现";
  if (tool === "mcp_vivado__generate_bitstream") return "比特流";
  return "流程";
}
</script>

<style scoped>
.vivado-card {
    border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
    border-radius: 4px;
    overflow: hidden;
    font-size: 12px;
    line-height: 1.55;
}
.vivado-card.block-state { border-color: rgba(207, 34, 46, 0.5); }
.vivado-card-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.vivado-card-header.block-header {
    background: rgba(207, 34, 46, 0.06);
    color: #cf222e;
    border-bottom-color: rgba(207, 34, 46, 0.3);
}
.vivado-card-header-icon { color: rgba(var(--v-theme-on-surface), 0.5); flex-shrink: 0; }
.vivado-card-header-title {
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.75);
    font-size: 11.5px;
    flex: 1;
}
.block-header .vivado-card-header-title { color: #cf222e; }
.block-title {
    padding: 6px 10px;
    font-weight: 600;
    font-size: 12px;
    color: #cf222e;
    background: rgba(207, 34, 46, 0.05);
}
.vivado-progress {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 10px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    border-radius: 0;
    margin: 0;
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

.diag-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
    flex-wrap: wrap;
}
.diag-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
}
.diag-label {
    color: rgba(var(--v-theme-on-surface), 0.55);
    text-transform: uppercase;
    letter-spacing: 0.3px;
}

.vivado-section {
    margin: 0;
    padding: 6px 10px;
    background: rgba(var(--v-theme-on-surface), 0.03);
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
    border-left: none;
    border-right: none;
    border-bottom: none;
    border-radius: 0;
}
.vivado-section.section-warn { background: rgba(255, 180, 0, 0.05); }
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
.vivado-section.section-warn .vivado-section-title { color: #b58400; }
.override-line {
    padding: 2px 0;
    font-size: 11px;
    color: rgba(var(--v-theme-on-surface), 0.75);
}
.sample-list {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 11px;
}
.sample-list li { padding: 2px 0; }

.vivado-proposal {
    margin: 0;
    padding: 6px 10px;
    background: rgba(255, 180, 0, 0.06);
    border-top: 1px solid rgba(255, 180, 0, 0.2);
    border-radius: 0;
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
}
.vivado-row-value-dim { color: rgba(var(--v-theme-on-surface), 0.55); }

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
.vivado-more:hover {
    background: rgba(var(--v-theme-on-surface), 0.04);
    color: rgba(var(--v-theme-on-surface), 0.8);
}
.vivado-more-chevron { transition: transform 0.2s; color: rgba(var(--v-theme-on-surface), 0.4); }
.vivado-more-chevron.open { transform: rotate(180deg); }
.vivado-pre {
    margin: 0;
    padding: 8px 10px;
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
    background: rgba(var(--v-theme-on-surface), 0.04);
    font-family: ui-monospace, monospace;
    font-size: 11.5px;
    line-height: 1.55;
    color: rgba(var(--v-theme-on-surface), 0.8);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 300px;
    overflow-y: auto;
}

.num-cell {
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    border-radius: 9px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    font-weight: 600;
}
.num-cell.error   { background: rgba(207, 34, 46, 0.10); color: #cf222e; }
.num-cell.warn    { background: rgba(255, 180, 0, 0.10); color: #b58400; }
.num-cell.success { background: rgba(70, 200, 70, 0.10); color: #2da44e; }
.num-cell.neutral { background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.65); }
.num-cell.running { background: rgba(var(--v-theme-primary), 0.10); color: rgb(var(--v-theme-primary)); }

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
