<template>
  <div class="collab-transcript-panel">
    <div class="collab-transcript-header">
      <v-icon size="18" class="mr-2">mdi-forum-outline</v-icon>
      <span class="text-subtitle-1 mr-2">{{ group.name }} · 对话记录</span>
      <v-chip
        v-for="m in group.members"
        :key="m.session_id"
        size="x-small"
        class="ml-1"
        variant="tonal"
        :style="{ color: memberColor(m.session_id) }"
      >
        {{ m.alias }}{{ m.session_id === group.moderator_session_id ? ' · 主持' : '' }}
      </v-chip>
      <v-spacer />
      <v-btn
        icon="mdi-close"
        size="x-small"
        variant="text"
        title="关闭对话记录"
        @click="emit('close')"
      />
    </div>
    <div ref="listEl" class="collab-transcript-list">
      <div v-if="!displayMessages.length" class="text-caption pa-4 text-center">
        暂无对话记录
      </div>
      <div
        v-for="(msg, i) in displayMessages"
        :key="i"
        class="collab-transcript-item"
        :class="{ streaming: msg.direction === 'stream' }"
        :style="{ '--member-color': memberColor(msg.session_id) }"
      >
        <div class="collab-transcript-meta">
          <span class="collab-transcript-dot" />
          <span class="collab-transcript-alias">
            {{ aliasOf(msg.session_id) }}
            <span class="collab-transcript-sid">{{ shortId(msg.session_id) }}</span>
          </span>
          <v-chip size="x-small" variant="tonal" class="ml-1">
            {{ directionLabel(msg.direction) }}
          </v-chip>
        </div>
        <template v-if="msg.direction === 'stream'">
          <div class="collab-transcript-reply">
            <MarkdownRender
              custom-id="chat-message"
              :content="msg.text"
              :custom-html-tags="CHAT_MARKDOWN_CUSTOM_TAGS"
              :is-dark="isDark"
              :final="false"
              :smooth-streaming="'auto'"
              :fade="false"
              :typewriter="false"
            />
          </div>
        </template>
        <template v-else-if="msg.parts && msg.parts.length">
          <div
            v-for="(part, pi) in msg.parts"
            :key="pi"
            class="collab-transcript-part"
          >
            <div v-if="part.type === 'think'" class="collab-part-think">
              <span class="collab-part-icon">💭</span>
              <span class="collab-part-text">{{ part.think }}</span>
            </div>
            <div v-else-if="part.type === 'tool_call'" class="collab-part-tool">
              <span class="collab-part-icon">🔧</span>
              <span class="collab-part-text">{{ toolCallName(part) }}</span>
            </div>
            <div v-else-if="part.type === 'tool_call_result'" class="collab-part-tool-result">
              <span class="collab-part-icon">📎</span>
              <span class="collab-part-text">{{ shortToolResult(part) }}</span>
            </div>
            <div v-else-if="part.type === 'plain'" class="collab-transcript-reply">
              <MarkdownRender
                custom-id="chat-message"
                :content="String(part.text || '')"
                :custom-html-tags="CHAT_MARKDOWN_CUSTOM_TAGS"
                :is-dark="isDark"
                :final="true"
                :smooth-streaming="false"
                :fade="false"
                :typewriter="false"
              />
            </div>
          </div>
        </template>
        <template v-else>
          <div class="collab-transcript-reply">
            <MarkdownRender
              custom-id="chat-message"
              :content="msg.text"
              :custom-html-tags="CHAT_MARKDOWN_CUSTOM_TAGS"
              :is-dark="isDark"
              :final="true"
              :smooth-streaming="false"
              :fade="false"
              :typewriter="false"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, provide, ref, watch } from 'vue';
import { MarkdownRender } from 'markstream-vue';
import { CHAT_MARKDOWN_CUSTOM_TAGS } from '@/components/chat/chatMarkdownComponents';
import {
  useAgentCollab,
  collabMemberColor,
  type CollabGroup,
  type CollabMessage,
} from '@/composables/useAgentCollab';

