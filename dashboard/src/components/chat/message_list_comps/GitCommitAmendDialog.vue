<!-- Author: elecvoid243 @ 2026-08-13
     Spec: astrbot_plugin_spcode_toolkit
       docs/superpowers/specs/2026-08-13-git-commit-amend-frontend-design.md
     Edits the current HEAD commit message via POST /spcode/git-commit-amend.
     Mirrors the v-model + loading + submit pattern of GitSquashDialog. -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";

const { tm } = useModuleI18n("features/chat");

export interface AmendCommitPayload {
  sha: string;
  subject: string;
  body: string | null;
}

const props = defineProps<{
  modelValue: boolean;
  commit: AmendCommitPayload | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "submit", payload: { sha: string; message: string }): void;
}>();

const MAX_MESSAGE = 8192;

const messageInput = ref("");

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    const c = props.commit;
    if (!c) {
      messageInput.value = "";
      return;
    }
    messageInput.value = c.body ? `${c.subject}\n\n${c.body}` : c.subject;
  },
);

const trimmed = computed(() => messageInput.value.trim());
const canSubmit = computed(
  () =>
    trimmed.value.length > 0 &&
    trimmed.value.length <= MAX_MESSAGE &&
    !props.loading,
);
const messageError = computed(() => {
  if (trimmed.value.length === 0) {
    return tm("spcodeProjectLoad.diffSidebar.amend.messageRequired");
  }
  if (trimmed.value.length > MAX_MESSAGE) {
    return tm("spcodeProjectLoad.diffSidebar.amend.error.invalid_message");
  }
  return null;
});

function onSubmit(): void {
  if (!canSubmit.value || !props.commit) return;
  emit("submit", { sha: props.commit.sha, message: trimmed.value });
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    persistent
    max-width="560"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">
        {{ tm("spcodeProjectLoad.diffSidebar.amend.editTitle") }}
      </v-card-title>
      <v-card-text class="pt-4">
        <v-textarea
          v-model="messageInput"
          :label="tm('spcodeProjectLoad.diffSidebar.amend.messageLabel')"
          :error-messages="messageError ? [messageError] : []"
          density="compact"
          variant="outlined"
          rows="5"
          auto-grow
          autocomplete="off"
          hide-details="auto"
        />
        <div class="git-commit-amend-warning mt-3">
          {{ tm("spcodeProjectLoad.diffSidebar.amend.historyRewriteWarning") }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="loading"
          @click="emit('update:modelValue', false)"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.amend.cancel") }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :loading="loading"
          :disabled="!canSubmit"
          @click="onSubmit"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.amend.submit") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.git-commit-amend-warning {
  color: rgb(var(--v-theme-warning));
  font-size: 12px;
}
</style>
