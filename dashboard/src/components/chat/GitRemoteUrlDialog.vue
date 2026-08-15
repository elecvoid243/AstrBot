<!-- Author: elecvoid243 @ 2026-08-12
     API doc: astrbot_plugin_spcode_toolkit docs/api/webapi-git-pull-push-remote-api.md §4
     Remote URL dialog:
       - list view (default): configured remotes (name + url) loaded by the
         parent; a "+" button opens the add form; clicking a row opens the
         form prefilled to update that remote's URL; the delete button opens
         a nested confirm and emits `remove(name)`. Empty state shows a hint
         plus only the "+" button.
       - form view: upsert (add when missing, set-url when present), emits
         submit; the form closes optimistically, the parent reloads the list.
     Dumb component: the parent (GitDiffSidebar) owns all mutations. -->
<template>
  <v-dialog
    :model-value="modelValue"
    persistent
    max-width="480"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">
        {{
          formOpen
            ? editingRemote
              ? tm("spcodeProjectLoad.diffSidebar.remote.formTitleEdit", {
                  remote: editingRemote,
                })
              : tm("spcodeProjectLoad.diffSidebar.remote.formTitleAdd")
            : tm("spcodeProjectLoad.diffSidebar.remote.dialogTitle")
        }}
      </v-card-title>
      <v-card-text class="pt-4">
        <!-- ── List view ───────────────────────────────── -->
        <template v-if="!formOpen">
          <div class="git-remote-dialog-list-title">
            <span>{{ tm("spcodeProjectLoad.diffSidebar.remote.listTitle") }}</span>
            <v-btn
              size="small"
              variant="tonal"
              color="primary"
              class="git-remote-dialog-add-btn"
              :title="tm('spcodeProjectLoad.diffSidebar.remote.addRemote')"
              :aria-label="tm('spcodeProjectLoad.diffSidebar.remote.addRemote')"
              @click="openAdd"
            >
              <v-icon size="16">mdi-plus</v-icon>
            </v-btn>
          </div>

          <v-list
            v-if="!listing && remotes.length > 0"
            density="compact"
            class="git-remote-dialog-list"
          >
            <v-list-item
              v-for="r in remotes"
              :key="r.name"
              class="git-remote-dialog-item"
              @click="openEdit(r)"
            >
              <template #prepend>
                <v-icon size="16" class="git-remote-dialog-item-icon">
                  mdi-source-repository
                </v-icon>
              </template>
              <v-list-item-title class="git-remote-dialog-item-name">
                {{ r.name }}
              </v-list-item-title>
              <v-list-item-subtitle class="git-remote-dialog-item-url">
                {{ r.url }}
              </v-list-item-subtitle>
              <template #append>
                <v-btn
                  size="small"
                  variant="text"
                  color="error"
                  :loading="removing === r.name"
                  :disabled="removing !== null"
                  :title="tm('spcodeProjectLoad.diffSidebar.remote.removeAria', { name: r.name })"
                  :aria-label="tm('spcodeProjectLoad.diffSidebar.remote.removeAria', { name: r.name })"
                  @click.stop="confirmRemove(r.name)"
                >
                  <v-icon size="16">mdi-delete-outline</v-icon>
                </v-btn>
              </template>
            </v-list-item>
          </v-list>

          <div
            v-else-if="!listing && remotes.length === 0"
            class="git-remote-dialog-empty"
          >
            {{ tm("spcodeProjectLoad.diffSidebar.remote.empty") }}
          </div>
          <div v-else class="git-remote-dialog-empty">
            <v-progress-circular
              size="14"
              indeterminate
              class="mr-2"
            />
            <span>{{ tm("spcodeProjectLoad.diffSidebar.remote.loading") }}</span>
          </div>
        </template>

        <!-- ── Form view (add / edit) ──────────────────── -->
        <template v-else>
          <v-text-field
            v-model="remote"
            :label="tm('spcodeProjectLoad.diffSidebar.remote.remoteLabel')"
            density="compact"
            variant="outlined"
            autocomplete="off"
            name="git-remote-name"
          />
          <v-text-field
            v-model="url"
            :label="tm('spcodeProjectLoad.diffSidebar.remote.urlLabel')"
            :error-messages="urlError ? [urlError] : []"
            density="compact"
            variant="outlined"
            class="mt-1"
            autocomplete="off"
            name="git-remote-url"
            @keyup.enter="onSubmit"
          />
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <template v-if="formOpen">
          <v-btn
            variant="text"
            :disabled="loading"
            @click="closeForm"
          >
            {{ tm("spcodeProjectLoad.diffSidebar.remote.cancel") }}
          </v-btn>
          <v-btn
            variant="tonal"
            color="primary"
            :loading="loading"
            @click="onSubmit"
          >
            {{ tm("spcodeProjectLoad.diffSidebar.remote.submit") }}
          </v-btn>
        </template>
        <v-btn
          v-else
          variant="text"
          @click="emit('update:modelValue', false)"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.remote.close") }}
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Nested delete confirm (2026-08-16) -->
    <v-dialog
      v-model="deleteConfirmOpen"
      persistent
      max-width="400"
    >
      <v-card>
        <v-card-title class="text-h3 pa-4 pb-0 pl-6">
          {{ tm("spcodeProjectLoad.diffSidebar.remote.deleteTitle") }}
        </v-card-title>
        <v-card-text class="pt-4">
          {{ tm("spcodeProjectLoad.diffSidebar.remote.deleteText", { name: pendingDelete }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="removing !== null"
            @click="deleteConfirmOpen = false"
          >
            {{ tm("spcodeProjectLoad.diffSidebar.remote.deleteCancel") }}
          </v-btn>
          <v-btn
            variant="tonal"
            color="error"
            :loading="removing !== null"
            @click="onRemoveConfirm"
          >
            {{ tm("spcodeProjectLoad.diffSidebar.remote.deleteSubmit") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import type { SpcodeRemote } from "@/composables/parseSpcodeGitRemoteSync";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    loading: boolean;
    /** 2026-08-16: configured remotes (name + url), loaded by the parent. */
    remotes: SpcodeRemote[];
    /** 2026-08-16: list request in flight. */
    listing: boolean;
    /** 2026-08-16: remote currently being removed (button spinner). */
    removing: string | null;
  }>(),
  {
    remotes: () => [],
    listing: false,
    removing: null,
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "submit", p: { remote: string; url: string }): void;
  (e: "remove", name: string): void;
}>();

const { tm } = useModuleI18n("features/chat");

const remote = ref("origin");
const url = ref("");
const urlError = ref("");
const pendingDelete = ref("");
const deleteConfirmOpen = ref(false);
const formOpen = ref(false);
/** Non-null while editing an existing remote (prefill name + url). */
const editingRemote = ref<string | null>(null);

// Reset state every time the dialog opens.
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      closeForm();
      pendingDelete.value = "";
      deleteConfirmOpen.value = false;
    }
  },
);