const props = defineProps<{ group: CollabGroup; isDark: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { messages, activeDiscussion, loadTranscriptHistory, restartStream } = useAgentCollab();
const listEl = ref<HTMLElement | null>(null);

provide('isDark', props.isDark);

// The panel shows each agent's turn activity only — injected inputs ("收到
// 输入") are omitted, and telemetry blobs (agent_stats JSON persisted into
// older history records) are filtered defensively.
function isStatsBlob(m: CollabMessage) {
  const t = String(m.text || '').trim();
  return t.startsWith('{"') && t.includes('token_usage');
}

const displayMessages = computed(() =>
  messages.value.filter((m) => m.direction !== 'sent' && !isStatsBlob(m)),
);

function memberColor(sessionId: string) {
  return collabMemberColor(sessionId);
}

function aliasOf(sessionId: string) {
  return props.group.members.find((m) => m.session_id === sessionId)?.alias || '未知会话';
}

function shortId(sessionId: string) {
  return sessionId.slice(-8);
}

function directionLabel(direction: string) {
  if (direction === 'stream') return '回复中…';
  return '回复';
}

function toolCallName(part: any) {
  const calls = Array.isArray(part.tool_calls) ? part.tool_calls : [];
  const first = calls[0];
  const name = first?.name || part.name || 'tool';
  const args = first?.arguments ?? first?.arguments_str ?? '';
  const argsText =
    typeof args === 'string' ? args : args ? JSON.stringify(args) : '';
  return argsText ? `${name}(${argsText.slice(0, 120)})` : name;
}

function shortToolResult(part: any) {
  const text = part.result_text ?? part.result ?? part.data ?? '';
  const s = String(text).trim();
  return s ? s.slice(0, 160) : '(无结果)';
}

function scrollToBottom() {
  void nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
  });
}

// Persistent history first (survives page reloads), then the live stream
// replay for an active discussion; duplicates between the two are dropped
// by the composable merge.
onMounted(async () => {
  await loadTranscriptHistory(props.group.id);
  if (activeDiscussion.value) {
    await restartStream();
  }
  scrollToBottom();
});

watch(() => displayMessages.value.length, scrollToBottom);
</script>

<style scoped>
.collab-transcript-panel {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  background: var(--chat-bg, rgb(var(--v-theme-background)));
}

.collab-transcript-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.collab-transcript-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

.collab-transcript-item {
  margin-bottom: 12px;
  max-width: 100%;
}

.collab-transcript-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.collab-transcript-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--member-color);
}

.collab-transcript-alias {
  font-size: 0.8125rem;
  font-weight: 600;
}

.collab-transcript-sid {
  font-weight: 400;
  font-size: 0.6875rem;
  opacity: 0.6;
  margin-left: 4px;
}

/* Agent 回复（reply / stream）— 与聊天页机器人消息一致（左侧，markdown） */
.collab-transcript-reply {
  border-left: 3px solid var(--member-color);
  border-radius: 4px;
  padding: 8px 12px;
  background: var(--chat-session-active-bg, rgba(var(--v-theme-surface-variant), 0.4));
  margin-bottom: 6px;
}

.collab-transcript-reply :deep(.markdown-content) {
  font-size: 0.875rem;
}

/* 思考 / 工具调用 / 工具结果块 */
.collab-part-think,
.collab-part-tool,
.collab-part-tool-result {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  border-left: 3px solid var(--member-color);
  border-radius: 4px;
  padding: 6px 10px;
  margin-bottom: 6px;
  background: rgba(var(--v-theme-surface-variant), 0.25);
  font-size: 0.8125rem;
}

.collab-part-think {
  opacity: 0.85;
  font-style: italic;
}

.collab-part-icon {
  flex: none;
}

.collab-part-text {
  white-space: pre-wrap;
  word-break: break-word;
}

/* 流式光标 */
.collab-transcript-item.streaming .collab-transcript-reply :deep(.markdown-content)::after {
  content: '▍';
  margin-left: 2px;
  color: var(--member-color);
  animation: collab-caret-blink 0.8s steps(1) infinite;
}

@keyframes collab-caret-blink {
  50% {
    opacity: 0;
  }
}
</style>
