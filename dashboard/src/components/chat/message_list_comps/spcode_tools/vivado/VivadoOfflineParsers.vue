<!--
  VivadoOfflineParsers
  ─────────────────────────────────────────────────────────────────────
  D 组 7 个离线解析工具的展示（按 toolName 路由）：
    parse_xpr            - .xpr 工程文件解析
    parse_bit_header     - .bit 头部解析
    parse_ltx            - .ltx 探针解析
    compare_xci          - XCI 差异对比
    verilog_compile_check - Verilog 编译检查
    xdc_lint             - XDC 静态检查
    xdc_auto_fix         - XDC 自动修复

  这些工具都不需要 vivado session，纯 Python 解析，结果通常是固定 schema 的报告。
  全部走 VivadoReportView 通用报告容器。

  Author: elecvoid243, 2026-07-27
-->
<template>
  <!-- 错误态 -->
  <div v-if="isError" class="result-status error">
    <v-icon size="16">mdi-alert-circle</v-icon>
    <span>{{ props.result.split('\n')[0].replace('[ERROR]', '').trim() || 'Unknown error' }}</span>
  </div>

  <!-- parse_xpr -->
  <VivadoReportView v-else-if="toolName === 'mcp_vivado__parse_xpr'" :verdict="xprOk ? 'ok' : 'unknown'" :raw-text="props.result">
    <div v-if="xprData.projectName" class="kv-list">
      <div class="kv-row">
        <span class="kv-label">项目名</span>
        <CopyableText :value="xprData.projectName" mode="code" />
      </div>
      <div v-if="xprData.part" class="kv-row">
        <span class="kv-label">Part</span>
        <CopyableText :value="xprData.part" mode="code" />
      </div>
      <div v-if="xprData.top" class="kv-row">
        <span class="kv-label">顶层</span>
        <CopyableText :value="xprData.top" mode="code" />
      </div>
      <div v-if="xprData.directory" class="kv-row">
        <span class="kv-label">目录</span>
        <CopyableText :value="xprData.directory" mode="code" />
      </div>
      <div v-if="xprData.synthStrategy" class="kv-row">
        <span class="kv-label">synth_1</span>
        <span class="kv-value">{{ xprData.synthStrategy }}</span>
      </div>
      <div v-if="xprData.implStrategy" class="kv-row">
        <span class="kv-label">impl_1</span>
        <span class="kv-value">{{ xprData.implStrategy }}</span>
      </div>
    </div>
    <div v-else class="empty-note">未解析到字段（格式不识别）</div>
  </VivadoReportView>

  <!-- parse_bit_header -->
  <VivadoReportView v-else-if="toolName === 'mcp_vivado__parse_bit_header'" :verdict="bitHeaderOk ? 'ok' : 'unknown'" :raw-text="props.result">
    <div v-if="bitData.designName || bitData.partNorm" class="kv-list">
      <div v-if="bitData.designName" class="kv-row">
        <span class="kv-label">设计名</span>
        <CopyableText :value="bitData.designName" mode="code" />
      </div>
      <div v-if="bitData.partNorm" class="kv-row">
        <span class="kv-label">Part (规整)</span>
        <CopyableText :value="bitData.partNorm" mode="code" />
      </div>
      <div v-if="bitData.partRaw" class="kv-row">
        <span class="kv-label">Part (原始)</span>
        <CopyableText :value="bitData.partRaw" mode="code" />
      </div>
      <div v-if="bitData.buildDate" class="kv-row">
        <span class="kv-label">构建日期</span>
        <CopyableText :value="bitData.buildDate" mode="code" />
      </div>
      <div v-if="bitData.sha256" class="kv-row">
        <span class="kv-label">SHA256</span>
        <CopyableText :value="bitData.sha256" mode="code" />
      </div>
    </div>
    <div v-if="bitData.partNorm || bitData.partRaw" class="vivado-proposal">
      <div class="vivado-proposal-label">
        <v-icon size="12">mdi-information-outline</v-icon>
        注意
      </div>
      <div class="vivado-proposal-text">
        与 .xpr 的 part 比对只能到 package 级（速度等级不可还原）。
      </div>
    </div>
  </VivadoReportView>

  <!-- parse_ltx -->
  <VivadoReportView v-else-if="toolName === 'mcp_vivado__parse_ltx'" verdict="ok" :raw-text="props.result">
    <pre class="vivado-pre">{{ props.result }}</pre>
  </VivadoReportView>

  <!-- compare_xci -->
  <VivadoReportView v-else-if="toolName === 'mcp_vivado__compare_xci'" :verdict="xciOk ? (xciData.diffParams.length ? 'warn' : 'ok') : 'unknown'" :raw-text="props.result">
    <div v-if="xciData.diffParams.length" class="vivado-section section-warn">
      <div class="vivado-section-title">
        <v-icon size="12">mdi-vector-difference</v-icon>
        差异参数（{{ xciData.diffParams.length }}）
      </div>
      <table v-if="xciData.diffParams.length" class="xci-table">
        <thead>
          <tr><th>参数</th><th>A</th><th>B</th></tr>
        </thead>
        <tbody>
          <tr v-for="(d, i) in xciData.diffParams" :key="i">
            <td><CopyableText :value="d.name" mode="code" /></td>
            <td><CopyableText :value="d.a" mode="code" /></td>
            <td><CopyableText :value="d.b" mode="code" /></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="xciData.sameCount > 0" class="vivado-row">
      <span class="vivado-row-label">相同</span>
      <span class="vivado-row-value">{{ xciData.sameCount }} 个参数（折叠）</span>
    </div>
    <div v-if="!xciData.diffParams.length && xciData.sameCount === 0" class="empty-note">无差异</div>
  </VivadoReportView>

  <!-- verilog_compile_check -->
  <VivadoReportView v-else-if="toolName === 'mcp_vivado__verilog_compile_check'" :verdict="verilogOk ? 'ok' : 'fail'" :raw-text="props.result">
    <div v-if="verilogData.files.length" class="files-block">
      <div v-for="(f, i) in verilogData.files" :key="i" class="file-row" :class="{ 'file-ok': f.passed, 'file-fail': !f.passed }">
        <v-icon size="12" :color="f.passed ? '#2da44e' : '#cf222e'">
          {{ f.passed ? 'mdi-check-circle' : 'mdi-alert-circle' }}
        </v-icon>
        <CopyableText :value="f.file" mode="code" class="file-name" />
        <span class="file-elapsed">{{ f.elapsed.toFixed(2) }}s</span>
        <span v-if="!f.passed && f.errorCount > 0" class="num-cell error">{{ f.errorCount }}</span>
      </div>
    </div>
    <div v-else class="empty-note">未解析到文件结果</div>
  </VivadoReportView>

  <!-- xdc_lint -->
  <VivadoReportView v-else-if="toolName === 'mcp_vivado__xdc_lint'" :verdict="lintOk ? (lintData.errorCount > 0 ? 'fail' : 'ok') : 'unknown'" :raw-text="props.result">
    <div v-if="lintData.issues.length" class="lint-issues">
      <div v-for="(iss, i) in lintData.issues" :key="i" class="lint-issue" :class="`lint-${iss.severity.toLowerCase()}`">
        <span class="num-cell" :class="iss.severity === 'CRITICAL' ? 'error' : 'warn'">{{ iss.severity }}</span>
        <span class="lint-rule">{{ iss.ruleId }}</span>
        <span class="lint-count">×{{ iss.count }}</span>
      </div>
    </div>
    <div v-else class="empty-note">无问题</div>
  </VivadoReportView>

  <!-- xdc_auto_fix -->
  <VivadoReportView v-else-if="toolName === 'mcp_vivado__xdc_auto_fix'" :verdict="fixOk ? 'ok' : 'unknown'" :raw-text="props.result">
    <pre class="vivado-pre">{{ props.result }}</pre>
  </VivadoReportView>

  <!-- fallback -->
  <pre v-else class="result-raw">{{ props.result }}</pre>
