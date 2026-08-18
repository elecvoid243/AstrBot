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
        :style="{ '--member-color': memberColor(msg.session_id) }"
      >
        <div class="collab-transcript-meta">
          <span class="collab-transcript-dot" />
          <span class="collab-transcript-alias">
            {{ aliasOf(msg.session_id) }}
            <span class="collab-transcript-sid">{{ shortId(msg.session_id) }}</span>
          </span>
          <v-chip size="x-small" variant="tonal" class="ml-1">
            {{ msg.direction === 'sent' ? '收到输入' : '回复' }}
          </v-chip>
        </div>
        <div class="collab-transcript-text">{{ msg.text }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import {
  useAgentCollab,
  collabMemberColor,
  type CollabGroup,
} from '@/composables/useAgentCollab';

const props = defineProps<{ group: CollabGroup }>();
const emit = defineEmits<{ close: [] }>();

const { messages, restartStream } = useAgentCollab();
const listEl = ref<HTMLElement | null>(null);

function memberColor(sessionId: string) {
  return collabMemberColor(sessionId);
}

function aliasOf(sessionId: string) {
  return props.group.members.find((m) => m.session_id === sessionId)?.alias || '未知会话';
}

function shortId(sessionId: string) {
  return sessionId.slice(-8);
}

function scrollToBottom() {
  void nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
  });
}

// Reconnect to pick up the server-side replay so a panel opened mid-discussion
// still shows every past turn, then keep following live messages.
onMounted(async () => {
  await restartStream();
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
  border-left: 3px solid var(--member-color);
  border-radius: 4px;
  padding: 6px 10px;
  background: rgba(var(--v-theme-surface-variant), 0.35);
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

.collab-transcript-text {
  font-size: 0.875rem;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}
</style>
