<!-- Author: elecvoid243, 2026-07-22
     Stub for XLSX preview. Real rendering is wired in Task 10 using
     xlsx (SheetJS). The stub exposes a `host` ref so the
     implementation can mount a sheet selector + table into a known
     node. -->
<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  blob: Blob;
}>();

const host = ref<HTMLDivElement | null>(null);
defineExpose({ host });
</script>

<template>
  <div ref="host" class="xlsx-preview xlsx-preview--stub">
    <div class="xlsx-preview__placeholder">XLSX preview placeholder</div>
  </div>
</template>

<style scoped>
.xlsx-preview {
  padding: 16px;
  background: rgb(var(--v-theme-surface));
  min-height: 120px;
}
.xlsx-preview--stub {
  display: flex;
  align-items: center;
  justify-content: center;
}
.xlsx-preview__placeholder {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 12px;
}
</style>
