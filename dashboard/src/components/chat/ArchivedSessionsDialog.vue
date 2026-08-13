<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card class="archived-dialog">
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">
        {{ tm("conversation.archivedDialogTitle") }}
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-model="searchInput"
          :label="tm('conversation.archivedSearchPlaceholder')"
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          class="mb-3"
          @update:model-value="onSearchInput"
        />

        <div v-if="loading" class="archived-dialog-status">
          <v-progress-circular indeterminate size="18" width="2" />
        </div>

        <div v-else-if="items.length" class="archived-dialog-list">
          <div
            v-for="session in items"
            :key="session.session_id"
            class="archived-dialog-item"
          >
            <span class="archived-dialog-title">
              {{ session.display_name?.trim() || tm("conversation.newConversation") }}
            </span>
            <span v-if="session.project_title" class="archived-project-tag">
              {{ session.project_title }}
            </span>
            <div class="archived-dialog-actions">
              <v-btn
                icon
                size="small"
                variant="text"
                class="archived-dialog-btn"
                :title="tm('conversation.unarchive')"
                @click="restoreSession(session)"
              >
                <ArchiveRestore :size="16" />
              </v-btn>
              <v-btn
                icon
                size="small"
                variant="text"
                class="archived-dialog-btn"
                :title="tm('actions.deleteChat')"
                @click="deleteSession(session)"
              >
                <Trash2 :size="16" />
              </v-btn>
            </div>
          </div>
        </div>

        <div v-else class="archived-empty">
          {{ tm("conversation.archivedEmpty") }}
        </div>
      </v-card-text>

      <v-card-actions>
        <span class="archived-dialog-pagination">
          {{
            tm("conversation.archivedPagination", {
              page: pagination.page,
              totalPages: pagination.total_pages,
              total: pagination.total,
            })
          }}
        </span>
        <v-select
          v-model="pageSize"
          :items="pageSizeOptions"
          density="compact"
          variant="outlined"
          hide-details
          width="88"
          class="archived-dialog-page-size"
        />
        <v-spacer />
        <v-btn
          icon
          variant="text"
          :disabled="pagination.page <= 1"
          :title="tm('search.prevPage')"
          @click="goPage(pagination.page - 1)"
        >
          <ChevronLeft :size="20" />
        </v-btn>
        <v-btn
          icon
          variant="text"
          :disabled="pagination.page >= pagination.total_pages"
          :title="tm('search.nextPage')"
          @click="goPage(pagination.page + 1)"
        >
          <ChevronRight :size="20" />
        </v-btn>
        <v-btn variant="text" @click="$emit('update:modelValue', false)">
          {{ t("core.common.close") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { ArchiveRestore, ChevronLeft, ChevronRight, Trash2 } from "@lucide/vue";
import { useI18n, useModuleI18n } from "@/i18n/composables";
import { useToast } from "@/utils/toast";
import { askForConfirmation, useConfirmDialog } from "@/utils/confirmDialog";
import { chatApi } from "@/api/v1";
import {
  useSessions,
  type ArchivedSession,
} from "@/composables/useSessions";

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** Session restored; parent refreshes sidebar/project lists. */
  restore: [session: ArchivedSession];
  /** Session deleted; parent refreshes sidebar/project lists. */
  delete: [session: ArchivedSession];
  /** Total archived count changed; parent updates the badge. */
  count: [total: number];
}>();

const { t } = useI18n();
const { tm } = useModuleI18n("features/chat");
const toast = useToast();
const confirmDialog = useConfirmDialog();
const { getArchivedSessions, setSessionArchived } = useSessions();

const items = ref<ArchivedSession[]>([]);
const pagination = ref({
  page: 1,
  page_size: 20,
  total: 0,
  total_pages: 1,
});
const loading = ref(false);
const searchInput = ref("");
const searchQuery = ref("");
const pageSizeOptions = [20, 30, 50];
const pageSize = ref(20);
let searchDebounce: ReturnType<typeof setTimeout> | null = null;

async function load() {
  loading.value = true;
  try {
    const payload = await getArchivedSessions({
      page: pagination.value.page,
      page_size: pageSize.value,
      search: searchQuery.value,
    });
    items.value = payload.items;
    pagination.value = {
      ...pagination.value,
      ...payload.pagination,
      page_size: pageSize.value,
    };
    emit("count", payload.pagination.total);
  } finally {
    loading.value = false;
  }
}

function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    searchQuery.value = searchInput.value.trim();
    pagination.value.page = 1;
    void load();
  }, 250);
}

function goPage(page: number) {
  if (page < 1 || page > pagination.value.total_pages) return;
  pagination.value.page = page;
  void load();
}

async function restoreSession(session: ArchivedSession) {
  const ok = await setSessionArchived(session.session_id, false);
  if (!ok) {
    toast.error(tm("conversation.unarchiveFailed"));
    return;
  }
  toast.success(tm("conversation.unarchiveToast"));
  emit("restore", session);
  void load();
}

async function deleteSession(session: ArchivedSession) {
  const title = session.display_name?.trim() || tm("conversation.newConversation");
  const message = tm("conversation.confirmDelete", { name: title });
  if (!(await askForConfirmation(message, confirmDialog))) return;
  try {
    // Direct API call: useSessions.deleteSession would reset the active
    // session id, which is wrong when removing an archived session.
    await chatApi.deleteSession(session.session_id);
  } catch (err) {
    console.error("Failed to delete archived session:", err);
    toast.error(tm("batch.requestFailed"));
    return;
  }
  emit("delete", session);
  void load();
}

watch(
  () => pageSize.value,
  () => {
    pagination.value.page = 1;
    void load();
  },
);

// Reset query + paging every time the dialog opens.
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    searchInput.value = "";
    searchQuery.value = "";
    pagination.value.page = 1;
    void load();
  },
);
</script>

<style scoped>
.archived-dialog-status {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}

.archived-dialog-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 46vh;
  overflow-y: auto;
}

.archived-dialog-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
}

.archived-dialog-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.archived-dialog-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
}

.archived-project-tag {
  flex: 0 0 auto;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  font-size: 11px;
  line-height: 18px;
}

.archived-dialog-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.archived-dialog-btn {
  color: var(--chat-muted);
}

.archived-dialog-btn:hover {
  color: rgb(var(--v-theme-on-surface));
}

.archived-empty {
  padding: 24px 0;
  text-align: center;
  color: var(--chat-muted);
  font-size: 13px;
}

.archived-dialog-pagination {
  font-size: 12px;
  color: var(--chat-muted);
  margin-right: 8px;
}

.archived-dialog-page-size {
  flex: 0 0 auto;
}
</style>
