<!-- Author: elecvoid243, 2026-07-22
     Stub for PDF preview. Rendered only after BinaryPreview confirms
     the kind is `pdf`. Real rendering is wired in Task 8 using
     pdfjs-dist. The stub keeps an HTML element with a stable id so
     pdfjs.render() can mount into a known target after a Blob URL
     rewrite. -->
<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  blob: Blob;
}>();

const container = ref<HTMLDivElement | null>(null);
defineExpose({ container });
</script>

<template>
  <div ref="container" class="pdf-preview pdf-preview--stub">
    <div class="pdf-preview__placeholder">PDF preview placeholder</div>
  </div>
</template>

<style scoped>
.pdf-preview {
  width: 100%;
  height: 100%;
  min-height: 240px;
  overflow: auto;
  background: rgb(var(--v-theme-surface));
}
.pdf-preview--stub {
  display: flex;
  align-items: center;
  justify-content: center;
}
.pdf-preview__placeholder {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 12px;
}
</style>
