<!--
  VivadoToolResultView
  ─────────────────────────────────────────────────────────────────────
  vivado-mcp 30 个工具的二级分发入口。
  由 SpcodeToolResultView 在 toolName 以 "mcp_vivado__" 开头时调用。

  分发逻辑:
    A. 会话生命周期 ─── start_session / stop_session / list_sessions
       → VivadoSessionCard
    B. 长任务 + 进度 ── run_synthesis / run_implementation / generate_bitstream
       → VivadoFlowResultView
    C. Tcl 透传 ─────── run_tcl / safe_tcl
       → VivadoTclOutput
    D. 离线解析 ─────── 7 个工具 (parse_xpr / parse_bit_header / ...)
       → VivadoOfflineParsers
    E. 结构化报告 ───── 10 个工具 (get_io_report / get_timing_report / ...)
       → 各自特化组件
    F. 诊断 + 烧板 + 波形 ── 5 个工具
       → 各自特化组件 (VivadoCriticalWarningsView / VivadoProgramDeviceView / ...)

  Author: elecvoid243, 2026-07-27
-->
<template>
  <!-- ── A. 会话生命周期 ── -->
  <VivadoSessionCard
    v-if="isSessionTool"
    :tool-name="props.toolName"
    :result="props.result"
  />

  <!-- ── B. 长任务 + 进度 ── -->
  <VivadoFlowResultView
    v-else-if="isFlowTool"
    :tool-name="props.toolName"
    :result="props.result"
  />

  <!-- ── C. Tcl 透传 ── -->
  <VivadoTclOutput
    v-else-if="isTclTool"
    :tool-name="props.toolName"
    :result="props.result"
    :tool-args="props.toolArgs"
  />

  <!-- ── D. 离线解析 (7 个) ── -->
  <VivadoOfflineParsers
    v-else-if="isOfflineTool"
    :tool-name="props.toolName"
    :result="props.result"
  />

  <!-- ── E. 结构化报告 (10 个) ── -->
  <VivadoCheckReadinessView
    v-else-if="toolName === 'mcp_vivado__check_bitstream_readiness'"
    :result="props.result"
  />
  <VivadoTimingView
    v-else-if="toolName === 'mcp_vivado__get_timing_report'"
    :result="props.result"
  />
  <VivadoUtilizationView
    v-else-if="toolName === 'mcp_vivado__get_utilization_report'"
    :result="props.result"
  />
  <VivadoRunProgressView
    v-else-if="toolName === 'mcp_vivado__get_run_progress'"
    :result="props.result"
  />
  <VivadoReportView
    v-else-if="['mcp_vivado__get_io_report', 'mcp_vivado__get_project_info',
                 'mcp_vivado__get_ip_status', 'mcp_vivado__get_next_suggestion',
                 'mcp_vivado__get_pre_commit_summary', 'mcp_vivado__inspect_ip_params'].includes(toolName)"
    :verdict="verdictForGeneric"
    :raw-text="props.result"
  >
    <pre class="vivado-pre">{{ props.result }}</pre>
  </VivadoReportView>

  <!-- ── F. 诊断 + 烧板 + 波形 ── -->
  <VivadoCriticalWarningsView
    v-else-if="toolName === 'mcp_vivado__get_critical_warnings'"
    :result="props.result"
  />
  <VivadoIoVerificationView
    v-else-if="toolName === 'mcp_vivado__verify_io_placement_tool'"
    :result="props.result"
  />
  <VivadoProgramDeviceView
    v-else-if="toolName === 'mcp_vivado__program_device'"
    :result="props.result"
  />
  <VivadoWaveView
    v-else-if="isWaveTool"
    :tool-name="props.toolName"
    :result="props.result"
  />

  <!-- ── fallback (未知 vivado 工具) ── -->
  <pre v-else class="result-raw">{{ props.result }}</pre>
</template>

<script setup lang="ts">
import { computed } from "vue";
import VivadoSessionCard from "./VivadoSessionCard.vue";
import VivadoFlowResultView from "./VivadoFlowResultView.vue";
import VivadoTclOutput from "./VivadoTclOutput.vue";
import VivadoOfflineParsers from "./VivadoOfflineParsers.vue";
import VivadoReportView from "./VivadoReportView.vue";
import VivadoCheckReadinessView from "./VivadoCheckReadinessView.vue";
import VivadoTimingView from "./VivadoTimingView.vue";
import VivadoUtilizationView from "./VivadoUtilizationView.vue";
import VivadoRunProgressView from "./VivadoRunProgressView.vue";
import VivadoCriticalWarningsView from "./VivadoCriticalWarningsView.vue";
import VivadoIoVerificationView from "./VivadoIoVerificationView.vue";
import VivadoProgramDeviceView from "./VivadoProgramDeviceView.vue";
import VivadoWaveView from "./VivadoWaveView.vue";

const props = defineProps<{
  toolName: string;
  result: string;
  toolArgs?: Record<string, any>;
}>();

// 路由工具集合
const SESSION_TOOLS = new Set([
  "mcp_vivado__start_session",
  "mcp_vivado__stop_session",
  "mcp_vivado__list_sessions",
]);
const FLOW_TOOLS = new Set([
  "mcp_vivado__run_synthesis",
  "mcp_vivado__run_implementation",
  "mcp_vivado__generate_bitstream",
]);
const TCL_TOOLS = new Set([
  "mcp_vivado__run_tcl",
  "mcp_vivado__safe_tcl",
]);
const OFFLINE_TOOLS = new Set([
  "mcp_vivado__parse_xpr",
  "mcp_vivado__parse_bit_header",
  "mcp_vivado__parse_ltx",
  "mcp_vivado__compare_xci",
  "mcp_vivado__verilog_compile_check",
  "mcp_vivado__xdc_lint",
  "mcp_vivado__xdc_auto_fix",
]);
const WAVE_TOOLS = new Set([
  "mcp_vivado__set_wave_zoom",
  "mcp_vivado__set_wave_analog",
]);

const isSessionTool = computed(() => SESSION_TOOLS.has(props.toolName));
const isFlowTool = computed(() => FLOW_TOOLS.has(props.toolName));
const isTclTool = computed(() => TCL_TOOLS.has(props.toolName));
const isOfflineTool = computed(() => OFFLINE_TOOLS.has(props.toolName));
const isWaveTool = computed(() => WAVE_TOOLS.has(props.toolName));

/** 通用 E 组报告的 verdict 推断（粗略，专用组件各自有更细的判定）。 */
const verdictForGeneric = computed(() => {
  if (props.result.startsWith("[ERROR]")) return "error";
  if (props.result.includes("[WARN]") || props.result.includes("WARN ")) return "warn";
  return "ok";
});
</script>

<style scoped>
.vivado-pre {
    margin: 0;
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
.result-raw {
    margin: 0;
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
