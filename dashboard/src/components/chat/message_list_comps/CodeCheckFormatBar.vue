<!--
  CodeCheckFormatBar
  ─────────────────────────────────────────────────────────────────────
  One-click code check / auto-fix / format toolbar for the workspace
  file preview.

  Three actions, backed by the spcode plugin Web API:
    - "Check"     → POST /spcode/code-check            (read-only)
    - "Auto-fix"  → POST /spcode/code-check {fix:true} (ruff check --fix)
    - "Format"    → POST /spcode/code-format           (dry-run, then apply)

  Format is a two-step flow for safety: the button always runs a dry-run
  first (check=true) and shows the unified diff; the user then clicks
  "Apply formatting" to write back (check=false). Auto-fix only shows for
  Python files (ruff is the only linter that supports --fix). On any
  write-back the parent is notified via `formatted` so it can re-fetch.

  All user-facing copy is localized under
  `spcodeProjectLoad.fileBrowser.codeTools`.

  Author: elecvoid243
  Date: 2026-08-13
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import { useSpcodeCodeCheck } from "@/composables/useSpcodeCodeCheck";
import { useSpcodeCodeFormat } from "@/composables/useSpcodeCodeFormat";
import type { CodeCheckSnapshot } from "@/composables/parseSpcodeCodeCheck";
import type { CodeFormatSnapshot } from "@/composables/parseSpcodeCodeFormat";
import CodeCheckResultList from "./spcode_tools/CodeCheckResultList.vue";
import DiffPreview from "./DiffPreview.vue";

const props = withDefaults(
  defineProps<{
    filePath: string;
    worktree?: string | null;
    isDark?: boolean;
  }>(),
  { worktree: null, isDark: false },
);

const emit = defineEmits<{
  (e: "formatted"): void;
}>();

const { tm } = useModuleI18n("features/chat");
const I18N = "spcodeProjectLoad.fileBrowser.codeTools";

const codeCheck = useSpcodeCodeCheck();
const codeFormat = useSpcodeCodeFormat();

/** Panel state machine (discriminated union). */
type PanelState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "check-done"; snapshot: CodeCheckSnapshot }
  | { kind: "check-error"; reason: string; stderr?: string }
  | { kind: "fixing" }
  | { kind: "fix-error"; reason: string; stderr?: string }
  | { kind: "format-previewing" }
  | { kind: "format-preview"; snapshot: CodeFormatSnapshot }
  | { kind: "format-error"; reason: string; stderr?: string }
  | { kind: "format-applying" };

const state = ref<PanelState>({ kind: "idle" });

/** Extensions backed by ruff / cpplint / cppcheck / astyle. */
const CODE_EXTENSIONS = [
  ".py",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".cxx",
  ".hpp",
  ".hxx",
  ".hh",
  ".java",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".cs",
];

const isCodeFile = computed(() => {
  const p = props.filePath.toLowerCase();
  return CODE_EXTENSIONS.some((ext) => p.endsWith(ext));
});

/** Auto-fix only works for Python (ruff --fix). */
const isPythonFile = computed(() => props.filePath.toLowerCase().endsWith(".py"));

const isBusy = computed(
  () =>
    state.value.kind === "checking" ||
    state.value.kind === "fixing" ||
    state.value.kind === "format-previewing" ||
    state.value.kind === "format-applying",
);

const checkSnapshot = computed<CodeCheckSnapshot | null>(() =>
  state.value.kind === "check-done" ? state.value.snapshot : null,
);
const checkError = computed<{ reason: string; stderr?: string } | null>(() =>
  state.value.kind === "check-error"
    ? { reason: state.value.reason, stderr: state.value.stderr }
    : null,
);
const fixError = computed<{ reason: string; stderr?: string } | null>(() =>
  state.value.kind === "fix-error"
    ? { reason: state.value.reason, stderr: state.value.stderr }
    : null,
);
const formatSnapshot = computed<CodeFormatSnapshot | null>(() =>
  state.value.kind === "format-preview" ? state.value.snapshot : null,
);
const formatError = computed<{ reason: string; stderr?: string } | null>(() =>
  state.value.kind === "format-error"
    ? { reason: state.value.reason, stderr: state.value.stderr }
    : null,
);

