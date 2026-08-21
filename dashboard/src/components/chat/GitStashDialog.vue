<!-- Author: elecvoid243 @ 2026-08-21
     API: astrbot_plugin_spcode_toolkit tools/webapi/git_stash.py
     Stash dialog for the GitDiffSidebar: stash the current working-tree
     changes (optional message) and browse the existing stash entries
     with their per-file numstat details. Dumb component — the parent
     (GitDiffSidebar) owns the composable / mutations. Mirrors
     GitPullDialog + the GitRemoteUrlDialog list layout. -->
<template>
  <v-dialog
    :model-value="modelValue"
    persistent
    max-width="560"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6 d-flex align-center">
        <span>{{ tm("spcodeProjectLoad.diffSidebar.stash.dialogTitle") }}</span>
        <v-spacer />
        <v-btn
          icon
          variant="text"
          size="small"
          :loading="listing"
          :title="tm('spcodeProjectLoad.diffSidebar.stash.refresh')"
          @click="emit('refresh')"
        >
          <v-icon size="18">mdi-refresh</v-icon>
        </v-btn>
      </v-card-title>

      <v-card-text class="pt-4">
        <!-- Stash the current changes -->
        <v-text-field
          v-model="message"
          density="compact"
          variant="outlined"
          hide-details
          maxlength="8192"
          :disabled="isStashing"
          :label="tm('spcodeProjectLoad.diffSidebar.stash.messageLabel')"
          :placeholder="tm('spcodeProjectLoad.diffSidebar.stash.messagePlaceholder')"
          @keyup.enter="onStash"
        />
        <div class="stash-actions">
          <v-btn
            variant="tonal"
            color="primary"
            size="small"
            :disabled="!hasLocalChanges || isStashing"
            :loading="isStashing"
            :title="stashHint"
            @click="onStash"
          >
            {{ tm("spcodeProjectLoad.diffSidebar.stash.stashButton") }}
          </v-btn>
          <span v-if="!hasLocalChanges" class="stash-hint">
            {{ tm("spcodeProjectLoad.diffSidebar.stash.stashButtonDisabledHint") }}
          </span>
        </div>

        <v-divider class="my-3" />

        <!-- Existing stash entries -->
        <div class="stash-list-title">
          {{ tm("spcodeProjectLoad.diffSidebar.stash.listTitle") }}
        </div>

        <div v-if="listing && stashes.length === 0" class="stash-placeholder">
          <v-progress-circular indeterminate size="16" width="2" />
        </div>
        <div v-else-if="loadError" class="stash-placeholder stash-error">
          {{ tm("spcodeProjectLoad.diffSidebar.stash.loadFailed", { reason: loadError }) }}
        </div>
        <div v-else-if="stashes.length === 0" class="stash-placeholder">
          {{ tm("spcodeProjectLoad.diffSidebar.stash.listEmpty") }}
        </div>
        <template v-else>
          <div v-for="s in stashes" :key="s.ref" class="stash-entry">
            <button type="button" class="stash-entry-header" @click="toggle(s.ref)">
              <v-icon size="14" class="stash-chevron" :class="{ expanded: expanded.has(s.ref) }">
                mdi-chevron-right
              </v-icon>
              <span class="stash-ref">{{ s.ref }}</span>
              <span class="stash-msg" :title="s.message">{{ s.message }}</span>
              <span class="stash-meta">
                {{ tm("spcodeProjectLoad.diffSidebar.stash.fileCount", { count: s.fileCount }) }}
                <template v-if="formatTime(s.timestamp)">
                  · {{ formatTime(s.timestamp) }}
                </template>
              </span>
              <!-- Pop: apply this stash back onto the working tree and
                   drop the entry. Requires a clean tree (backend
                   enforces worktree_dirty); the click must not toggle
                   the expand state. -->
              <button
                type="button"
                class="stash-pop-btn"
                :disabled="!canPop"
                :title="popTitle"
                @click.stop="emit('pop', { index: s.index, ref: s.ref })"
              >
                <v-progress-circular
                  v-if="popping === s.ref"
                  indeterminate
                  size="12"
                  width="2"
                />
                <v-icon v-else size="14">mdi-tray-arrow-down</v-icon>
              </button>
              <!-- Drop: delete this stash entry (worktree untouched).
                   Destructive — gated by a nested confirm below. -->
              <button
                type="button"
                class="stash-drop-btn"
                :disabled="!canDrop"
                :title="tm('spcodeProjectLoad.diffSidebar.stash.dropButton')"
                @click.stop="confirmDrop(s)"
              >
                <v-progress-circular
                  v-if="dropping === s.ref"
                  indeterminate
                  size="12"
                  width="2"
                />
                <v-icon v-else size="14">mdi-trash-can-outline</v-icon>
              </button>
            </button>
            <div v-if="expanded.has(s.ref)" class="stash-files">
              <div v-for="f in s.files" :key="f.path" class="stash-file">
                <span class="stash-file-path" :title="f.path">{{ basename(f.path) }}</span>
                <span v-if="f.untracked" class="stash-file-badge">
                  {{ tm("spcodeProjectLoad.diffSidebar.stash.untracked") }}
                </span>
                <span class="stash-file-stat">
                  <template v-if="f.additions === null">
                    {{ tm("spcodeProjectLoad.diffSidebar.stash.binary") }}
                  </template>
                  <template v-else>
                    <span class="stat-adds">+{{ f.additions }}</span>
                    <span class="stat-dels">−{{ f.deletions }}</span>
                  </template>
                </span>
              </div>
            </div>
          </div>
          <div v-if="truncated" class="stash-placeholder">
            {{ tm("spcodeProjectLoad.diffSidebar.stash.listTruncated") }}
          </div>
        </template>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="isStashing" @click="emit('update:modelValue', false)">
          {{ tm("spcodeProjectLoad.diffSidebar.stash.close") }}
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Nested drop confirm (mirrors GitRemoteUrlDialog's delete
         confirm): dropping is destructive and only reflog-recoverable. -->
    <v-dialog v-model="dropConfirmOpen" persistent max-width="400">
      <v-card>
        <v-card-title class="text-h3 pa-4 pb-0 pl-6">
          {{ tm("spcodeProjectLoad.diffSidebar.stash.dropTitle") }}
        </v-card-title>
        <v-card-text class="pt-4">
          {{
            tm("spcodeProjectLoad.diffSidebar.stash.dropText", {
              ref: pendingDrop?.ref ?? "",
            })
          }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="dropping !== null"
            @click="dropConfirmOpen = false"
          >
            {{ tm("spcodeProjectLoad.diffSidebar.stash.dropCancel") }}
          </v-btn>
          <v-btn
            variant="tonal"
            color="error"
            :loading="dropping !== null"
            @click="onDropConfirm"
          >
            {{ tm("spcodeProjectLoad.diffSidebar.stash.dropSubmit") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import type { SpcodeStashEntry } from "@/composables/parseSpcodeGitStash";

const props = defineProps<{
  modelValue: boolean;
  stashes: SpcodeStashEntry[];
  listing: boolean;
  isStashing: boolean;
  /** Ref ("stash@{N}") currently being popped, or null. */
  popping: string | null;
  /** Ref ("stash@{N}") currently being dropped, or null. */
  dropping: string | null;
  hasLocalChanges: boolean;
  loadError: string | null;
  truncated?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "stash", p: { message: string }): void;
  (e: "pop", p: { index: number; ref: string }): void;
  (e: "drop", p: { index: number; ref: string }): void;
  (e: "refresh"): void;
}>();

const { tm } = useModuleI18n("features/chat");

const message = ref("");
/** Expanded stash refs (stash@{0}, …). */
const expanded = ref(new Set<string>());
/** Stash entry awaiting drop confirmation (nested dialog). */
const pendingDrop = ref<SpcodeStashEntry | null>(null);
const dropConfirmOpen = ref(false);

// Reset the form every time the dialog opens.
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      message.value = "";
      expanded.value = new Set();
    }
    pendingDrop.value = null;
    dropConfirmOpen.value = false;
  },
);

