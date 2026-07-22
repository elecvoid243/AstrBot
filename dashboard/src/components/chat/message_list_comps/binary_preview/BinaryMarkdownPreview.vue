<!-- Author: elecvoid243, 2026-07-22
     Renders an inline markdown blob (the same .md body served by
     /spcode/file-binary). Decoding is async; while decoding the
     component shows the standard loading placeholder. On decode
     failure the error placeholder is shown instead — markdown is
     plain text but a corrupted payload can still blow up the
     TextDecoder.

     Reusing a fresh DOMPurify-style safety check is left to the
     caller: this is the same content type already served by
     /spcode/git-show with markdown rendering for source `.md`
     files, so we just feed the decoded text to the existing
     MarkdownView component. -->
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import MarkdownView from "@/components/shared/MarkdownView.vue";
import { useModuleI18n } from "@/i18n/composables";

const props = defineProps<{
  blob: Blob;
  isDark?: boolean;
}>();

const { tm } = useModuleI18n("features/chat");

const source = ref<string>("");
const error = ref<string | null>(null);
const loading = ref<boolean>(true);

let lastToken = 0;

async function load() {
  const token = ++lastToken;
  loading.value = true;
  error.value = null;
  source.value = "";
  try {
    const text = await props.blob.text();
    if (token !== lastToken) return; // stale
    source.value = text;
  } catch (e) {
    if (token !== lastToken) return;
    error.value = (e as Error)?.message ?? "decode_failed";
  } finally {
    if (token === lastToken) loading.value = false;
  }
}

watch(() => props.blob, () => void load(), { immediate: true });
onBeforeUnmount(() => {
  lastToken++;
});
</script>

<template>
  <div class="md-preview">
    <div v-if="loading" class="md-preview__placeholder">
      <v-progress-circular indeterminate size="20" />
      <span>{{ tm("spcodeProjectLoad.documentManager.raw.loading") }}</span>
    </div>
    <div v-else-if="error" class="md-preview__placeholder md-preview__placeholder--error">
      <v-icon icon="mdi-alert-circle-outline" />
      <span>{{ tm("spcodeProjectLoad.documentManager.binary.errors.decode_failed") }}</span>
    </div>
    <MarkdownView v-else :source="source" :is-dark="!!props.isDark" />
  </div>
</template>

<style scoped>
.md-preview {
  display: flex;
  flex-direction: column;
  min-height: 120px;
  background: rgb(var(--v-theme-surface));
}
.md-preview__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px;
}
.md-preview__placeholder--error {
  color: rgb(var(--v-theme-error));
}
</style>
