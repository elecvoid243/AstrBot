<!-- Author: elecvoid243 @ 2026-08-12
     API doc: astrbot_plugin_spcode_toolkit docs/api/webapi-git-pull-push-remote-api.md §4
     Remote URL dialog (upsert: add when missing, set-url when present).
     Dumb component: collects remote name + URL and emits submit; the
     parent (GitDiffSidebar) owns the mutation. -->
<template>
  <v-dialog
    :model-value="modelValue"
    persistent
    max-width="480"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">
        {{ tm("spcodeProjectLoad.diffSidebar.remote.dialogTitle") }}
      </v-card-title>
      <v-card-text class="pt-4">
        <v-text-field
          v-model="remote"
          :label="tm('spcodeProjectLoad.diffSidebar.remote.remoteLabel')"
          density="compact"
          variant="outlined"
          autocomplete="off"
          name="git-remote-name"
        />
        <v-text-field
          v-model="url"
          :label="tm('spcodeProjectLoad.diffSidebar.remote.urlLabel')"
          :error-messages="urlError ? [urlError] : []"
          density="compact"
          variant="outlined"
          class="mt-1"
          autocomplete="off"
          name="git-remote-url"
          @keyup.enter="onSubmit"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="loading"
          @click="emit('update:modelValue', false)"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.remote.cancel") }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :loading="loading"
          @click="onSubmit"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.remote.submit") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";

const props = defineProps<{
  modelValue: boolean;
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "submit", p: { remote: string; url: string }): void;
}>();

const { tm } = useModuleI18n("features/chat");

const remote = ref("origin");
const url = ref("");
const urlError = ref("");

// Reset the form every time the dialog opens.
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      remote.value = "origin";
      url.value = "";
      urlError.value = "";
    }
  },
);

function onSubmit(): void {
  const trimmed = url.value.trim();
  if (!trimmed) {
    urlError.value = tm("spcodeProjectLoad.diffSidebar.remote.urlRequired");
    return;
  }
  urlError.value = "";
  emit("submit", { remote: remote.value.trim() || "origin", url: trimmed });
}
</script>