</template>

<script setup lang="ts">
import { computed } from "vue";
import VivadoReportView from "./VivadoReportView.vue";
import CopyableText from "../../__shared__/CopyableText.vue";
import {
  parseXprFromText,
  parseBitHeaderFromText,
  parseCompareXciFromText,
  parseVerilogCheckFromText,
  parseXdcLintFromText,
  type ParsedXpr,
  type ParsedBitHeader,
  type ParsedCompareXci,
  type ParsedVerilogCheck,
  type ParsedXdcLint,
} from "./vivadoParsers";

const props = defineProps<{ toolName: string; result: string }>();

const isError = computed(() => props.result.trim().startsWith("[ERROR]"));

const xprData = computed<ParsedXpr>(() =>
  parseXprFromText(props.result) ?? {
    projectName: "", part: "", top: "", directory: "",
    sourceFiles: { verilog: [], vhdl: [], ip: [], memory: [] },
    constraints: [], synthStrategy: "", implStrategy: "", raw: props.result,
  },
);
const xprOk = computed(() => !!xprData.value.projectName);

const bitData = computed<ParsedBitHeader>(() =>
  parseBitHeaderFromText(props.result) ?? {
    designName: "", partRaw: "", partNorm: "", buildDate: "", sha256: "",
  },
);
const bitHeaderOk = computed(() => !!bitData.value.designName || !!bitData.value.partNorm);

