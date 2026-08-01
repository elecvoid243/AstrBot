<!-- Author: elecvoid243 @ 2026-08-01
     Spec: docs/superpowers/specs/2026-08-01-git-merge-cherrypick-conflict-frontend-design.md §4.2
     Cherry-pick dialog. Two modes: preset (from a log row — ref readonly)
     and blank (toolbar — editable ref). -->
<template>
  <v-dialog
    :model-value="modelValue"
    persistent
    max-width="480"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">
        {{ tm("spcodeProjectLoad.diffSidebar.cherryPick.dialogTitle") }}
      </v-card-title>
      <v-card-text class="pt-4">
        <v-text-field
          v-model="refInput"
          :label="tm('spcodeProjectLoad.diffSidebar.cherryPick.refLabel')"
          :hint="tm('spcodeProjectLoad.diffSidebar.cherryPick.refHint')"
          :readonly="preset !== null"
          :error-messages="refError ? [refError] : []"
          density="compact"
          variant="outlined"
          autocomplete="off"
          name="cherry-pick-ref"
        />
        <v-text-field
          v-model="mainlineInput"
          :label="tm('spcodeProjectLoad.diffSidebar.cherryPick.mainlineLabel')"
          :hint="tm('spcodeProjectLoad.diffSidebar.cherryPick.mainlineHint')"
          :error-messages="mainlineError ? [mainlineError] : []"
          density="compact"
          variant="outlined"
          class="mt-2"
          autocomplete="off"
          name="cherry-pick-mainline"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="loading"
          @click="emit('update:modelValue', false)"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.cherryPick.cancel") }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :loading="loading"
          @click="onSubmit"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.cherryPick.submit") }}
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
  preset: { sha: string; subject: string } | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "submit", p: { ref: string; mainline: number | null }): void;
}>();

const { tm } = useModuleI18n("features/chat");

const refInput = ref("");
const mainlineInput = ref("");
const refError = ref("");
const mainlineError = ref("");

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      refInput.value = props.preset?.sha ?? "";
      mainlineInput.value = "";
      refError.value = "";
      mainlineError.value = "";
    }
  },
);

function onSubmit(): void {
  refError.value = "";
  mainlineError.value = "";
  const refValue = refInput.value.trim();
  if (!refValue) {
    refError.value = tm("spcodeProjectLoad.diffSidebar.cherryPick.refRequired");
    return;
  }
  let mainline: number | null = null;
  const raw = mainlineInput.value.trim();
  if (raw) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      mainlineError.value = tm(
        "spcodeProjectLoad.diffSidebar.cherryPick.mainlineInvalid",
      );
      return;
    }
    mainline = n;
  }
  emit("submit", { ref: refValue, mainline });
}
</script>
