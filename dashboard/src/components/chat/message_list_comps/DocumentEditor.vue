<!-- Author: elecvoid243, 2026-07-12
     Spec: docs/superpowers/specs/2026-07-11-document-manager-design.md §4.6
     Edit area + action bar (save / cancel / copy / delete / rename).
     Owns the edit buffer, dirty tracking. Rename is real and uses
     the PATCH /spcode/docs endpoint.
     2026-07-18: edit body swapped from the markdown-only
     CodemirrorHost to the shared CodeMirrorEditor (markdown syntax
     highlighting, dark-aware theme, internal textarea fallback). -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import { copyToClipboard } from "@/utils/clipboard";
import CodeMirrorEditor from "./CodeMirrorEditor.vue";

const props = defineProps<{
  initialContent: string;
  fileRelative: string;
  isSaving: boolean;
  isDeleting: boolean;
  isRenaming: boolean;
  // Rename failure reason from the parent (set after the PATCH
  // request settles). Used to keep the rename input open so the
  // user can see what went wrong. Cleared when the user opens a
  // new rename dialog or the request succeeds.
  renameErrorMessage: string | null;
  // 2026-07-26 save-success-toast: parent (DocumentManager) flips
  // this to a localized "Saved" string after the docsApi.save
  // request resolves with r.ok. The parent also owns the
  // auto-dismiss timer (cleared after ~2.5s) so the toast
  // disappears even if the user starts typing again — keeps the
  // editor's surface area small. Cleared to null on doc/file
  // switch so the message never bleeds across files.
  saveSuccessMessage: string | null;
  simpleTextarea?: boolean;
}>();
const emit = defineEmits<{
  (e: "save", content: string): void;
  (e: "cancel"): void;
  (e: "delete"): void;
  (e: "rename", newPath: string): void;
  (e: "rename-cancel"): void;
}>();
const { tm } = useModuleI18n("features/chat");

const buffer = ref(props.initialContent);
const showDeleteConfirm = ref(false);
const renameOpen = ref(false);
const renameDraft = ref(props.fileRelative);
const renameError = ref<string | null>(null);
const useTextarea = ref(!!props.simpleTextarea);

const isDirty = computed(() => buffer.value !== props.initialContent);

watch(
  () => props.initialContent,
  (v) => {
    buffer.value = v;
  },
);

function onCancel() {
  if (isDirty.value) {
    const ok = window.confirm(
      tm("spcodeProjectLoad.documentManager.editor.cancelDirty"),
    );
    if (!ok) return;
  }
  emit("cancel");
}

function onSave() {
  if (!isDirty.value || props.isSaving) return;
  emit("save", buffer.value);
}

// 2026-07-26 keyboard shortcut: Ctrl/Cmd+S triggers save (matches
// the browser-native editor contract). preventDefault() suppresses
// the browser's "save webpage" dialog; stopPropagation stops the
// capture-phase listeners in DocumentManager / FileBrowserView from
// also handling the same chord. The isDirty / isSaving guard inside
// onSave keeps repeated presses no-ops (save button stays disabled
// after a successful save).
function onKeyDown(e: KeyboardEvent): void {
  const isMod = e.metaKey || e.ctrlKey;
  if (isMod && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    e.stopPropagation();
    onSave();
  }
}
onMounted(() => document.addEventListener("keydown", onKeyDown, true));
onBeforeUnmount(() => document.removeEventListener("keydown", onKeyDown, true));

function onCopyRaw() {
  void copyToClipboard(buffer.value);
}

function onDeleteClick() {
  // 2026-07-18 toolbar parity: deleting the on-disk file also drops
  // the dirty buffer — guard with the same confirm as cancel.
  if (isDirty.value) {
    const ok = window.confirm(
      tm("spcodeProjectLoad.documentManager.editor.cancelDirty"),
    );
    if (!ok) return;
  }
  showDeleteConfirm.value = true;
}
function onDeleteConfirm() {
  showDeleteConfirm.value = false;
  emit("delete");
}

