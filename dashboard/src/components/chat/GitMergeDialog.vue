<!-- Author: elecvoid243 @ 2026-08-01
     Spec: docs/superpowers/specs/2026-08-01-git-merge-cherrypick-conflict-frontend-design.md §4.1
     Merge options dialog. Dumb component: collects strategy + message and
     emits submit; the parent (GitDiffSidebar) owns the mutation. -->
<template>
  <v-dialog
    :model-value="modelValue"
    persistent
    max-width="480"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">
        {{ tm("spcodeProjectLoad.diffSidebar.merge.dialogTitle") }}
      </v-card-title>
      <v-card-text class="pt-4">
        <v-text-field
          :model-value="source"
          :label="tm('spcodeProjectLoad.diffSidebar.merge.sourceLabel')"
          readonly
          density="compact"
          variant="outlined"
        />
        <v-radio-group
          v-model="strategy"
          :label="tm('spcodeProjectLoad.diffSidebar.merge.strategy.label')"
          density="compact"
          hide-details
        >
          <v-radio
            value="default"
            :label="tm('spcodeProjectLoad.diffSidebar.merge.strategy.default')"
          />
          <v-radio
            value="noFf"
            :label="tm('spcodeProjectLoad.diffSidebar.merge.strategy.noFf')"
          />
          <v-radio
            value="ffOnly"
            :label="tm('spcodeProjectLoad.diffSidebar.merge.strategy.ffOnly')"
          />
          <v-radio
            value="squash"
            :label="tm('spcodeProjectLoad.diffSidebar.merge.strategy.squash')"
          />
        </v-radio-group>
        <v-textarea
          v-model="message"
          :label="tm('spcodeProjectLoad.diffSidebar.merge.messageLabel')"
          :disabled="strategy === 'ffOnly'"
          :hint="
            strategy === 'ffOnly'
              ? tm('spcodeProjectLoad.diffSidebar.merge.messageDisabledHint')
              : ''
          "
          rows="2"
          auto-grow
          density="compact"
          variant="outlined"
          class="mt-3"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="loading"
          @click="emit('update:modelValue', false)"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.merge.cancel") }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :loading="loading"
          @click="onSubmit"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.merge.submit") }}
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
  source: string;
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (
    e: "submit",
    p: {
      source: string;
      noFf: boolean;
      ffOnly: boolean;
      squash: boolean;
      message: string;
    },
  ): void;
}>();

const { tm } = useModuleI18n("features/chat");

type Strategy = "default" | "noFf" | "ffOnly" | "squash";
const strategy = ref<Strategy>("default");
const message = ref("");

// Reset the form every time the dialog opens.
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      strategy.value = "default";
      message.value = "";
    }
  },
);

function onSubmit(): void {
  emit("submit", {
    source: props.source,
    noFf: strategy.value === "noFf",
    ffOnly: strategy.value === "ffOnly",
    squash: strategy.value === "squash",
    message: message.value.trim(),
  });
}
</script>