function closeForm(): void {
  formOpen.value = false;
  editingRemote.value = null;
  remote.value = "origin";
  url.value = "";
  urlError.value = "";
}

function openAdd(): void {
  closeForm();
  formOpen.value = true;
}

// Clicking a row opens the form prefilled to update that remote's URL.
function openEdit(r: SpcodeRemote): void {
  closeForm();
  editingRemote.value = r.name;
  remote.value = r.name;
  url.value = r.url;
  formOpen.value = true;
}

function confirmRemove(name: string): void {
  pendingDelete.value = name;
  deleteConfirmOpen.value = true;
}

function onRemoveConfirm(): void {
  if (!pendingDelete.value || props.removing !== null) return;
  emit("remove", pendingDelete.value);
  deleteConfirmOpen.value = false;
}

// Optimistically closes the form; the parent runs the upsert, reloads
// the list and surfaces failures via snackbar.
function onSubmit(): void {
  const trimmed = url.value.trim();
  if (!trimmed) {
    urlError.value = tm("spcodeProjectLoad.diffSidebar.remote.urlRequired");
    return;
  }
  urlError.value = "";
  const submittedRemote = remote.value.trim() || "origin";
  emit("submit", { remote: submittedRemote, url: trimmed });
  closeForm();
}
</script>

<style scoped>
.git-remote-dialog-list-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 4px;
}
.git-remote-dialog-add-btn {
  min-width: 28px;
  height: 24px;
  padding: 0 6px;
}
.git-remote-dialog-list {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 6px;
}
.git-remote-dialog-item {
  cursor: pointer;
}
.git-remote-dialog-item-icon {
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.git-remote-dialog-item-name {
  font-weight: 600;
  font-size: 13px;
}
.git-remote-dialog-item-url {
  font-size: 11.5px;
  word-break: break-all;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.git-remote-dialog-empty {
  display: flex;
  align-items: center;
  font-size: 12px;
  font-style: italic;
  color: rgba(var(--v-theme-on-surface), 0.55);
  padding: 8px 10px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.18);
  border-radius: 6px;
}
</style>
