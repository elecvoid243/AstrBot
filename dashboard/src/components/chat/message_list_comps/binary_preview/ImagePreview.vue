<!-- Author: elecvoid243, 2026-07-31
     Spec: docs/superpowers/specs/2026-07-31-workspace-image-preview-design.md §4.3
     Renders an image Blob via an object URL. Fit-to-width by default,
     centered, vertically scrollable for tall images; a checkerboard
     backdrop keeps transparent PNG/SVG readable on dark themes. -->
<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  blob: Blob;
  filename: string;
}>();

const objectUrl = ref("");
const resolution = ref<{ width: number; height: number } | null>(null);
const loadFailed = ref(false);

// The watcher cleanup revokes the previous URL on blob change AND on
// component unmount (Vue runs effect cleanups on scope disposal), so
// no separate onBeforeUnmount hook is needed.
watch(
  () => props.blob,
  (blob, _old, onCleanup) => {
    loadFailed.value = false;
    resolution.value = null;
    const url = URL.createObjectURL(blob);
    objectUrl.value = url;
    onCleanup(() => URL.revokeObjectURL(url));
  },
  { immediate: true },
);

function onImgLoad(e: Event): void {
  const img = e.target as HTMLImageElement;
  resolution.value = { width: img.naturalWidth, height: img.naturalHeight };
}

function onImgError(): void {
  loadFailed.value = true;
}
</script>

<template>
  <div class="image-preview">
    <div v-if="loadFailed" class="image-preview__error">
      <v-icon icon="mdi-image-off-outline" size="32" />
    </div>
    <template v-else>
      <div class="image-preview__canvas">
        <img
          :src="objectUrl"
          :alt="filename"
          class="image-preview__img"
          @load="onImgLoad"
          @error="onImgError"
        />
      </div>
      <div v-if="resolution" class="image-preview__caption">
        {{ resolution.width }} × {{ resolution.height }}
      </div>
    </template>
  </div>
</template>

<style scoped>
.image-preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.image-preview__canvas {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 16px;
}

.image-preview__img {
  max-width: 100%;
  height: auto;
  display: block;
  /* Checkerboard backdrop so transparent PNG/SVG stays readable on
     both light and dark themes (pure CSS, no asset needed). */
  background-image:
    linear-gradient(45deg, rgba(128, 128, 128, 0.25) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(128, 128, 128, 0.25) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(128, 128, 128, 0.25) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(128, 128, 128, 0.25) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}

.image-preview__caption {
  padding: 4px 12px;
  text-align: center;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-variant-numeric: tabular-nums;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.image-preview__error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(var(--v-theme-error));
}
</style>