const stashHint = computed(() =>
  props.hasLocalChanges
    ? ""
    : tm("spcodeProjectLoad.diffSidebar.stash.stashButtonDisabledHint"),
);

// Pop needs a clean working tree (the backend rejects worktree_dirty);
// stash and pop are mutual inverses, so exactly one of the two dialog
// actions is enabled at any time.
const canPop = computed(
  () =>
    !props.hasLocalChanges &&
    !props.isStashing &&
    props.popping === null &&
    props.dropping === null,
);

const popTitle = computed(() =>
  props.hasLocalChanges
    ? tm("spcodeProjectLoad.diffSidebar.stash.popDisabledHint")
    : tm("spcodeProjectLoad.diffSidebar.stash.popButton"),
);

// Drop only deletes the stash entry, so — unlike pop — it needs no
// clean tree; it is merely blocked while another mutation is in flight.
const canDrop = computed(
  () =>
    !props.isStashing && props.popping === null && props.dropping === null,
);

function confirmDrop(entry: SpcodeStashEntry): void {
  pendingDrop.value = entry;
  dropConfirmOpen.value = true;
}

function onDropConfirm(): void {
  const entry = pendingDrop.value;
  if (!entry) return;
  dropConfirmOpen.value = false;
  emit("drop", { index: entry.index, ref: entry.ref });
}

