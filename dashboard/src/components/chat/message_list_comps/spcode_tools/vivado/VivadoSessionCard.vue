<!--
  VivadoSessionCard
  ─────────────────────────────────────────────────────────────────────
  A 组 3 个工具的展示：start_session / stop_session / list_sessions。
  复用 IntaShell session-card 骨架，加 session-mode chip + 可选 banner。

  Author: elecvoid243, 2026-07-27
-->
<template>
  <!-- list_sessions -->
  <div v-if="toolName === 'mcp_vivado__list_sessions'" class="vivado-card">
    <div class="vivado-card-header">
      <v-icon size="14" class="vivado-card-header-icon">mdi-format-list-bulleted</v-icon>
      <span class="vivado-card-header-title">
        活跃 Vivado 会话（{{ listData.sessions.length }}）
      </span>
    </div>
    <div v-if="!listData.sessions.length" class="empty-note">
      当前没有活跃的 Vivado 会话
    </div>
    <div v-else class="session-list">
      <div v-for="s in listData.sessions" :key="s.sessionId" class="session-list-item">
        <div class="session-list-line">
          <CopyableText
            :value="s.sessionId"
            :display-value="s.sessionId.length > 12 ? `${s.sessionId.slice(0, 8)}…` : s.sessionId"
            :title="s.sessionId"
            mode="code"
            class="session-id"
          />
          <SessionStateChip :state="s.state" />
          <span v-if="s.mode" class="mode-chip">{{ s.mode }}</span>
          <span v-if="s.pid" class="pid-text">pid {{ s.pid }}</span>
        </div>
        <div v-if="s.vivadoPath" class="session-path">{{ s.vivadoPath }}</div>
      </div>
    </div>
  </div>

  <!-- start_session -->
  <div v-else-if="toolName === 'mcp_vivado__start_session' && startData" class="vivado-card">
    <div class="vivado-card-header">
      <v-icon size="14" class="vivado-card-header-icon">mdi-play-circle-outline</v-icon>
      <span class="vivado-card-header-title">Vivado 会话已启动</span>
      <SessionStateChip v-if="startData.state" :state="startData.state" />
      <span v-if="startData.mode" class="mode-chip">{{ startData.mode }}</span>
    </div>
    <div class="vivado-row">
      <span class="vivado-row-label">会话 ID</span>
      <CopyableText v-if="startData.sessionId" :value="startData.sessionId" mode="code" class="vivado-row-value" />
    </div>
    <div v-if="startData.vivadoPath" class="vivado-row">
      <span class="vivado-row-label">Vivado</span>
      <CopyableText :value="startData.vivadoPath" mode="code" class="vivado-row-value" />
    </div>
    <div v-if="startData.banner" class="vivado-row">
      <span class="vivado-row-label">启动信息</span>
      <pre class="banner-pre">{{ startData.banner }}</pre>
    </div>
    <div v-if="startData.curdirWarning" class="vivado-warning">
      <v-icon size="12">mdi-alert</v-icon>
      <pre>{{ startData.curdirWarning }}</pre>
    </div>
    <div v-if="startData.asciiWarning" class="vivado-warning warn-strong">
      <v-icon size="12">mdi-alert</v-icon>
      <pre>{{ startData.asciiWarning }}</pre>
    </div>
  </div>

  <!-- stop_session -->
  <div v-else-if="toolName === 'mcp_vivado__stop_session' && stopData" class="vivado-card">
    <div class="vivado-card-header">
      <v-icon size="14" class="vivado-card-header-icon">mdi-stop-circle-outline</v-icon>
      <span class="vivado-card-header-title">Vivado 会话已停止</span>
      <SessionStateChip :state="stopData.state" />
    </div>
    <div v-if="stopData.sessionId" class="vivado-row">
      <span class="vivado-row-label">会话 ID</span>
      <CopyableText :value="stopData.sessionId" mode="code" class="vivado-row-value" />
    </div>
    <div v-if="stopData.message" class="vivado-row">
      <span class="vivado-row-label">消息</span>
      <span class="vivado-row-value">{{ stopData.message }}</span>
    </div>
  </div>

  <!-- 解析失败 / 未知 -->
  <div v-else-if="isError" class="result-status error">
    <v-icon size="16">mdi-alert-circle</v-icon>
    <span>{{ result || 'Unknown error' }}</span>
  </div>

  <!-- fallback -->
  <pre v-else class="result-raw">{{ result }}</pre>
</template>