/** C/C++ merge mode blocks (linters.cppcheck / linters.cpplint). */
const checkMerge = computed<Record<string, unknown>>(() => {
  const s = checkSnapshot.value;
  const linters = s?.linters;
  if (linters && typeof linters === "object") {
    return linters as Record<string, unknown>;
  }
  return {};
});

const isCheckMerge = computed(
  () => checkMerge.value.cppcheck != null || checkMerge.value.cpplint != null,
);

/** Single-linter block (flat issues wrapped into CodeCheckResultList shape). */
const checkSingleBlock = computed<Record<string, unknown> | null>(() => {
  const s = checkSnapshot.value;
  if (!s || isCheckMerge.value) return null;
  return {
    available: true,
    ok: true,
    issues: s.issues,
    count: s.count,
    error: "",
  };
});

const checkStatusText = computed(() => {
  const s = checkSnapshot.value;
  if (!s) return "";
  if (s.fixed) {
    const fixed = s.fixedCount ?? 0;
    if (fixed > 0) {
      return tm(`${I18N}.fixedCount`, { count: fixed, remaining: s.count });
    }
    if (s.count === 0) return tm(`${I18N}.noIssues`);
    return tm(`${I18N}.fixNoChange`, { remaining: s.count });
  }
  if (s.count === 0) return tm(`${I18N}.noIssues`);
  return tm(`${I18N}.issueCount`, { count: s.count });
});

const checkStatusClass = computed(() => {
  const s = checkSnapshot.value;
  if (!s) return "";
  return s.count === 0 ? "cdfb-clean" : "cdfb-warn";
});

const formatDiffHeader = computed(() => {
  const s = formatSnapshot.value;
  if (!s) return "";
  return tm(`${I18N}.previewDiff`, { formatter: s.formatter || "formatter" });
});

async function runCheck(): Promise<void> {
  if (!isCodeFile.value || isBusy.value) return;
  state.value = { kind: "checking" };
  const res = await codeCheck.check({
    path: props.filePath,
    worktree: props.worktree ?? null,
  });
  if (res.ok) {
    state.value = { kind: "check-done", snapshot: res.snapshot };
  } else {
    state.value = {
      kind: "check-error",
      reason: res.reason,
      stderr: res.stderr,
    };
  }
}

async function runAutoFix(): Promise<void> {
  if (!isPythonFile.value || isBusy.value) return;
  state.value = { kind: "fixing" };
  const res = await codeCheck.check({
    path: props.filePath,
    worktree: props.worktree ?? null,
    fix: true,
  });
  if (res.ok) {
    state.value = { kind: "check-done", snapshot: res.snapshot };
    if (res.snapshot.fixed && (res.snapshot.fixedCount ?? 0) > 0) {
      emit("formatted");
    }
  } else {
    state.value = {
      kind: "fix-error",
      reason: res.reason,
      stderr: res.stderr,
    };
  }
}

async function runFormat(): Promise<void> {
  if (!isCodeFile.value || isBusy.value) return;
  state.value = { kind: "format-previewing" };
  const res = await codeFormat.format({
    path: props.filePath,
    worktree: props.worktree ?? null,
    check: true,
  });
  if (res.ok) {
    state.value = { kind: "format-preview", snapshot: res.snapshot };
  } else {
    state.value = {
      kind: "format-error",
      reason: res.reason,
      stderr: res.stderr,
    };
  }
}

async function applyFormat(): Promise<void> {
  if (state.value.kind !== "format-preview") return;
  state.value = { kind: "format-applying" };
  const res = await codeFormat.format({
    path: props.filePath,
    worktree: props.worktree ?? null,
    check: false,
  });
  if (res.ok) {
    state.value = { kind: "idle" };
    emit("formatted");
  } else {
    state.value = {
      kind: "format-error",
      reason: res.reason,
      stderr: res.stderr,
    };
  }
}

function close(): void {
  state.value = { kind: "idle" };
}

onBeforeUnmount(() => {
  codeCheck.dispose();
  codeFormat.dispose();
});
</script>

