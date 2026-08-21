<!--
  FileAccessModeChip — compact dropdown file access mode switcher
  (full / readonly / workspace). Replaces SpcodePlanModeChip: readonly
  IS plan mode, with the state owned by AstrBot core (per-umo).

  Dropdown form (was a 3-segment control): the three segments dominated
  the input status row's width, so the switcher collapses to a single
  chip-height button showing the active mode. Menu/row styling follows
  the SpcodeProjectIndicator worktree picker pattern.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import {
  useFileAccessMode,
  type FileAccessMode,
} from "@/composables/useFileAccessMode";

const { tm } = useModuleI18n("features/chat");
const { status } = useFileAccessMode();

const emit = defineEmits<{
  (e: "change", mode: FileAccessMode): void;
}>();

const menuOpen = ref(false);

interface ModeOption {
  value: FileAccessMode;
  label: string;
  icon: string;
}

const modeValue = computed<FileAccessMode>(
  () => status.value.mode ?? status.value.defaultMode ?? "full",
);

const options = computed<ModeOption[]>(() => [
  {
    value: "full",
    label: tm("fileAccessChip.fullLabel"),
    icon: "mdi-lock-open-outline",
  },
  {
    value: "readonly",
    label: tm("fileAccessChip.readonlyLabel"),
    icon: "mdi-file-eye-outline",
  },
  {
    value: "workspace",
    label: tm("fileAccessChip.workspaceLabel"),
    icon: "mdi-folder-edit-outline",
  },
]);

const activeOption = computed<ModeOption>(
  () => options.value.find((o) => o.value === modeValue.value) ?? options.value[0],
);

function select(mode: FileAccessMode): void {
  menuOpen.value = false;
  if (mode === modeValue.value) return;
  emit("change", mode);
}
</script>

<template>
  <v-menu v-model="menuOpen" location="bottom start" transition="none">
    <template #activator="{ props: menuProps }">
      <v-tooltip location="bottom" :open-delay="200">
        <template #activator="{ props: tipProps }">
          <button
            v-bind="{ ...tipProps, ...menuProps }"
            type="button"
            class="fa-chip-btn"
            :aria-label="tm('fileAccessChip.menuTitle')"
          >
            <v-icon
              size="14"
              class="fa-chip-btn__icon"
              :class="`fa-chip-btn__icon--${activeOption.value}`"
            >
              {{ activeOption.icon }}
            </v-icon>
            <span class="fa-chip-btn__label">{{ activeOption.label }}</span>
            <v-icon size="12" class="fa-chip-btn__chevron">mdi-menu-down</v-icon>
          </button>
        </template>
        <span>{{ tm("fileAccessChip.tooltip") }}</span>
      </v-tooltip>
    </template>
    <v-card min-width="220">
      <v-card-text>
        <div class="fa-chip-title">{{ tm("fileAccessChip.menuTitle") }}</div>
        <button
          v-for="opt in options"
          :key="opt.value"
          type="button"
          class="fa-chip-row"
          :class="{ 'fa-chip-row--selected': opt.value === modeValue }"
          @click="select(opt.value)"
        >
          <v-icon
            size="14"
            class="fa-chip-row__icon"
            :class="`fa-chip-row__icon--${opt.value}`"
          >
            {{ opt.icon }}
          </v-icon>
          <span class="fa-chip-row__label">{{ opt.label }}</span>
          <v-icon v-if="opt.value === modeValue" size="14" class="fa-chip-row__check">
            mdi-check
          </v-icon>
        </button>
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<style scoped>
.fa-chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: var(--sp-chip-height);
  padding: 0 8px;
  border: 1px solid var(--sp-chip-border);
  border-radius: 10px;
  background: var(--sp-chip-bg);
  color: var(--sp-text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.fa-chip-btn:hover {
  background: var(--sp-chip-hover-bg);
}

.fa-chip-btn:active {
  background: var(--sp-chip-active-bg);
}

.fa-chip-btn:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

/* Long locale labels (ru-RU) truncate instead of stretching the row. */
.fa-chip-btn__label {
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fa-chip-btn__chevron {
  opacity: 0.7;
}

/* Restrictive modes tint their icon so the current state reads at a
   glance: readonly is a hard write lock (warning), workspace is scoped
   (primary). Full stays neutral. */
.fa-chip-btn__icon--readonly {
  color: rgb(var(--v-theme-warning));
}

.fa-chip-btn__icon--workspace {
  color: rgb(var(--v-theme-primary));
}

.fa-chip-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--sp-text-primary);
  margin-bottom: 2px;
}

.fa-chip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin-top: 4px;
  padding: 4px 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--sp-text-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.fa-chip-row:hover {
  background: var(--sp-chip-hover-bg);
}

.fa-chip-row__icon--readonly {
  color: rgb(var(--v-theme-warning));
}

.fa-chip-row__icon--workspace {
  color: rgb(var(--v-theme-primary));
}

.fa-chip-row__check {
  margin-left: auto;
}
</style>