const xciData = computed<ParsedCompareXci>(() =>
  parseCompareXciFromText(props.result) ?? {
    fileA: "", fileB: "", diffParams: [], sameCount: 0, raw: props.result,
  },
);
const xciOk = computed(() => props.result.length > 0);

const verilogData = computed<ParsedVerilogCheck>(() =>
  parseVerilogCheckFromText(props.result) ?? { files: [], tool: "auto" },
);
const verilogOk = computed(() => verilogData.value.files.length > 0);

const lintData = computed<ParsedXdcLint>(() =>
  parseXdcLintFromText(props.result) ?? { issues: [], errorCount: 0, warnCount: 0 },
);
const lintOk = computed(() => lintData.value.issues.length > 0);

const fixOk = computed(() => props.result.length > 0);
</script>

<style scoped>
.kv-list { padding: 0; }
.kv-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    font-size: 11px;
    line-height: 1.55;
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.kv-row:first-child { border-top: none; }
.kv-label {
    flex-shrink: 0;
    width: 80px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.5);
}
.kv-value {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: rgba(var(--v-theme-on-surface), 0.8);
}

.vivado-section {
    margin: 0;
    padding: 6px 10px;
    background: rgba(var(--v-theme-on-surface), 0.03);
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
    border-radius: 0;
}
.vivado-section.section-warn { background: rgba(255, 180, 0, 0.04); }
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
.xci-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    font-family: ui-monospace, monospace;
}
.xci-table th, .xci-table td {
    padding: 3px 6px;
    text-align: left;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.xci-table th {
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.55);
    font-size: 10.5px;
    text-transform: uppercase;
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
}

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

.files-block { padding: 0; }
.file-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    font-size: 11px;
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.file-row:first-child { border-top: none; }
.file-name { flex: 1; min-width: 0; }
.file-elapsed {
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    color: rgba(var(--v-theme-on-surface), 0.5);
    flex-shrink: 0;
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

.lint-issues { padding: 0; }
.lint-issue {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    font-size: 11px;
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.lint-issue:first-child { border-top: none; }
.lint-rule {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.85);
}
.lint-count {
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    color: rgba(var(--v-theme-on-surface), 0.5);
}

.empty-note {
    padding: 8px 12px;
    font-size: 11px;
    font-style: italic;
    color: rgba(var(--v-theme-on-surface), 0.45);
    text-align: center;
}

.vivado-pre {
    margin: 0;
    padding: 8px 10px;
    border-radius: 4px;
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
.result-raw {
    margin: 0;
    padding: 8px 10px;
    border-radius: 4px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    font-family: ui-monospace, monospace;
    font-size: 11.5px;
    color: rgba(var(--v-theme-on-surface), 0.8);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 300px;
    overflow-y: auto;
}
</style>