<template>
  <div v-if="isCodeFile" class="code-check-format-bar">
    <!-- 操作工具条 -->
    <div class="cdfb-toolbar">
      <button
        type="button"
        class="cdfb-btn"
        :disabled="isBusy"
        @click="runCheck"
      >
        <v-icon size="14">mdi-shield-check-outline</v-icon>
        <span>{{ tm(`${I18N}.check`) }}</span>
      </button>
      <button
        type="button"
        class="cdfb-btn"
        :disabled="isBusy"
        @click="runFormat"
      >
        <v-icon size="14">mdi-auto-fix</v-icon>
        <span>{{ tm(`${I18N}.format`) }}</span>
      </button>

      <v-progress-circular
        v-if="isBusy"
        indeterminate
        size="14"
        color="primary"
        class="cdfb-spinner"
      />

      <button
        v-if="state.kind !== 'idle' && !isBusy"
        type="button"
        class="cdfb-btn cdfb-btn--ghost"
        :aria-label="tm(`${I18N}.close`)"
        @click="close"
      >
        <v-icon size="14">mdi-close</v-icon>
      </button>
    </div>

    <!-- 检查结果（含 auto-fix 后的剩余结果） -->
    <div v-if="checkSnapshot" class="cdfb-result">
      <div class="cdfb-result-header" :class="checkStatusClass">
        <v-icon size="14">
          {{ checkSnapshot.count === 0 ? "mdi-check-circle-outline" : "mdi-alert-outline" }}
        </v-icon>
        <span class="cdfb-result-title">{{ checkStatusText }}</span>
        <span v-if="checkSnapshot.linter" class="cdfb-chip">
          {{ checkSnapshot.linter }}
        </span>
        <span class="cdfb-chip cdfb-chip--muted">
          {{ checkSnapshot.elapsedMs }}ms
        </span>
      </div>

      <div
        v-if="checkSnapshot.count > 0 && isPythonFile && !checkSnapshot.fixed"
        class="cdfb-fix-actions"
      >
        <button
          type="button"
          class="cdfb-btn cdfb-btn--primary"
          :disabled="isBusy"
          @click="runAutoFix"
        >
          <v-icon size="13">mdi-auto-fix</v-icon>
          <span>{{ tm(`${I18N}.autoFix`) }}</span>
        </button>
      </div>

      <div v-if="checkSnapshot.count === 0" class="cdfb-clean-note">
        <v-icon size="13">mdi-check-circle-outline</v-icon>
        <span>{{ tm(`${I18N}.noIssues`) }}</span>
      </div>
      <template v-else-if="isCheckMerge">
        <CodeCheckResultList
          v-if="checkMerge.cppcheck"
          title="cppcheck"
          icon="mdi-shield-search"
          :data="checkMerge.cppcheck"
        />
        <CodeCheckResultList
          v-if="checkMerge.cpplint"
          title="cpplint"
          icon="mdi-text-box-check-outline"
          :data="checkMerge.cpplint"
        />
      </template>
      <CodeCheckResultList
        v-else-if="checkSingleBlock"
        title="issues"
        icon="mdi-shield-search"
        :data="checkSingleBlock"
      />
    </div>

    <!-- 检查错误 -->
    <div v-if="checkError" class="cdfb-result cdfb-error">
      <div class="cdfb-result-header">
        <v-icon size="14">mdi-alert-circle-outline</v-icon>
        <span class="cdfb-result-title">
          {{ tm(`${I18N}.checkFailed`, { reason: checkError.reason }) }}
        </span>
      </div>
      <pre v-if="checkError.stderr" class="cdfb-stderr">{{ checkError.stderr }}</pre>
    </div>

    <!-- auto-fix 错误 -->
    <div v-if="fixError" class="cdfb-result cdfb-error">
      <div class="cdfb-result-header">
        <v-icon size="14">mdi-alert-circle-outline</v-icon>
        <span class="cdfb-result-title">
          {{ tm(`${I18N}.fixFailed`, { reason: fixError.reason }) }}
        </span>
      </div>
      <pre v-if="fixError.stderr" class="cdfb-stderr">{{ fixError.stderr }}</pre>
    </div>

    <!-- 格式化预览 -->
    <div v-if="formatSnapshot" class="cdfb-result">
      <div class="cdfb-result-header" :class="formatSnapshot.changed ? 'cdfb-warn' : 'cdfb-clean'">
        <v-icon size="14">
          {{ formatSnapshot.changed ? "mdi-eye-outline" : "mdi-check-circle-outline" }}
        </v-icon>
        <span class="cdfb-result-title">
          {{
            formatSnapshot.changed
              ? tm(`${I18N}.preview`)
              : tm(`${I18N}.alreadyFormatted`)
          }}
        </span>
        <span v-if="formatSnapshot.formatter" class="cdfb-chip">
          {{ formatSnapshot.formatter }}
        </span>
      </div>

      <div v-if="!formatSnapshot.changed" class="cdfb-clean-note">
        <v-icon size="13">mdi-check-circle-outline</v-icon>
        <span>
          {{
            tm(`${I18N}.alreadyConforms`, {
              formatter: formatSnapshot.formatter || "formatter",
            })
          }}
        </span>
      </div>
      <template v-else>
        <DiffPreview
          v-if="formatSnapshot.diffSummary"
          :content="formatSnapshot.diffSummary"
          :file-path="props.filePath"
          :summary="formatDiffHeader"
          :is-dark="props.isDark"
          :max-lines="25"
          :collapsible="true"
        />
        <div class="cdfb-format-actions">
          <button
            type="button"
            class="cdfb-btn cdfb-btn--primary"
            @click="applyFormat"
          >
            <v-icon size="14">mdi-check-circle-outline</v-icon>
            <span>{{ tm(`${I18N}.applyFormatting`) }}</span>
          </button>
        </div>
      </template>
    </div>

    <!-- 格式化错误 -->
    <div v-if="formatError" class="cdfb-result cdfb-error">
      <div class="cdfb-result-header">
        <v-icon size="14">mdi-alert-circle-outline</v-icon>
        <span class="cdfb-result-title">
          {{ tm(`${I18N}.formatFailed`, { reason: formatError.reason }) }}
        </span>
      </div>
      <pre v-if="formatError.stderr" class="cdfb-stderr">{{ formatError.stderr }}</pre>
    </div>
  </div>
