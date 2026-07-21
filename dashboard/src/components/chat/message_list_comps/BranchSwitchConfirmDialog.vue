<!--
  Author: elecvoid243 @ 2026-07-21
  Spec: docs/superpowers/specs/2026-07-21-git-branch-switcher-frontend-design.md §3.4.1
  Confirmation dialog for POST /spcode/git-branch-switch. Emits
  'confirm' (with name) on success; 'cancel' on close.
-->
<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useModuleI18n } from "@/i18n/composables";

const { tm } = useModuleI18n("features/chat");

const props = defineProps<{
  modelValue: boolean;
  from: string | null; // current branch name, null = detached
  to: string; // target branch name
  dirtyCount: number; // 0 = clean
  isSubmitting?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "confirm", name: string): void;
  (e: "cancel"): void;
}>();

// Reset submit-error whenever the dialog is re-opened.
const submitError = ref<string | null>(null);
watch(
  () => props.modelValue,
  (open, prev) => {
    if (open && !prev) submitError.value = null;
  },
);

const fromLabel = computed(() =>
  props.from ?? tm("spcodeProjectLoad.diffSidebar.branchMgmt.detached"),
);

const dirtyText = computed(() =>
  props.dirtyCount > 0
    ? tm(
        "spcodeProjectLoad.diffSidebar.branchMgmt.switch.dirtyBlocked",
        { count: props.dirtyCount },
      )
    : "",
);

const canSubmit = computed(
  () => props.dirtyCount === 0 && !props.isSubmitting,
);

function onCancel(): void {
  if (props.isSubmitting) return;
  emit("update:modelValue", false);
  emit("cancel");
}
function onSubmit(): void {
  if (!canSubmit.value) return;
  emit("confirm", props.to);
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    persistent
    max-width="480"
  >
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">
        {{
          tm(
            "spcodeProjectLoad.diffSidebar.branchMgmt.switch.confirmTitle",
          )
        }}
      </v-card-title>
      <v-card-text class="pa-4 pl-6">
        <p class="text-body-1 mb-2">
          {{
            tm(
              "spcodeProjectLoad.diffSidebar.branchMgmt.switch.confirmMessage",
              { from: fromLabel, to: to },
            )
          }}
        </p>
        <v-alert
          v-if="dirtyCount > 0"
          type="warning"
          density="compact"
          variant="tonal"
          class="mb-0"
        >
          {{ dirtyText }}
        </v-alert>
        <v-alert
          v-if="submitError"
          type="error"
          density="compact"
          variant="tonal"
          class="mt-3 mb-0"
        >
          {{ submitError }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="isSubmitting"
          @click="onCancel"
        >
          {{
            tm("spcodeProjectLoad.diffSidebar.branchMgmt.switch.cancel")
          }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :loading="isSubmitting"
          :disabled="!canSubmit"
          @click="onSubmit"
        >
          {{
            tm("spcodeProjectLoad.diffSidebar.branchMgmt.switch.submit")
          }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
