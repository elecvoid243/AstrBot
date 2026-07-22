<!-- Author: elecvoid243, 2026-07-22
     Stub for DOCX preview. Real rendering is wired in Task 9 using
     mammoth (.docx -> HTML). The stub exposes a `host` ref so the
     implementation can inject sanitised HTML into a known node. -->
<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  blob: Blob;
}>();

const host = ref<HTMLDivElement | null>(null);
defineExpose({ host });
</script>

<template>
  <div ref="host" class="docx-preview docx-preview--stub">
    <div class="docx-preview__placeholder">DOCX preview placeholder</div>
  </div>
</template>

<style scoped>
.docx-preview {
  padding: 16px;
  background: rgb(var(--v-theme-surface));
  min-height: 120px;
}
.docx-preview--stub {
  display: flex;
  align-items: center;
  justify-content: center;
}
.docx-preview__placeholder {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 12px;
}
</style>
