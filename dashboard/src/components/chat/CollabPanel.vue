<template>
  <div class="collab-panel">
    <div class="d-flex align-center pa-3 pb-1 flex-wrap">
      <span class="text-subtitle-1 mr-2">{{ group.name }}</span>
      <v-chip
        v-for="m in group.members"
        :key="m.session_id"
        size="x-small"
        class="ml-1"
        :color="busySessions.has(m.session_id) ? 'warning' : undefined"
        variant="tonal"
      >
        {{ m.alias }}{{ m.session_id === group.moderator_session_id ? ' · 主持' : '' }}
      </v-chip>
      <span class="text-caption ml-2">{{ hopInfo.count }}/{{ hopInfo.limit }}</span>
      <v-chip
        v-if="status !== 'idle'"
        size="x-small"
        class="ml-2"
        variant="tonal"
        :color="statusColor"
      >
        <v-progress-circular
          v-if="status === 'stopping'"
          indeterminate
          size="12"
          width="2"
          class="mr-1"
        />
        {{ statusLabel }}
      </v-chip>
      <v-spacer />
      <v-btn
        icon="mdi-forum-outline"
        size="x-small"
        variant="text"
        title="查看完整对话记录"
        @click="emit('open-transcript')"
      />
      <v-btn
        icon="mdi-close"
        size="x-small"
        variant="text"
        title="收起协作面板"
        @click="emit('close')"
      />
    </div>
    <div class="px-3 pb-2 d-flex">
      <template v-if="status === 'idle' || status === 'stopped'">
        <v-text-field
          v-model="topic"
          label="讨论主题"
          density="compact"
          hide-details
          class="mr-2"
        />
        <v-btn variant="tonal" :disabled="!topic.trim()" @click="start">
          {{ status === 'stopped' ? '再次发起讨论' : '发起讨论' }}
        </v-btn>
      </template>
      <template v-else>
        <v-btn
          v-if="status === 'running' || status === 'stopping'"
          variant="tonal"
          color="error"
          :loading="status === 'stopping'"
          @click="stop"
        >
          {{ status === 'stopping' ? '停止中…' : '停止' }}
        </v-btn>
        <v-btn v-if="status === 'paused'" variant="tonal" @click="resume()">
          继续
        </v-btn>
      </template>
    </div>
    <div v-if="status === 'paused'" class="px-3 pb-2 d-flex align-center">
      <v-select
        v-model="manualTarget"
        :items="memberItems"
        item-title="title"
        item-value="value"
        density="compact"
        hide-details
        label="人工指定下一站"
        class="mr-2"
        style="max-width: 200px"
      />
      <v-text-field
        v-model="manualMessage"
        density="compact"
        hide-details
        label="转述内容"
        class="mr-2"
      />
      <v-btn variant="tonal" :disabled="!manualTarget" @click="sendManual">发送</v-btn>
    </div>
    <div class="collab-timeline px-3 pb-3">
      <div v-for="(item, i) in timeline" :key="i" class="text-body-2">
        <template v-if="item.type === 'route'">
          → {{ labelOf(item.from as string) }} 转给 {{ labelOf(item.to as string) }}
        </template>
        <template v-else-if="item.type === 'busy'">
          ⏳ {{ labelOf(item.session_id as string) }} 忙碌中，消息已挂起
        </template>
        <template v-else-if="item.type === 'stopped'">
          ■ 讨论结束：{{ item.reason }}
        </template>
        <template v-else-if="item.type === 'route_parse_failed'">
          ⚠ 主持人未输出合法指令，请人工指定下一站
        </template>
        <template v-else-if="item.type === 'hop_limit_reached'">
          ⚠ 已达跳数上限
        </template>
        <template v-else-if="item.type === 'error'">⚠ 错误：{{ item.reason }}</template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAgentCollab, type CollabGroup } from '@/composables/useAgentCollab';

const props = defineProps<{ group: CollabGroup }>();
const emit = defineEmits<{ close: []; 'open-transcript': [] }>();
const { timeline, status, hopInfo, busySessions, startDiscussion, stop, resume, manualRoute } =
  useAgentCollab();

const topic = ref('');
const manualTarget = ref<string | null>(null);
const manualMessage = ref('');

const memberItems = computed(() =>
  props.group.members.map((m) => ({ title: m.alias, value: m.session_id })),
);

const statusLabel = computed(() => {
  switch (status.value) {
    case 'running':
      return '进行中';
    case 'paused':
      return '已暂停';
    case 'stopping':
      return '停止中…';
    case 'stopped':
      return '已停止';
    default:
      return '';
  }
});

const statusColor = computed(() => {
  switch (status.value) {
    case 'running':
      return 'success';
    case 'paused':
      return 'warning';
    case 'stopping':
      return 'warning';
    case 'stopped':
      return 'default';
    default:
      return undefined;
  }
});

// Show "alias · short-id" everywhere: members with default aliases may be
// indistinguishable by alias alone, and a raw full id is unreadable.
function labelOf(sid?: string) {
  if (!sid) return '';
  if (sid === 'user') return '用户';
  const member = props.group.members.find((m) => m.session_id === sid);
  if (member) return `${member.alias} · ${sid.slice(-8)}`;
  return sid;
}

async function start() {
  await startDiscussion(props.group.id, topic.value.trim());
}

async function sendManual() {
  if (manualTarget.value) await manualRoute(manualTarget.value, manualMessage.value);
}
</script>

<style scoped>
.collab-panel {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.collab-timeline {
  max-height: 240px;
  overflow-y: auto;
}
</style>
