<!-- Author: elecvoid243, 2026-08-09
     Spec: docs/superpowers/specs/2026-08-09-sidebar-drag-file-reference-design.md §4.5
     Renders a parsed "[Referenced files]" block as a static card: header
     (icon + title + count chip) + one row per referenced file (file icon,
     basename, full path). No collapse — reference lists are short (YAGNI).
     Theme tokens only, same approach as FileReviewCommentsCard. -->
<template>
  <div class="frf">
    <div class="frf-head">
      <v-icon size="15" color="primary">mdi-file-link-outline</v-icon>
      <span class="frf-title">{{
        tm("spcodeProjectLoad.fileReferencesCard.title")
      }}</span>
      <span class="frf-chip">{{ block.paths.length }}</span>
    </div>
    <div v-for="(p, i) in block.paths" :key="i" class="frf-row">
      <v-icon size="14" class="frf-file-icon">mdi-file-outline</v-icon>
      <span class="frf-name">{{ basename(p) }}</span>
      <span class="frf-path">{{ p }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useModuleI18n } from "@/i18n/composables";
import type { FileReferencesBlock } from "@/utils/parseFileReferences";

defineProps<{ block: FileReferencesBlock }>();

const { tm } = useModuleI18n("features/chat");

/** Basename for display; handles both "/" and "\" separators. */
function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
</script>

<style scoped>
.frf {
  width: 100%;
  margin-top: 4px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-left: 3px solid rgb(var(--v-theme-primary));
  border-radius: 12px;
  overflow: hidden;
  text-align: left;
}
.frf-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 14px;
  background: rgb(var(--v-theme-mcpCardBg));
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.frf-title {
  font-size: 13px;
  font-weight: 700;
  color: rgb(var(--v-theme-on-surface));
}
.frf-chip {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
  border-radius: 99px;
  padding: 2px 9px;
  white-space: nowrap;
}
.frf-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.frf-row:last-child {
  border-bottom: 0;
}
.frf-file-icon {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.frf-name {
  flex: none;
  font-size: 12.5px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}
.frf-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
