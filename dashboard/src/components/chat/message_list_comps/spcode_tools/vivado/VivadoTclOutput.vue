<!--
  VivadoTclOutput
  ─────────────────────────────────────────────────────────────────────
  C 组 2 个工具的展示：run_tcl / safe_tcl。
  命令独立高亮 + 原始输出（CopyableText） + quirk hint 默认折叠。

  Author: elecvoid243, 2026-07-27
-->
<template>
  <!-- 错误态 -->
  <div v-if="data.isError" class="result-status error">
    <v-icon size="16">mdi-alert-circle</v-icon>
    <span>{{ data.output.split('\n')[0].replace('[ERROR]', '').trim() || 'Unknown error' }}</span>
  </div>

  <div v-else class="vivado-card">
    <div class="vivado-card-header">
      <v-icon size="14" class="vivado-card-header-icon">{{ icon }}</v-icon>
      <span class="vivado-card-header-title">
        {{ toolName === 'mcp_vivado__safe_tcl' ? 'safe_tcl' : 'run_tcl' }}
      </span>
    </div>

    <!-- 命令框 -->
    <div v-if="commandText" class="command-block">
      <div class="command-label">
        <v-icon size="11">mdi-console-line</v-icon>
        命令
      </div>
      <CopyableText
        :value="commandText"
        mode="block"
        :multiline="true"
        bare
      >
        <pre class="command-pre">{{ commandText }}</pre>
      </CopyableText>
    </div>

    <!-- 输出框 -->
    <div v-if="data.output" class="output-block">
      <div class="output-label">
        <v-icon size="11">mdi-arrow-right-bold-circle-outline</v-icon>
        输出
      </div>
      <CopyableText
        :value="data.output"
        mode="block"
        :multiline="true"
        bare
      >
        <pre class="output-pre">{{ data.output }}</pre>
      </CopyableText>
    </div>

    <!-- 空输出 -->
    <div v-else class="empty-note">（无输出）</div>

    <!-- quirk hints 折叠 -->
    <button
      v-if="data.hasQuirkHints"
      type="button"
      class="vivado-more"
      :aria-expanded="showHints"
      @click="showHints = !showHints"
    >
      <v-icon size="12" class="vivado-more-chevron" :class="{ open: showHints }">mdi-chevron-down</v-icon>
      <span v-if="!showHints">提示（{{ data.quirks.length }} 条 quirk）</span>
      <span v-else>Hide hints</span>
    </button>
    <div v-if="showHints && data.hasQuirkHints" class="hints-block">
      <div v-for="(h, i) in data.quirks" :key="i" class="hint-item">
        <v-icon size="12" class="hint-icon">mdi-information-outline</v-icon>
        <pre class="hint-text">{{ h }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import CopyableText from "../../__shared__/CopyableText.vue";
import { parseTclOutputFromText, type ParsedTclOutput } from "./vivadoParsers";

const props = defineProps<{
  toolName: string;
  result: string;
  toolArgs?: Record<string, any>;
}>();

const icon = computed(() => {
  if (props.toolName === "mcp_vivado__safe_tcl") return "mdi-shield-check-outline";
  return "mdi-console-line";
});

/** 命令文本从 toolArgs.command 或 toolArgs.template 拿（run_tcl / safe_tcl） */
const commandText = computed(() => {
  if (props.toolArgs?.command) return String(props.toolArgs.command);
  if (props.toolArgs?.template) {
    const tpl = String(props.toolArgs.template);
    const args = props.toolArgs?.args;
    if (Array.isArray(args) && args.length) {
      return tpl.replace(/\{(\d+)\}/g, (_, i) => `"${args[Number(i)] ?? ''}"`);
    }
    return tpl;
  }
  return "";
});

const data = computed<ParsedTclOutput>(() =>
  parseTclOutputFromText(props.result, commandText.value),
);

const showHints = ref(false);
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
}
.command-block, .output-block {
    padding: 6px 10px;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.command-label, .output-label {
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
.command-pre, .output-pre {
    margin: 0;
    padding: 6px 10px;
    border-radius: 4px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11.5px;
    color: rgba(var(--v-theme-on-surface), 0.85);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
}
.output-pre { color: rgba(var(--v-theme-on-surface), 0.75); }
.empty-note {
    padding: 8px 12px;
    font-size: 11px;
    font-style: italic;
    color: rgba(var(--v-theme-on-surface), 0.45);
    text-align: center;
}

.hints-block {
    padding: 6px 10px;
    background: rgba(var(--v-theme-primary), 0.04);
    border-top: 1px dashed rgba(var(--v-theme-primary), 0.2);
}
.hint-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 4px 0;
    font-size: 11px;
}
.hint-icon { color: rgb(var(--v-theme-primary)); flex-shrink: 0; margin-top: 2px; }
.hint-text {
    flex: 1;
    margin: 0;
    padding: 0;
    background: transparent;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: rgba(var(--v-theme-on-surface), 0.75);
    white-space: pre-wrap;
    word-break: break-word;
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
