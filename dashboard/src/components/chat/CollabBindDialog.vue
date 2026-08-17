<template>
  <v-dialog v-model="dialog" max-width="640">
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">绑定协作会话</v-card-title>
      <v-card-text>
        <v-text-field v-model="name" label="分组名称" density="compact" class="mb-2" />
        <div v-for="(m, i) in members" :key="m.session_id" class="d-flex align-center mb-2">
          <span class="text-body-2 flex-grow-1 text-truncate">{{ displayOf(m.session_id) }}</span>
          <v-text-field
            v-model="m.alias"
            label="别名"
            density="compact"
            hide-details
            style="max-width: 180px"
            class="mr-2"
          />
          <v-btn
            size="small"
            :variant="moderator === m.session_id ? 'tonal' : 'text'"
            :title="moderator === m.session_id ? '主持人' : '设为主持人'"
            @click="moderator = m.session_id"
          >
            <v-icon size="small" class="mr-1">mdi-crown-outline</v-icon>
            主持
          </v-btn>
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            @click="removeMember(i)"
          />
        </div>
        <v-select
          v-model="picked"
          :items="availableSessions"
          item-title="title"
          item-value="value"
          label="添加会话"
          density="compact"
          @update:model-value="addMember"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog = false">取消</v-btn>
        <v-btn
          variant="tonal"
          :disabled="!canSave"
          :loading="saving"
          @click="save"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { agentCollabApi } from '@/api/v1';

const props = defineProps<{
  sessions: Array<{ session_id: string; display_name: string | null }>;
}>();
const emit = defineEmits<{ saved: [] }>();

const dialog = defineModel<boolean>({ default: false });
const name = ref('');
const members = ref<Array<{ session_id: string; alias: string }>>([]);
const moderator = ref<string | null>(null);
const picked = ref<string | null>(null);
const saving = ref(false);

const availableSessions = computed(() =>
  props.sessions
    .filter((s) => !members.value.some((m) => m.session_id === s.session_id))
    .map((s) => ({ title: s.display_name || s.session_id, value: s.session_id })),
);

const canSave = computed(
  () => members.value.length >= 2 && !!moderator.value && !!name.value.trim(),
);

function displayOf(sid: string) {
  return props.sessions.find((s) => s.session_id === sid)?.display_name || sid;
}

function addMember(sid: string | null) {
  if (!sid) return;
  members.value.push({ session_id: sid, alias: sid.slice(-8) });
  if (!moderator.value) moderator.value = sid;
  picked.value = null;
}

function removeMember(index: number) {
  const [removed] = members.value.splice(index, 1);
  if (removed && moderator.value === removed.session_id) {
    moderator.value = members.value[0]?.session_id ?? null;
  }
}

async function save() {
  saving.value = true;
  try {
    await agentCollabApi.createGroup({
      name: name.value.trim(),
      members: members.value,
      moderator_session_id: moderator.value!,
    });
    dialog.value = false;
    emit('saved');
  } finally {
    saving.value = false;
  }
}

watch(dialog, (open) => {
  if (open) {
    name.value = '';
    members.value = [];
    moderator.value = null;
    picked.value = null;
  }
});
</script>