function onRenameOpen() {
  // 2026-07-18 toolbar parity: a successful rename swaps the file
  // under the editor, so a dirty buffer would be lost — confirm first.
  if (isDirty.value) {
    const ok = window.confirm(
      tm("spcodeProjectLoad.documentManager.editor.cancelDirty"),
    );
    if (!ok) return;
  }
  renameDraft.value = props.fileRelative;
  renameError.value = null;
  renameOpen.value = true;
}
function onRenameCancel() {
  renameOpen.value = false;
  renameError.value = null;
}
function onRenameSubmit() {
  const trimmed = renameDraft.value.trim();
  if (!trimmed || trimmed === props.fileRelative) {
    renameOpen.value = false;
    return;
  }
  if (!/^[\w\-./ ]+\.md$/i.test(trimmed)) {
    renameError.value = tm(
      "spcodeProjectLoad.documentManager.editor.filenameInvalid",
    );
    return;
  }
  // Do NOT close the dialog here — the request is async and we
  // want the user to see the failure reason (server error,
  // path_unsafe, file_exists, ...) if it does. The watcher
  // below closes the dialog on the success branch only.
  renameError.value = null;
  emit("rename", trimmed);
}

// Close the rename dialog AFTER the request resolves, but only
// on success. On failure we keep it open so the user sees the
// reason supplied by the parent. `isRenaming` is true while the
// PATCH is in flight; the dialog stays open the whole time so the
// user gets visual feedback (button shows "重命名中" via the
// outer bar's `:disabled="isRenaming"`).
watch(
  [() => props.isRenaming, () => props.renameErrorMessage],
  ([renaming, parentErr]) => {
    if (renaming) return;
    if (!renameOpen.value) return;
    if (parentErr) {
      // Mirror the parent's reason into our local field so the
      // existing error slot below the input can render it.
      renameError.value = parentErr;
      return;
    }
    renameOpen.value = false;
  },
);

function onCodemirrorUpdate(v: string) {
  buffer.value = v;
}
</script>

<template>
  <div class="document-editor">
    <CodeMirrorEditor
      v-if="!useTextarea"
      :model-value="buffer"
      :file-path="fileRelative"
      class="document-editor__cm"
      @update:model-value="onCodemirrorUpdate"
    />
    <textarea
      v-else
      v-model="buffer"
      class="document-editor__textarea"
      spellcheck="false"
    />
    <div class="editor-bar">
      <button
        type="button"
        class="editor-bar__btn editor-bar__btn--primary"
        :title="tm('spcodeProjectLoad.documentManager.editor.saveHint')"
        :disabled="!isDirty || isSaving"
        @click="onSave"
      >
        <v-icon size="14">mdi-content-save-outline</v-icon>
        {{
          isSaving
            ? tm("spcodeProjectLoad.documentManager.editor.saving")
            : tm("spcodeProjectLoad.documentManager.editor.save")
        }}
      </button>
      <button type="button" class="editor-bar__btn" @click="onCancel">
        <v-icon size="14">mdi-close</v-icon>
        {{ tm("spcodeProjectLoad.documentManager.editor.cancel") }}
      </button>
      <button
        type="button"
        class="editor-bar__btn"
        :title="tm('spcodeProjectLoad.documentManager.editor.rename')"
        :disabled="isRenaming"
        @click="onRenameOpen"
      >
        <v-icon size="14">mdi-rename-outline</v-icon>
        {{ tm("spcodeProjectLoad.documentManager.editor.rename") }}
      </button>
      <button type="button" class="editor-bar__btn" @click="onCopyRaw">
        <v-icon size="14">mdi-content-copy</v-icon>
      </button>
      <!-- 2026-07-26 save-success-toast: green inline confirmation
           that lives in the dead space between the copy button and
           the right-aligned delete. Fades in when the parent sets
           saveSuccessMessage (post-save ack) and back out when the
           parent clears it (after the auto-dismiss timer). -->
      <Transition name="document-editor__success-fade">
        <span
          v-if="saveSuccessMessage"
          class="document-editor__save-success"
          role="status"
          aria-live="polite"
        >
          <v-icon size="14" color="success">mdi-check-circle-outline</v-icon>
          {{ saveSuccessMessage }}
        </span>
      </Transition>
      <span class="editor-bar__spacer" />
      <button
        v-if="!showDeleteConfirm"
        type="button"
        class="editor-bar__btn editor-bar__btn--danger"
        :disabled="isDeleting"
        @click="onDeleteClick"
      >
        <v-icon size="14">mdi-delete-outline</v-icon>
        {{ tm("spcodeProjectLoad.documentManager.editor.delete") }}
      </button>
      <span v-else class="document-editor__confirm">
        {{
          tm("spcodeProjectLoad.documentManager.editor.deleteConfirmBody", {
            path: fileRelative,
          })
        }}
        <button
          type="button"
          class="editor-bar__btn editor-bar__btn--danger"
          @click="onDeleteConfirm"
        >
          {{ tm("spcodeProjectLoad.documentManager.editor.delete") }}
        </button>
        <button
          type="button"
          class="editor-bar__btn"
          @click="showDeleteConfirm = false"
        >
          {{ tm("spcodeProjectLoad.documentManager.editor.cancel") }}
        </button>
      </span>
    </div>

    <div v-if="renameOpen" class="document-editor__rename">
      <input
        v-model="renameDraft"
        type="text"
        class="document-editor__rename-input"
        @keydown.enter.prevent="onRenameSubmit"
        @keydown.escape.prevent="renameOpen = false"
      />
      <button
        type="button"
        class="editor-bar__btn editor-bar__btn--primary"
        @click="onRenameSubmit"
      >
        {{ tm("spcodeProjectLoad.documentManager.editor.rename") }}
      </button>
      <button
        type="button"
        class="editor-bar__btn"
        @click="renameOpen = false"
      >
        {{ tm("spcodeProjectLoad.documentManager.editor.cancel") }}
      </button>
      <span v-if="renameError" class="document-editor__rename-error">{{
        renameError
      }}</span>
    </div>
  </div>
