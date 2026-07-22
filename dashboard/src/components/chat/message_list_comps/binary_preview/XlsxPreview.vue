<!-- Author: elecvoid243, 2026-07-22
     Spec: docs/superpowers/specs/2026-07-22-binary-preview-design.md §6.3
     XLSX rendering via SheetJS (xlsx) — we use the bundled xlsx.mjs
     so the parser runs entirely in the browser. Sheets are listed as
     tabs across the top; the active sheet is rendered as a plain
     HTML table. v1 loads the whole workbook eagerly (no sheet
     lazy-loading); most workspace spreadsheets are small (<1MB).
     Note: the plan originally specified exceljs, but the dependency
     actually added in Task 5 was SheetJS `xlsx` (see
     package.json / pnpm-lock.yaml). We adapt to the installed
     library rather than pulling in a second XLSX parser. -->
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import { read, utils, type WorkBook } from "xlsx";

interface SheetData {
  name: string;
  rows: string[][];
}

const props = defineProps<{ blob: Blob }>();
const { tm } = useModuleI18n("features/chat");

const sheets = ref<SheetData[]>([]);
const currentSheet = ref<number>(0);
const error = ref<string | null>(null);
const loading = ref<boolean>(false);

let loadToken = 0;

async function loadWorkbook(): Promise<void> {
  const token = ++loadToken;
  if (!props.blob) {
    error.value = "decode_failed";
    return;
  }
  loading.value = true;
  error.value = null;
  sheets.value = [];
  currentSheet.value = 0;
  try {
    const buf = await props.blob.arrayBuffer();
    if (token !== loadToken) return;
    // `type: "array"` accepts an ArrayBuffer / Uint8Array and
    // returns a synchronous WorkBook (no streaming).
    const wb: WorkBook = read(new Uint8Array(buf), { type: "array" });
    if (token !== loadToken) return;
    const result: SheetData[] = (wb.SheetNames ?? []).map((name) => {
      const ws = wb.Sheets[name];
      // header:1 returns an array-of-arrays where every row is data
      // (no key inference); undefined cells stay as undefined so the
      // renderer can normalise to "".
      const rowsRaw = utils.sheet_to_json<string[]>(ws, {
        header: 1,
        defval: "",
        raw: false,
        blankrows: false,
      });
      return {
        name,
        rows: rowsRaw.map((row) =>
          Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [],
        ),
      };
    });
    sheets.value = result;
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
    void loadWorkbook();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  loadToken++;
});
</script>

<template>
  <div class="xlsx-preview">
    <div
      v-if="error"
      class="xlsx-preview__placeholder xlsx-preview__placeholder--error"
    >
      <v-icon icon="mdi-alert-circle-outline" />
      <span>{{
        tm(`spcodeProjectLoad.documentManager.binary.errors.${error}`, {
          reason: error,
        })
      }}</span>
    </div>
    <div
      v-else-if="loading && sheets.length === 0"
      class="xlsx-preview__placeholder"
    >
      <v-progress-circular indeterminate size="20" />
      <span>{{ tm("spcodeProjectLoad.documentManager.raw.loading") }}</span>
    </div>
    <template v-else-if="sheets.length > 0">
      <div class="xlsx-preview__tabs">
        <button
          v-for="(s, i) in sheets"
          :key="s.name"
          class="xlsx-preview__tab"
          :class="{ 'is-active': i === currentSheet }"
          type="button"
          @click="currentSheet = i"
        >
          {{ s.name }}
        </button>
      </div>
      <div class="xlsx-preview__sheet-label">
        {{
          tm(
            "spcodeProjectLoad.documentManager.binaryPreview.xlsx.sheetLabel",
            { current: currentSheet + 1, total: sheets.length },
          )
        }}
      </div>
      <div
        v-if="sheets[currentSheet].rows.length === 0"
        class="xlsx-preview__empty"
      >
        {{
          tm("spcodeProjectLoad.documentManager.binaryPreview.xlsx.emptySheet")
        }}
      </div>
      <div v-else class="xlsx-preview__table-wrap">
        <table class="xlsx-preview__table">
          <tbody>
            <tr v-for="(row, ri) in sheets[currentSheet].rows" :key="ri">
              <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.xlsx-preview {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: rgb(var(--v-theme-surface));
}
.xlsx-preview__placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px;
}
.xlsx-preview__placeholder--error {
  color: rgb(var(--v-theme-error));
}
.xlsx-preview__tabs {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  flex-wrap: wrap;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.xlsx-preview__tab {
  padding: 4px 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  border-radius: 4px;
  color: rgb(var(--v-theme-on-surface));
}
.xlsx-preview__tab.is-active {
  background: rgba(var(--v-theme-primary), 0.15);
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
}
.xlsx-preview__sheet-label {
  padding: 6px 12px;
  font-size: 12px;
  opacity: 0.7;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.xlsx-preview__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  opacity: 0.5;
  font-size: 13px;
}
.xlsx-preview__table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 8px 8px;
}
.xlsx-preview__table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}
.xlsx-preview__table td {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  padding: 4px 8px;
  vertical-align: top;
}
</style>
