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
      <div v-if="!messages.length" class="text-caption pa-4 text-center">
        暂无对话记录
      </div>
      <div
        v-for="(msg, i) in messages"
        :key="i"
        class="collab-transcript-item"
        :class="[`collab-transcript-item--${msg.direction}`, { streaming: msg.direction === 'stream' }]"
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
        <div v-if="msg.direction === 'sent'" class="collab-transcript-sent">
          {{ msg.text }}
        </div>
        <div v-else class="collab-transcript-reply">
          <MarkdownRender
            custom-id="chat-message"
            :content="msg.text"
            :custom-html-tags="CHAT_MARKDOWN_CUSTOM_TAGS"
            :is-dark="isDark"
            :final="msg.direction !== 'stream'"
            :smooth-streaming="msg.direction === 'stream' ? 'auto' : false"
            :fade="false"
            :typewriter="false"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, provide, ref, watch } from 'vue';
import { MarkdownRender } from 'markstream-vue';
import { CHAT_MARKDOWN_CUSTOM_TAGS } from '@/components/chat/chatMarkdownComponents';
import {
  useAgentCollab,
  collabMemberColor,
  type CollabGroup,
} from '@/composables/useAgentCollab';

const props = defineProps<{ group: CollabGroup; isDark: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { messages, activeDiscussion, loadTranscriptHistory, restartStream } = useAgentCollab();
const listEl = ref<HTMLElement | null>(null);

provide('isDark', props.isDark);

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
  if (direction === 'sent') return '收到输入';
  if (direction === 'stream') return '回复中…';
  return '回复';
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

watch(() => messages.value.length, scrollToBottom);
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
  max-width: 85%;
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

/* 注入到会话的输入（sent）— 与聊天页用户消息风格一致（右侧气泡） */
.collab-transcript-item--sent {
  align-self: flex-end;
  margin-left: auto;
  text-align: right;
}

.collab-transcript-item--sent .collab-transcript-meta {
  justify-content: flex-end;
}

.collab-transcript-sent {
  display: inline-block;
  text-align: left;
  background: rgb(var(--v-theme-surface-variant));
  border-radius: 12px 12px 2px 12px;
  padding: 8px 12px;
  font-size: 0.875rem;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  color: var(--chat-text, rgb(var(--v-theme-on-surface)));
}

/* Agent 回复（reply / stream）— 与聊天页机器人消息一致（左侧，markdown） */
.collab-transcript-item--reply,
.collab-transcript-item--stream {
  border-left: 3px solid var(--member-color);
  border-radius: 4px;
  padding: 8px 12px;
  background: var(--chat-session-active-bg, rgba(var(--v-theme-surface-variant), 0.4));
}

.collab-transcript-reply :deep(.markdown-content) {
  font-size: 0.875rem;
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