</template>

<style scoped>
@import "@/styles/editor-bar.css";

.document-editor {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  gap: 6px;
  padding: 6px;
}
/* Top border over the action bar — the shared .editor-bar uses no
   borders so the workspace tab can opt-in by wrapping it in
   .preview-editor-toolbar. The .document-editor wrapper places it
   directly above the bar instead, so the rule lives here. */
.document-editor .editor-bar {
  padding-top: 4px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.document-editor__cm {
  flex: 1 1 auto;
  min-height: 0;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 4px;
  overflow: hidden;
  background: var(--v-theme-surface, transparent);
}
.document-editor__textarea {
  flex: 1 1 auto;
  min-height: 0;
  resize: none;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.5;
  padding: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 4px;
  background: var(--v-theme-surface, transparent);
  color: rgb(var(--v-theme-on-surface));
  outline: none;
}
.document-editor__textarea:focus {
  border-color: rgb(var(--v-theme-primary));
}

.document-editor__confirm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: rgb(var(--v-theme-error));
}
.document-editor__rename {
  display: flex;
  align-items: center;
  gap: 4px;
}
.document-editor__rename-input {
  flex: 1 1 auto;
  font-family: monospace;
  font-size: 12px;
  padding: 2px 6px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.3);
  border-radius: 4px;
  background: var(--v-theme-surface, transparent);
  color: rgb(var(--v-theme-on-surface));
  outline: none;
}
.document-editor__rename-input:focus {
  border-color: rgb(var(--v-theme-primary));
}
.document-editor__rename-error {
  font-size: 11px;
  color: rgb(var(--v-theme-error));
}
/* 2026-07-26 save-success-toast: green inline confirmation sitting
   in the toolbar's left-side flex flow. Inline-flex keeps the
   checkmark + text on one line; gap mirrors the toolbar button
   rhythm so the toast visually fits next to the action buttons. */
.document-editor__save-success {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
  font-size: 11.5px;
  color: rgb(var(--v-theme-success));
  white-space: nowrap;
}
/* Fade in/out for the toast transition. Slightly longer leave than
   enter so the message reads comfortably before it dissolves. */
.document-editor__success-fade-enter-active,
.document-editor__success-fade-leave-active {
  transition: opacity 180ms ease;
}
.document-editor__success-fade-enter-from,
.document-editor__success-fade-leave-to {
  opacity: 0;
}
</style>