</template>

<style scoped>
.code-check-format-bar {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  font-size: 12px;
}

/* ── 工具条 ── */
.cdfb-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
}
.cdfb-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: rgb(var(--v-theme-primary));
  font-size: 12px;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}
.cdfb-btn:hover:not(:disabled) {
  background: rgba(var(--v-theme-primary), 0.08);
}
.cdfb-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.cdfb-btn--primary {
  background: rgba(var(--v-theme-primary), 0.12);
  border-color: rgba(var(--v-theme-primary), 0.4);
}
.cdfb-btn--primary:hover:not(:disabled) {
  background: rgba(var(--v-theme-primary), 0.2);
}
.cdfb-btn--ghost {
  margin-left: auto;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cdfb-btn--ghost:hover:not(:disabled) {
  color: rgba(var(--v-theme-on-surface), 0.85);
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.cdfb-spinner {
  margin-left: 4px;
}

/* ── 结果面板 ── */
.cdfb-result {
  padding: 6px 12px 8px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  max-height: 320px;
  overflow-y: auto;
}
.cdfb-result-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.cdfb-result-title {
  font-weight: 500;
}
.cdfb-chip {
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
  font-family: ui-monospace, monospace;
  font-size: 10.5px;
}
.cdfb-chip--muted {
  margin-left: 0;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.cdfb-result-header.cdfb-clean {
  color: #2da44e;
}
.cdfb-result-header.cdfb-warn {
  color: #b58400;
}
.cdfb-error .cdfb-result-header {
  color: #cf222e;
}

.cdfb-clean-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 6px 10px;
  border-radius: 4px;
  background: rgba(70, 200, 70, 0.06);
  color: #2da44e;
  font-size: 11.5px;
}
.cdfb-stderr {
  margin: 6px 0 0;
  padding: 6px 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.cdfb-fix-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.cdfb-format-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