function toggle(ref: string): void {
  const next = new Set(expanded.value);
  if (next.has(ref)) next.delete(ref);
  else next.add(ref);
  expanded.value = next;
}

function onStash(): void {
  if (!props.hasLocalChanges || props.isStashing) return;
  emit("stash", { message: message.value.trim() });
}

function basename(path: string): string {
  const segs = path.split(/[\\/]/);
  return segs[segs.length - 1] || path;
}

function formatTime(ts: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString();
}
</script>

<style scoped>
.stash-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.stash-hint {
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.stash-list-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 6px;
}
.stash-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px 0;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.stash-error {
  color: #cf222e;
}
.stash-entry {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 6px;
  margin-bottom: 6px;
  overflow: hidden;
}
.stash-entry-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.8);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  text-align: left;
}
.stash-entry-header:hover {
  background: rgba(var(--v-theme-on-surface), 0.07);
}
.stash-chevron {
  flex-shrink: 0;
  transition: transform 0.2s ease;
}
.stash-chevron.expanded {
  transform: rotate(90deg);
}
.stash-ref {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.stash-msg {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stash-meta {
  flex-shrink: 0;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.stash-pop-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin-left: 4px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer;
  transition: background 0.15s ease;
}
.stash-pop-btn:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.stash-pop-btn:disabled {
  cursor: default;
  opacity: 0.4;
}
.stash-drop-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer;
  transition: background 0.15s ease;
}
.stash-drop-btn:hover:not(:disabled) {
  background: rgba(207, 34, 46, 0.1);
  color: #cf222e;
}
.stash-drop-btn:disabled {
  cursor: default;
  opacity: 0.4;
}
.stash-files {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  padding: 4px 8px;
  max-height: 240px;
  overflow-y: auto;
}
.stash-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  font-size: 11.5px;
}
.stash-file-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.stash-file-badge {
  flex-shrink: 0;
  font-size: 10px;
  padding: 0 5px;
  border-radius: 3px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.stash-file-stat {
  margin-left: auto;
  flex-shrink: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10.5px;
}
.stat-adds {
  color: #2da44e;
  font-weight: 600;
}
.stat-dels {
  color: #cf222e;
  font-weight: 600;
  margin-left: 4px;
}
</style>
