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
        icon="mdi-unfold-more-horizontal"
        size="x-small"
        variant="text"
        title="全部展开"
        @click="setAllCollapsed(false)"
      />
      <v-btn
        icon="mdi-unfold-less-horizontal"
        size="x-small"
        variant="text"
        title="全部折叠"
        @click="setAllCollapsed(true)"
      />
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
        class="collab-turn"
        :class="{ streaming: msg.direction === 'stream' }"
        :style="turnVars(msg.session_id)"
      >
        <button
          class="collab-turn-header"
          type="button"
          @click="toggleTurn(i)"
        >
          <v-progress-circular
            v-if="msg.direction === 'stream'"
            indeterminate
            size="14"
            width="2"
            :color="memberColor(msg.session_id)"
          />
          <span v-else class="collab-turn-dot" />
          <span class="collab-turn-alias">{{ aliasOf(msg.session_id) }}</span>
          <span class="collab-turn-sid">{{ shortId(msg.session_id) }}</span>
          <v-chip
            v-if="msg.session_id === group.moderator_session_id"
            size="x-small"
            variant="tonal"
            color="primary"
          >
            主持
          </v-chip>
          <span v-if="isTurnCollapsed(i)" class="collab-turn-preview">
            {{ previewOf(msg) }}
          </span>
          <v-spacer />
          <v-icon
            size="18"
            class="collab-turn-chevron"
            :class="{ collapsed: isTurnCollapsed(i) }"
          >
            mdi-chevron-down
          </v-icon>
        </button>
        <div v-show="!isTurnCollapsed(i)" class="collab-turn-body">
          <template v-for="(block, bi) in blocksOf(msg)" :key="bi">
            <ReasoningBlock
              v-if="block.kind === 'thinking'"
              :parts="block.parts"
              :is-dark="isDark"
              :initial-expanded="false"
            />
            <template v-else>
              <template v-for="(part, pi) in block.parts" :key="pi">
                <MarkdownMessagePart
                  v-if="part.type === 'plain'"
                  :content="String(part.text || '')"
                  :refs="null"
                  :is-dark="isDark"
                  :custom-html-tags="CHAT_MARKDOWN_CUSTOM_TAGS"
                  :is-streaming="msg.direction === 'stream'"
                />
                <div
                  v-else-if="part.type === 'tool_call_result'"
                  class="collab-tool-result"
                  :title="toolResultText(part)"
                >
                  <v-icon size="14">mdi-subdirectory-arrow-right</v-icon>
                  <span>{{ toolResultText(part).slice(0, 160) || '(无结果)' }}</span>
                </div>
              </template>
            </template>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, provide, ref, watch } from 'vue';
import ReasoningBlock from '@/components/chat/message_list_comps/ReasoningBlock.vue';
import MarkdownMessagePart from '@/components/chat/message_list_comps/MarkdownMessagePart.vue';
import { CHAT_MARKDOWN_CUSTOM_TAGS } from '@/components/chat/chatMarkdownComponents';
import { messageBlocks, type ChatContent } from '@/composables/useMessages';
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

// ---------- per-turn collapse state ----------
// Bodies are expanded by default. "全部折叠/全部展开" applies a global
// override; clicking a turn header records a per-turn override that wins
// over the global one until the next global action.
const collapsedAll = ref(false);
const turnOverrides = ref(new Map<number, boolean>());

function isTurnCollapsed(i: number) {
  const override = turnOverrides.value.get(i);
  if (override !== undefined) return override;
  return collapsedAll.value;
}

function toggleTurn(i: number) {
  const next = new Map(turnOverrides.value);
  next.set(i, !isTurnCollapsed(i));
  turnOverrides.value = next;
}

function setAllCollapsed(v: boolean) {
  collapsedAll.value = v;
  turnOverrides.value = new Map();
}

// ---------- identity & rendering helpers ----------
function memberColor(sessionId: string) {
  return collabMemberColor(sessionId);
}

