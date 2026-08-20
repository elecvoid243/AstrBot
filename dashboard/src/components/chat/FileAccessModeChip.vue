<!--
  FileAccessModeChip — three-segment file access mode switcher
  (full / readonly / workspace). Replaces SpcodePlanModeChip: readonly
  IS plan mode, with the state owned by AstrBot core (per-umo).
-->
<script setup lang="ts">
import { computed } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import {
  useFileAccessMode,
  type FileAccessMode,
} from "@/composables/useFileAccessMode";
import SpSegmentedControl, { type Segment } from "./SpSegmentedControl.vue";

const { tm } = useModuleI18n("features/chat");
const { status } = useFileAccessMode();

const emit = defineEmits<{
  (e: "change", mode: FileAccessMode): void;
}>();

const modeValue = computed<string>(
  () => status.value.mode ?? status.value.defaultMode ?? "full",
);

const segments = computed<Segment[]>(() => [
  {
    value: "full",
    label: tm("fileAccessChip.fullLabel"),
    icon: "mdi-lock-open-outline",
  },
  {
    value: "readonly",
    label: tm("fileAccessChip.readonlyLabel"),
    icon: "mdi-file-eye-outline",
  },
  {
    value: "workspace",
    label: tm("fileAccessChip.workspaceLabel"),
    icon: "mdi-folder-edit-outline",
  },
]);

function onChange(next: string): void {
  if (next === modeValue.value) return;
  emit("change", next as FileAccessMode);
}
</script>

<template>
  <div class="file-access-chip">
    <v-tooltip activator="parent" location="top">
      {{ tm("fileAccessChip.tooltip") }}
    </v-tooltip>
    <SpSegmentedControl
      :segments="segments"
      :model-value="modeValue"
      @change="onChange"
    />
  </div>
</template>

<style scoped>
.file-access-chip {
  display: inline-flex;
  align-items: center;
}
</style>
