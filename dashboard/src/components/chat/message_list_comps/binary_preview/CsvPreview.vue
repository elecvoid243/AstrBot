<!-- Author: elecvoid243, 2026-07-22
     Stub for CSV preview. Real rendering is wired in Task 11 using
     papaparse. The stub exposes a `host` ref so the implementation
     can mount the parsed table into a known node. -->
<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  blob: Blob;
}>();

const host = ref<HTMLDivElement | null>(null);
defineExpose({ host });
</script>

<template>
  <div ref="host" class="csv-preview csv-preview--stub">
    <div class="csv-preview__placeholder">CSV preview placeholder</div>
  </div>
</template>

<style scoped>
.csv-preview {
  padding: 16px;
  background: rgb(var(--v-theme-surface));
  min-height: 120px;
}
.csv-preview--stub {
  display: flex;
  align-items: center;
  justify-content: center;
}
.csv-preview__placeholder {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 12px;
}
</style>