function hexToRgbChannels(color: string): string | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// Per-turn card theming: member color as the left rail, a faint tint of it
// as the card background (stronger on dark themes) so turns are attributable
// at a glance without reading the alias label. The header band uses a
// slightly stronger tint to separate it from the body.
function turnVars(sessionId: string) {
  const channels = hexToRgbChannels(memberColor(sessionId));
  const [bodyA, headerA, headerHoverA] = props.isDark
    ? [0.1, 0.16, 0.22]
    : [0.055, 0.1, 0.16];
  const tint = (a: number) => (channels ? `rgba(${channels}, ${a})` : 'transparent');
  return {
    '--member-color': memberColor(sessionId),
    '--member-bg': tint(bodyA),
    '--member-header-bg': tint(headerA),
    '--member-header-bg-hover': tint(headerHoverA),
  };
}

function aliasOf(sessionId: string) {
  return props.group.members.find((m) => m.session_id === sessionId)?.alias || '未知会话';
}

function shortId(sessionId: string) {
  return sessionId.slice(-8);
}

function toolResultText(part: any) {
  const text = part.result_text ?? part.result ?? part.data ?? '';
  return String(text).trim();
}

// One-line preview shown on a collapsed turn header: the first non-empty
// plain text of the turn, newlines collapsed.
function previewOf(m: CollabMessage) {
  const plain = (m.parts || []).find(
    (p: any) => p.type === 'plain' && String(p.text || '').trim(),
  );
  const text = String((plain && plain.text) || m.text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 100 ? `${text.slice(0, 100)}…` : text;
}

// Same thinking/content grouping as the chat message list, so thinking and
// tool activity render through the shared collapsible ReasoningBlock while
// plain prose renders as regular chat markdown. History records without
// structured parts fall back to a single plain block built from msg.text.
function blocksOf(m: CollabMessage) {
  const parts = m.parts?.length ? m.parts : [{ type: 'plain', text: m.text || '' }];
  return messageBlocks({ type: 'bot', message: parts } as ChatContent);
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
  padding: 14px 18px;
}

/* 每轮一张成员色卡片：左缘色条 + 同色浅底，扫一眼即可区分发言者 */
.collab-turn {
  margin-bottom: 14px;
  max-width: 100%;
  padding: 0 12px 10px;
  font-size: 0.875rem;
  line-height: 1.65;
  border-left: 3px solid var(--member-color);
  border-radius: 4px 8px 8px 4px;
  background: var(--member-bg);
}

/* 标题带：比卡身深一档的成员色底，通到卡片左右边缘 */
.collab-turn-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% + 24px);
  min-width: 0;
  margin: 0 -12px;
  padding: 6px 12px;
  border: 0;
  border-radius: 4px 8px 0 0;
  background: var(--member-header-bg);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  user-select: none;
}

.collab-turn-header:hover {
  background: var(--member-header-bg-hover);
}

.collab-turn-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--member-color);
  flex: none;
}

.collab-turn-alias {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--member-color);
  white-space: nowrap;
}

.collab-turn-sid {
  font-size: 0.6875rem;
  opacity: 0.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  flex: none;
}

/* 折叠时的单行正文预览 */
.collab-turn-preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  opacity: 0.55;
}

.collab-turn-chevron {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.5);
  transition: transform 0.2s ease;
}

.collab-turn-chevron.collapsed {
  transform: rotate(-90deg);
}

.collab-turn-body {
  min-width: 0;
  padding: 4px 2px 0;
}

/* Loose tool results that chat history would have folded into the matching
   tool_call part — rendered as a compact muted line, not a full card. */
.collab-tool-result {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.8125rem;
}

.collab-tool-result span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collab-tool-result .v-icon {
  flex: none;
  opacity: 0.7;
}

/* 流式光标 */
.collab-turn.streaming :deep(.markdown-content)::after {
  content: '▍';
  margin-left: 2px;
  color: rgb(var(--v-theme-primary));
  animation: collab-caret-blink 0.8s steps(1) infinite;
}

@keyframes collab-caret-blink {
  50% {
    opacity: 0;
  }
}
</style>
