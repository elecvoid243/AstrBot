<!-- Author: elecvoid243, 2026-07-30
     Inline ask editor for the "Ask Inline" feature.
     Similar to FileCommentEditor but with a placeholder that
     disappears on focus, and mutually exclusive with the comment
     editor (the parent controls visibility). -->
<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { useModuleI18n } from "@/i18n/composables";

const props = defineProps<{
  /** 1-based start line of the selection. */
  startLine: number;
  /** 1-based end line of the selection. */
  endLine: number;
  /** Verbatim selected text. */
  selection: string;
  /** File path for display. */
  filePath: string;
}>();

interface SubmitPayload {
  question: string;
  startLine: number;
  endLine: number;
  selection: string;
}

const emit = defineEmits<{
  (e: "submit", payload: SubmitPayload): void;
  (e: "cancel"): void;
}>();

const { tm } = useModuleI18n("features/chat");

const PLACEHOLDER_TEXT = "解释划线部分内容";
const text = ref<string>(PLACEHOLDER_TEXT);
const isPlaceholder = ref(true);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

watch(
  () => [props.startLine, props.endLine] as const,
  () => {
    text.value = PLACEHOLDER_TEXT;
    isPlaceholder.value = true;
    nextTick(() => textareaRef.value?.focus());
  },
  { immediate: true },
);

function onFocus(): void {
  if (isPlaceholder.value) {
    text.value = "";
    isPlaceholder.value = false;
  }
}

function onBlur(): void {
  if (!text.value.trim()) {
    text.value = PLACEHOLDER_TEXT;
    isPlaceholder.value = true;
  }
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    emit("cancel");
  } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    onSubmit();
  }
}

function onSubmit(): void {
  const q = isPlaceholder.value ? PLACEHOLDER_TEXT : text.value.trim();
  if (!q) return;
  emit("submit", {
    question: q,
    startLine: props.startLine,
    endLine: props.endLine,
    selection: props.selection,
  });
}
</script>

<template>
  <div class="inline-ask-editor" @keydown="handleKeyDown">
    <div class="inline-ask-editor-header">
      <v-icon size="14">mdi-lightbulb-on-outline</v-icon>
      <span class="editor-title">
        {{ tm("spcodeProjectLoad.fileBrowser.inlineAsk.title") }}
      </span>
      <span class="editor-range-label">
        {{
          tm("spcodeProjectLoad.fileBrowser.comment.rangeLabel", {
            start: startLine,
            end: endLine,
          })
        }}
      </span>
    </div>
    <pre class="inline-ask-editor-selection">{{ selection }}</pre>
    <textarea
      ref="textareaRef"
      v-model="text"
      class="inline-ask-editor-input"
      :class="{ 'is-placeholder': isPlaceholder }"
      rows="2"
      @focus="onFocus"
      @blur="onBlur"
    />
    <div class="inline-ask-editor-actions">
      <v-spacer />
      <v-btn size="small" variant="text" @click="emit('cancel')">
        {{ tm("spcodeProjectLoad.fileBrowser.comment.cancel") }}
      </v-btn>
      <v-btn
        size="small"
        color="primary"
        variant="flat"
        :disabled="!text.trim()"
        @click="onSubmit"
      >
        {{ tm("spcodeProjectLoad.fileBrowser.inlineAsk.submit") }}
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.inline-ask-editor {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  padding: 10px 14px;
  background: rgba(var(--v-theme-surface), 0.6);
  flex-shrink: 0;
}
.inline-ask-editor-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
}
.editor-title {
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.editor-range-label {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
}
.inline-ask-editor-selection {
  max-height: 120px;
  overflow: auto;
  margin: 0 0 8px 0;
  padding: 6px 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 4px;
  background: rgba(var(--v-theme-primary), 0.04);
  font-family: ui-monospace, monospace;
  font-size: 11.5px;
  white-space: pre;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.inline-ask-editor-input {
  width: 100%;
  resize: vertical;
  font-family: inherit;
  font-size: 13px;
  padding: 8px;
  border-radius: 4px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  box-sizing: border-box;
}
.inline-ask-editor-input.is-placeholder {
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-style: italic;
}
.inline-ask-editor-input:focus {
  outline: none;
  border-color: rgb(var(--v-theme-primary));
}
.inline-ask-editor-actions {
  display: flex;
  align-items: center;
  margin-top: 8px;
  gap: 4px;
}
</style>
