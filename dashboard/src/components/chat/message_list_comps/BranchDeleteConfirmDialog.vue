<!--
  Author: elecvoid243 @ 2026-07-21
  Spec: docs/superpowers/specs/2026-07-21-git-branch-switcher-frontend-design.md §3.4.2
  Confirmation dialog for POST /spcode/git-branch-delete. Emits
  'confirm' (with name) on success; 'cancel' on close.
-->
<script setup lang="ts">
import { useModuleI18n } from "@/i18n/composables";

const { tm } = useModuleI18n("features/chat");

const props = defineProps<{
  modelValue: boolean;
  name: string;
  isSubmitting?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "confirm", name: string): void;
  (e: "cancel"): void;
}>();

function onCancel(): void {
  if (props.isSubmitting) return;
  emit("update:modelValue", false);
  emit("cancel");
}
function onSubmit(): void {
  if (props.isSubmitting) return;
  emit("confirm", props.name);
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    persistent
    max-width="420"
  >
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">
        {{
          tm(
            "spcodeProjectLoad.diffSidebar.branchMgmt.delete.confirmTitle",
          )
        }}
      </v-card-title>
      <v-card-text class="pa-4 pl-6">
        <p class="text-body-1 mb-0">
          {{
            tm(
              "spcodeProjectLoad.diffSidebar.branchMgmt.delete.confirmMessage",
              { name: name },
            )
          }}
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="isSubmitting"
          @click="onCancel"
        >
          {{
            tm("spcodeProjectLoad.diffSidebar.branchMgmt.delete.cancel")
          }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="error"
          :loading="isSubmitting"
          :disabled="isSubmitting"
          @click="onSubmit"
        >
          {{
            tm("spcodeProjectLoad.diffSidebar.branchMgmt.delete.submit")
          }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
