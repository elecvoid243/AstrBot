<!-- Author: elecvoid243, 2026-07-22
     Spec: docs/superpowers/specs/2026-07-22-binary-preview-design.md §6.3
     CSV rendering via papaparse. We read the blob as text and parse
     it into a 2-D string array. A hard MAX_ROWS cap protects the
     browser against pathological files (the backend already enforces
     50MB, but a 50MB CSV can still blow up the renderer). -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import Papa from "papaparse";

const MAX_ROWS = 5000;

const props = defineProps<{ blob: Blob }>();
const { tm } = useModuleI18n("features/chat");

const rows = ref<string[][]>([]);
const error = ref<string | null>(null);
const loading = ref<boolean>(false);
const truncated = ref<boolean>(false);

let loadToken = 0;

async function parse(): Promise<void> {
  const token = ++loadToken;
  if (!props.blob) {
    error.value = "decode_failed";
    return;
  }
  loading.value = true;
  error.value = null;
  rows.value = [];
  truncated.value = false;
  try {
    const text = await props.blob.text();
    if (token !== loadToken) return;
    // `skipEmptyLines: true` drops fully-empty rows so the table is
    // not padded with `<tr><td></td></td>...` placeholders.
    const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
    if (token !== loadToken) return;
    if (result.errors.length > 0) {
      // Surface the first parse error to the user; subsequent ones
      // are usually consequences of the first.
      error.value = result.errors[0]?.message ?? "decode_failed";
      return;
    }
    const data = result.data ?? [];
    if (data.length > MAX_ROWS) {
      truncated.value = true;
    }
    rows.value = data.slice(0, MAX_ROWS).map((row) =>
      Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [],
    );
  } catch (e) {
    if (token !== loadToken) return;
    error.value = (e as Error)?.message ?? "decode_failed";
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

watch(
  () => props.blob,
  () => {
    void parse();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  loadToken++;
});

const rowCountLabel = computed<string>(() => {
  return tm(
    "spcodeProjectLoad.documentManager.binaryPreview.csv.rowCount",
    { n: rows.value.length },
  );
});
</script>

<template>
  <div class="csv-preview">
    <div
      v-if="error"
      class="csv-preview__placeholder csv-preview__placeholder--error"
    >
      <v-icon icon="mdi-alert-circle-outline" />
      <span>{{
        tm(`spcodeProjectLoad.documentManager.binary.errors.${error}`, {
          reason: error,
        })
      }}</span>
    </div>
    <template v-else>
      <div class="csv-preview__meta">
        <span>{{ rowCountLabel }}</span>
        <span v-if="truncated" class="csv-preview__truncated">
          {{
            tm(
              "spcodeProjectLoad.documentManager.binaryPreview.csv.truncated",
              { max: MAX_ROWS },
            )
          }}
        </span>
      </div>
      <div v-if="loading && rows.length === 0" class="csv-preview__placeholder">
        <v-progress-circular indeterminate size="20" />
        <span>{{ tm("spcodeProjectLoad.documentManager.raw.loading") }}</span>
      </div>
      <div v-else class="csv-preview__table-wrap">
        <table class="csv-preview__table">
          <tbody>
            <tr v-for="(row, ri) in rows" :key="ri">
              <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.csv-preview {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: rgb(var(--v-theme-surface));
}
.csv-preview__placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px;
}
.csv-preview__placeholder--error {
  color: rgb(var(--v-theme-error));
}
.csv-preview__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  font-size: 12px;
  opacity: 0.85;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.csv-preview__truncated {
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.csv-preview__table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 8px 8px;
}
.csv-preview__table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
  font-family: ui-monospace, monospace;
}
.csv-preview__table td {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  padding: 3px 6px;
  vertical-align: top;
  white-space: pre;
}
</style>