<script setup lang="ts">
import { computed, defineComponent, h } from "vue";
import CopyableText from "../../__shared__/CopyableText.vue";
import {
  parseStartSessionFromText,
  parseStopSessionFromText,
  parseListSessionsFromText,
  type ParsedStartSession,
  type ParsedStopSession,
  type ParsedListSessions,
} from "./vivadoParsers";
import { getVivadoSessionStateMeta } from "./vivadoLabels";
import type { SessionStateMeta } from "../../inta_shell_tools/icons";

const props = defineProps<{
  toolName: string;
  result: string;
}>();

const isError = computed(() => props.result.trim().startsWith("[ERROR]"));

const startData = computed<ParsedStartSession | null>(() => {
  if (props.toolName !== "mcp_vivado__start_session") return null;
  return parseStartSessionFromText(props.result);
});

const stopData = computed<ParsedStopSession | null>(() => {
  if (props.toolName !== "mcp_vivado__stop_session") return null;
  return parseStopSessionFromText(props.result);
});

const listData = computed<ParsedListSessions>(() => {
  if (props.toolName !== "mcp_vivado__list_sessions") {
    return { sessions: [], raw: props.result };
  }
  return parseListSessionsFromText(props.result) ?? { sessions: [], raw: props.result };
});

// Inline sub-component: SessionStateChip (复用 IntaShell 风格)
const SessionStateChip = defineComponent({
  name: "VivadoSessionStateChip",
  props: { state: { type: String, required: true } },
  setup(p) {
    return () => {
      const meta: SessionStateMeta = getVivadoSessionStateMeta(p.state);
      return h("span", { class: ["state-chip", { pulse: !!meta.pulse }], style: { color: meta.color, borderColor: meta.color } }, [
        h("i", { class: ["mdi", meta.icon, "state-chip-icon"], style: { color: meta.color } }),
        h("span", { class: "state-chip-label" }, p.state),
      ]);
    };
  },
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
}
.vivado-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 3px 8px;
    font-size: 11px;
    line-height: 1.55;
}
.vivado-row + .vivado-row { border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05); }
.vivado-row-label {
    flex-shrink: 0;
    width: 64px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.5);
    padding-right: 8px;
}
.vivado-row-value {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: rgba(var(--v-theme-on-surface), 0.8);
    word-break: break-all;
    min-width: 0;
}
.banner-pre {
    flex: 1;
    margin: 0;
    padding: 6px 10px;
    border-radius: 4px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: rgba(var(--v-theme-on-surface), 0.75);
    white-space: pre-wrap;
    max-height: 160px;
    overflow-y: auto;
}
.vivado-warning {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    margin: 4px 8px;
    padding: 4px 8px;
    background: rgba(255, 180, 0, 0.06);
    border-left: 2px solid #b58400;
    border-radius: 0 4px 4px 0;
    font-size: 10.5px;
    color: rgba(var(--v-theme-on-surface), 0.8);
    &.warn-strong {
        background: rgba(207, 34, 46, 0.05);
        border-left-color: #cf222e;
    }
    pre {
        flex: 1;
        margin: 0;
        padding: 0;
        background: transparent;
        white-space: pre-wrap;
        font-family: ui-monospace, monospace;
        font-size: 10.5px;
    }
}
.session-list { max-height: 320px; overflow-y: auto; }
.session-list-item {
    padding: 6px 8px;
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.session-list-item:first-child { border-top: none; }
.session-list-line {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 3px;
    flex-wrap: wrap;
}
.session-id {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(var(--v-theme-on-surface), 0.05);
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    color: rgba(var(--v-theme-on-surface), 0.65);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mode-chip {
    padding: 1px 6px;
    border-radius: 9px;
    background: rgba(var(--v-theme-primary), 0.1);
    color: rgb(var(--v-theme-primary));
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    font-weight: 600;
}
.pid-text {
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    color: rgba(var(--v-theme-on-surface), 0.5);
}
.session-path {
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    color: rgba(var(--v-theme-on-surface), 0.55);
    background: rgba(var(--v-theme-on-surface), 0.03);
    padding: 2px 6px;
    border-radius: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.state-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 6px;
    border-radius: 9px;
    border: 1px solid;
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1;
    background: rgba(var(--v-theme-on-surface), 0.02);
    flex-shrink: 0;
}
.state-chip-icon { font-size: 11px; }
.state-chip-label { text-transform: lowercase; letter-spacing: 0.02em; }
.state-chip.pulse .state-chip-icon { animation: stateChipPulse 1.6s ease-in-out infinite; }
@keyframes stateChipPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
}
.empty-note {
    padding: 8px 12px;
    font-size: 11px;
    font-style: italic;
    color: rgba(var(--v-theme-on-surface), 0.45);
    text-align: center;
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
