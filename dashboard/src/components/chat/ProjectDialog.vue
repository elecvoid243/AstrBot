<template>
    <v-dialog v-model="isOpen" max-width="640" @update:model-value="handleDialogChange">
        <v-card>
            <v-card-title class="text-h3 pa-4 pb-0 pl-6">
                {{ isEditing ? tm('project.edit') : tm('project.create') }}
            </v-card-title>
            <v-card-text>
                <v-text-field v-model="form.emoji" :label="tm('project.emoji')" variant="outlined" hide-details class="mb-3" />
                <v-text-field v-model="form.title" :label="tm('project.name')" variant="outlined" hide-details class="mb-3" autofocus
                    @keyup.enter="handleSave" />
                <v-textarea v-model="form.description" :label="tm('project.description')" variant="outlined" hide-details rows="3" />
                <v-divider class="my-4" />
                <v-select v-model="form.workspace_type" :items="workspaceTypeItems" item-title="label" item-value="value"
                    :label="tm('project.workspace.type')" variant="outlined" hide-details class="mb-3" />
                <v-text-field
                    v-if="form.workspace_type !== 'session'"
                    v-model="form.workspace_path"
                    :label="tm('project.workspace.path')"
                    variant="outlined"
                    hide-details
                    class="mb-1"
                    persistent-hint
                    :hint="form.workspace_type === 'custom' ? tm('project.spcode.pathHint') : ''"
                >
                    <template #append-inner>
                        <v-btn
                            icon="mdi-folder-search-outline"
                            variant="text"
                            size="small"
                            data-testid="browse-directory"
                            :title="tm('spcodeProjectLoad.dialog.browse')"
                            :aria-label="tm('spcodeProjectLoad.dialog.browse')"
                            @click="browserOpen = true"
                        />
                    </template>
                </v-text-field>
                <!-- Recent paths shared with ProjectLoadDialog; click fills
                     the field, the X drops the entry from history. Hidden in
                     session mode — same gate as the path field itself. -->
                <div
                    v-if="form.workspace_type !== 'session' && recentPaths.length"
                    class="path-history mt-2"
                >
                    <div class="text-caption text-medium-emphasis mb-1">
                        {{ tm('spcodeProjectLoad.dialog.historyLabel') }}
                    </div>
                    <v-list density="compact" class="history-list pa-0">
                        <v-list-item
                            v-for="item in recentPaths"
                            :key="item"
                            class="history-item"
                            rounded="md"
                            @click="form.workspace_path = item"
                        >
                            <template #prepend>
                                <v-icon icon="mdi-history" size="x-small" />
                            </template>
                            <v-list-item-title class="text-body-2">
                                {{ item }}
                            </v-list-item-title>
                            <template #append>
                                <v-btn
                                    icon="mdi-close"
                                    variant="text"
                                    size="x-small"
                                    density="compact"
                                    :aria-label="tm('spcodeProjectLoad.dialog.removeFromHistory')"
                                    @click.stop="removeFromPathHistory(item)"
                                />
                            </template>
                        </v-list-item>
                    </v-list>
                </div>
                <ProjectDirectoryBrowser
                    v-model="browserOpen"
                    @select="onBrowserSelect"
                />
                <v-divider v-if="form.workspace_type === 'custom'" class="my-4" />
                <div v-if="form.workspace_type === 'custom'" class="spcode-section">
                    <div class="spcode-section-title">{{ tm('project.spcode.sectionTitle') }}</div>
                    <v-switch v-model="form.spcode_auto_load" :label="tm('project.spcode.autoLoad')" color="primary"
                        density="comfortable" hide-details class="mb-2" />
                    <div class="spcode-section-hint">{{ tm('project.spcode.autoLoadHint') }}</div>
                    <v-switch v-model="form.spcode_no_codegraph" :label="tm('project.spcode.noCodegraph')" color="primary"
                        density="comfortable" hide-details class="mb-2 mt-3" />
                    <div class="spcode-section-hint">{{ tm('project.spcode.noCodegraphHint') }}</div>
                </div>
                <v-alert
                    v-if="props.errorMessage"
                    class="mt-3"
                    type="error"
                    variant="tonal"
                    density="compact"
                >
                    {{ props.errorMessage }}
                </v-alert>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn variant="text" @click="handleCancel" color="grey-darken-1" :disabled="props.saving">{{ t('core.common.cancel') }}</v-btn>
                <v-btn variant="text" @click="handleSave" color="primary" :disabled="!canSave || props.saving" :loading="props.saving">{{ t('core.common.save') }}</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n, useModuleI18n } from '@/i18n/composables';
import { useProjectPathHistory } from '@/composables/useProjectPathHistory';
import ProjectDirectoryBrowser from './ProjectDirectoryBrowser.vue';

export type WorkspaceType = 'session' | 'project' | 'custom';

