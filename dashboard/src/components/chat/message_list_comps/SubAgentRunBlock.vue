<template>
  <div class="subagent-run-block" :class="{ 'is-dark': isDark }">
    <button class="subagent-run-header" type="button" @click="toggleExpanded">
      <span class="status-dot" :class="`status-${statusClass}`" />
      <v-icon size="18" class="agent-icon">mdi-robot-outline</v-icon>
      <span class="agent-name">{{ part.agent_name || "subagent" }}</span>
      <span class="status-label">{{ statusLabel }}</span>
      <span v-if="durationText" class="duration">{{ durationText }}</span>
      <v-icon class="expand-icon" size="18">
        {{ expanded ? "mdi-chevron-up" : "mdi-chevron-down" }}
      </v-icon>
    </button>

    <v-expand-transition>
      <div v-show="expanded" class="subagent-run-body">
        <div v-if="part.input_preview" class="section input-preview">
          <div class="section-label">Task</div>
          <div class="section-text">{{ part.input_preview }}</div>
        </div>

        <ReasoningBlock
          v-if="part.reasoning"
          :reasoning="part.reasoning"
          :is-dark="isDark"
          :is-streaming="part.status === 'running'"
        />

        <MarkdownMessagePart
          v-if="part.text"
          :content="part.text"
          :is-dark="isDark"
          :is-streaming="part.status === 'running'"
        />

        <div v-if="normalizedToolCalls.length" class="tool-call-block">
          <ToolCallCard
            v-for="tool in normalizedToolCalls"
            :key="tool.id || tool.name"
            :tool-call="tool"
            :is-dark="isDark"
          />
        </div>

        <div v-if="part.error" class="error-text">{{ part.error }}</div>
      </div>
    </v-expand-transition>
  </div>
</template>

<script setup>
// Author: elecvoid243
// Date: 2026-07-26
// Plan: docs/superpowers/plans/2026-07-26-subagent-chatui-progress.md (Task 6)
// Collapsible block rendering one `subagent_run` message part (live stream
// or persisted history). Reuses ReasoningBlock / MarkdownMessagePart /
// ToolCallCard for visual consistency with the main agent output.
import { computed, ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import ReasoningBlock from "@/components/chat/message_list_comps/ReasoningBlock.vue";
import MarkdownMessagePart from "@/components/chat/message_list_comps/MarkdownMessagePart.vue";
import ToolCallCard from "@/components/chat/message_list_comps/ToolCallCard.vue";

const props = defineProps({
  part: {
    type: Object,
    required: true,
  },
  isDark: {
    type: Boolean,
    default: false,
  },
});

const { tm } = useModuleI18n("features/chat");

const expanded = ref(props.part.status === "running");

// Auto-collapse when the run finishes while the block was auto-expanded.
watch(
  () => props.part.status,
  (status, prev) => {
    if (prev === "running" && status !== "running") {
      expanded.value = false;
    }
  },
);

function toggleExpanded() {
  expanded.value = !expanded.value;
}

const statusClass = computed(() => {
  const status = props.part.status;
  if (status === "completed") return "completed";
  if (status === "failed" || status === "timeout") return "failed";
  return "running";
});

const statusLabel = computed(() => {
  const status = props.part.status;
  if (status === "completed") return tm("subagentStatus.completed");
  if (status === "failed") return tm("subagentStatus.failed");
  if (status === "timeout") return tm("subagentStatus.timeout");
  return tm("subagentStatus.running");
});

const durationText = computed(() => {
  const seconds = props.part.execution_time;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "";
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  return `${seconds.toFixed(1)}s`;
});

const normalizedToolCalls = computed(() =>
  (props.part.tool_calls || []).map((tool) => {
    const normalized = { ...tool };
    normalized.args = normalized.args ?? normalized.arguments ?? {};
    if (normalized.result && typeof normalized.result === "object") {
      normalized.result = JSON.stringify(normalized.result, null, 2);
    }
    // ToolCallCard treats `finished_ts` as the done marker.
    if (normalized.result != null && !normalized.finished_ts) {
      normalized.ts = normalized.ts ?? Date.now() / 1000;
      normalized.finished_ts = normalized.ts;
    }
    return normalized;
  }),
);
</script>

<style scoped>
.subagent-run-block {
  margin: 6px 0;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  overflow: hidden;
}

.subagent-run-block.is-dark {
  border-color: rgba(255, 255, 255, 0.12);
}

.subagent-run-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: left;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-running {
  background: #4caf50;
  animation: pulse 1.2s ease-in-out infinite;
}

.status-completed {
  background: #4caf50;
}

.status-failed {
  background: #e57373;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.agent-icon {
  opacity: 0.7;
}

.agent-name {
  font-weight: 600;
  font-size: 0.9em;
}

.status-label {
  font-size: 0.82em;
  opacity: 0.65;
}

.duration {
  font-size: 0.82em;
  opacity: 0.55;
}

.expand-icon {
  margin-left: auto;
  opacity: 0.5;
}

.subagent-run-body {
  padding: 4px 12px 10px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.is-dark .subagent-run-body {
  border-top-color: rgba(255, 255, 255, 0.1);
}

.section-label {
  font-size: 0.78em;
  opacity: 0.55;
  margin-bottom: 2px;
}

.section-text {
  font-size: 0.88em;
  opacity: 0.8;
  white-space: pre-wrap;
  word-break: break-word;
}

.input-preview {
  margin: 6px 0;
}

.error-text {
  margin-top: 6px;
  font-size: 0.85em;
  color: #e57373;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
