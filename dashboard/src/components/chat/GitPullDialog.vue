<!-- Author: elecvoid243 @ 2026-08-12
     API doc: astrbot_plugin_spcode_toolkit docs/api/webapi-git-pull-push-remote-api.md §2
     Pull options dialog. Dumb component: collects the integration mode
     and emits submit; the parent (GitDiffSidebar) owns the mutation.
     Mirrors GitMergeDialog. -->
<template>
  <v-dialog
    :model-value="modelValue"
    persistent
    max-width="480"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">
        {{ tm("spcodeProjectLoad.diffSidebar.pull.dialogTitle") }}
      </v-card-title>
      <v-card-text class="pt-4">
        <v-radio-group
          v-model="mode"
          :label="tm('spcodeProjectLoad.diffSidebar.pull.mode.label')"
          density="compact"
          hide-details
        >
          <v-radio
            value="merge"
            :label="tm('spcodeProjectLoad.diffSidebar.pull.mode.merge')"
          />
          <v-radio
            value="ffOnly"
            :label="tm('spcodeProjectLoad.diffSidebar.pull.mode.ffOnly')"
          />
          <v-radio
            value="rebase"
            :label="tm('spcodeProjectLoad.diffSidebar.pull.mode.rebase')"
          />
        </v-radio-group>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="loading"
          @click="emit('update:modelValue', false)"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.pull.cancel") }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :loading="loading"
          @click="onSubmit"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.pull.submit") }}
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
  (e: "submit", p: { ffOnly: boolean; rebase: boolean }): void;
}>();

const { tm } = useModuleI18n("features/chat");

type Mode = "merge" | "ffOnly" | "rebase";
const mode = ref<Mode>("merge");

// Reset the form every time the dialog opens.
watch(
  () => props.modelValue,
  (open) => {
    if (open) mode.value = "merge";
  },
);

function onSubmit(): void {
  emit("submit", {
    ffOnly: mode.value === "ffOnly",
    rebase: mode.value === "rebase",
  });
}
</script>