export interface Project {
    project_id: string;
    title: string;
    emoji?: string;
    description?: string;
    workspace_type?: WorkspaceType;
    workspace_path?: string | null;
    resolved_workspace_path?: string | null;
    spcode_auto_load?: boolean;
    spcode_no_codegraph?: boolean;
    created_at: string;
    updated_at: string;
}

export interface ProjectFormData {
    emoji: string;
    title: string;
    description: string;
    workspace_type: WorkspaceType;
    workspace_path: string;
    spcode_auto_load?: boolean;
    spcode_no_codegraph?: boolean;
}

interface Props {
    modelValue: boolean;
    project?: Project | null;
    errorMessage?: string;
    saving?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    modelValue: false,
    project: null,
    errorMessage: '',
    saving: false
});

const emit = defineEmits<{
    'update:modelValue': [value: boolean];
    save: [formData: ProjectFormData, projectId?: string];
}>();

const { t } = useI18n();
const { tm } = useModuleI18n('features/chat');

const isOpen = ref(props.modelValue);
const isEditing = ref(false);
// In-app directory picker (same one ProjectLoadDialog uses); opened by
// the browse button inside the workspace-path field.
const browserOpen = ref(false);
// Shared recent-path history (same localStorage key as ProjectLoadDialog).
const { recentPaths, addToPathHistory, removeFromPathHistory } =
    useProjectPathHistory();
const form = ref<ProjectFormData>({
    emoji: '📁',
    title: '',
    description: '',
    workspace_type: 'project',
    workspace_path: '',
    spcode_auto_load: true,
    spcode_no_codegraph: false,
});
const workspaceTypeItems = computed(() => [
    { label: tm('project.workspace.project'), value: 'project' },
    { label: tm('project.workspace.session'), value: 'session' },
    { label: tm('project.workspace.custom'), value: 'custom' }
]);
const canSave = computed(() => {
    if (!form.value.title.trim()) return false;
    if (form.value.workspace_type === 'session') return true;
    // project / custom both require non-empty path
    return form.value.workspace_path.trim().length > 0;
});

watch(() => props.modelValue, (newVal) => {
    isOpen.value = newVal;
    if (newVal) {
        if (props.project) {
            isEditing.value = true;
            form.value = {
                emoji: props.project.emoji || '📁',
                title: props.project.title,
                description: props.project.description || '',
                workspace_type: props.project.workspace_type || 'session',
                workspace_path: props.project.workspace_path || '',
                spcode_auto_load: props.project.spcode_auto_load !== false,
                spcode_no_codegraph: props.project.spcode_no_codegraph === true,
            };
        } else {
            isEditing.value = false;
            form.value = {
                emoji: '📁',
                title: '',
                description: '',
                workspace_type: 'project',
                workspace_path: '',
                spcode_auto_load: true,
                spcode_no_codegraph: false,
            };
        }
    }
});

watch(() => form.value.workspace_type, (workspaceType) => {
    if (workspaceType === 'session') {
        form.value.workspace_path = '';
    }
});

function handleDialogChange(value: boolean) {
    emit('update:modelValue', value);
}

/**
 * Handle a directory chosen in the in-app file browser: fill the
 * workspace-path field. Same flow as ProjectLoadDialog — the selected
 * absolute path comes straight from the backend, and manual typing
 * remains fully available.
 */
function onBrowserSelect(selectedPath: string) {
    form.value.workspace_path = selectedPath;
}

function handleCancel() {
    isOpen.value = false;
    emit('update:modelValue', false);
}

function handleSave() {
    if (!canSave.value) {
        return;
    }

    const workspacePath = form.value.workspace_path.trim();
    // Record the saved path so it shows up as recent in this dialog and
    // in ProjectLoadDialog (shared history).
    if (workspacePath) {
        addToPathHistory(workspacePath);
    }

    emit('save', {
        ...form.value,
        workspace_path: workspacePath
    }, props.project?.project_id);
}

</script>

<style scoped>
.dialog-title {
    font-size: 22px;
    font-weight: 500;
}

.spcode-section {
    margin-top: 4px;
}

/* Recent-path list: same rendering as ProjectLoadDialog's history —
   monospace, wraps long absolute paths, capped height. */
.history-list {
    max-height: 160px;
    overflow-y: auto;
    background: transparent;
}

.history-item :deep(.v-list-item-title) {
    font-family: "Fira Code", "Consolas", monospace;
    font-size: 12px;
    word-break: break-all;
    white-space: normal;
}
.spcode-section-title {
    font-size: 13px;
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.78);
    margin-bottom: 8px;
}
.spcode-section-hint {
    font-size: 12px;
    color: rgba(var(--v-theme-on-surface), 0.56);
    margin-top: -4px;
    margin-bottom: 4px;
    line-height: 1.4;
}
</style>
