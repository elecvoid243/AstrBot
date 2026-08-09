<!-- Author: elecvoid243
     Date: 2026-08-09
     Spec: docs/superpowers/specs/2026-08-09-changelog-generate-design.md §5.2
     Changelog generation dialog: version + provider + editable
     instruction → btw LLM call → editable preview → save to
     <project>/changelogs/vX.Y.Z.md via /spcode/file-write. -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import { listProviders } from "@/api/generated/openapi-v1";
import { useSpcodeBtw } from "@/composables/useSpcodeBtw";
import { useSpcodeFileBrowser } from "@/composables/useSpcodeFileBrowser";
import { useSpcodeFileWrite } from "@/composables/useSpcodeFileWrite";
import { useSpcodeGitShow } from "@/composables/useSpcodeGitShow";
import {
  CHANGELOG_DIR,
  DEFAULT_CHANGELOG_INSTRUCTION,
  buildChangelogPrompt,
  changelogFilename,
  cleanChangelogReply,
  isSemver,
  pickLatestChangelog,
  type ChangelogPromptCommit,
  type ChangelogPromptReference,
} from "@/composables/changelogPrompt";
import type { SquashPayloadCommit } from "./message_list_comps/GitLogView.vue";

const props = defineProps<{
  modelValue: boolean;
  /** Selected commits, oldest → newest. */
  commits: SquashPayloadCommit[];
  worktree: string | null;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  /** Fired after a successful save; payload is the repo-relative path. */
  (e: "saved", path: string): void;
  /** Fired on ANY close path (save / cancel / scrim) so the parent can
   *  exit the log-view selection mode. */
  (e: "close"): void;
}>();

const { tm } = useModuleI18n("features/chat");
const I18N = "spcodeProjectLoad.diffSidebar.changelog";

// ── Version ──
const version = ref("");
const versionInvalid = computed(
  () => version.value.trim().length > 0 && !isSemver(version.value),
);

// ── Provider selector (mirrors GitCommitDialog) ──
const AUTO_PROVIDER = "__auto__";
const providerId = ref<string>(AUTO_PROVIDER);
interface ProviderOption {
  id: string;
  label: string;
}
const providerOptions = ref<ProviderOption[]>([]);

async function loadProviders(): Promise<void> {
  try {
    const resp = await listProviders({
      query: { capability: "chat", enabled: true },
    });
    const providers = (resp.data?.data as { providers?: any[] } | undefined)
      ?.providers;
    if (!Array.isArray(providers)) {
      providerOptions.value = [];
      return;
    }
    providerOptions.value = providers
      .filter((p) => p && typeof p.id === "string")
      .map((p) => ({
        id: p.id,
        label: `${p.name || p.id}${
          typeof p.model === "string" && p.model ? ` (${p.model})` : ""
        }`,
      }));
  } catch {
    providerOptions.value = [];
  }
}

// ── Instruction (editable, persisted) ──
const INSTRUCTION_KEY = "astrbot.spcode.gitDiffSidebar.changelogInstruction";
const instruction = ref(loadInstruction());

function loadInstruction(): string {
  try {
    const v = localStorage.getItem(INSTRUCTION_KEY);
    return v && v.trim() ? v : DEFAULT_CHANGELOG_INSTRUCTION;
  } catch {
    return DEFAULT_CHANGELOG_INSTRUCTION;
  }
}
watch(instruction, (v) => {
  try {
    localStorage.setItem(INSTRUCTION_KEY, v);
  } catch {
    /* storage unavailable — session-only */
  }
});
function onResetInstruction(): void {
  instruction.value = DEFAULT_CHANGELOG_INSTRUCTION;
}

// ── Reference changelog (Part 3) — fetched once per dialog open ──
const fileBrowser = useSpcodeFileBrowser(ref(CHANGELOG_DIR));
const reference = ref<ChangelogPromptReference | null>(null);

async function loadReference(): Promise<void> {
  reference.value = null;
  await fileBrowser.refresh(CHANGELOG_DIR);
  const st = fileBrowser.state.value;
  if (st.kind !== "directory") return; // missing dir / error → no reference
  const name = pickLatestChangelog(st.snapshot.entries);
  if (!name) return;
  await fileBrowser.refresh(`${CHANGELOG_DIR}/${name}`);
  const fst = fileBrowser.state.value;
  if (fst.kind === "file" && typeof fst.snapshot.content === "string") {
    reference.value = {
      filename: `${CHANGELOG_DIR}/${name}`,
      content: fst.snapshot.content,
    };
  }
}

// ── Generation ──
const btw = useSpcodeBtw();
const gitShow = useSpcodeGitShow(computed(() => props.worktree));
const content = ref("");
const generateErrorKey = ref<string | null>(null);
const diffFailedCount = ref(0);

const ERROR_KEYS: Record<string, true> = {
  no_provider: true,
  provider_not_found: true,
  provider_type_invalid: true,
  llm_error: true,
  empty_response: true,
  network: true,
};

async function onGenerate(): Promise<void> {
  generateErrorKey.value = null;
  diffFailedCount.value = 0;

  // 1. Fetch every commit's full patch in parallel; failures degrade.
  const results = await Promise.allSettled(
    props.commits.map((c) => gitShow.fetchFullPatch(c.sha)),
  );
  const promptCommits: ChangelogPromptCommit[] = props.commits.map((c, i) => {
    const settled = results[i];
    const data =
      settled.status === "fulfilled" ? gitShow.getFullPatchData(c.sha) : null;
    const failed = !data || data.patch === null;
    if (failed) diffFailedCount.value++;
    return {
      sha: c.sha,
      subject: c.subject,
      body: c.body ?? null,
      patch: data?.patch ?? null,
      patchTruncated: data?.patchTruncated ?? false,
      patchFailed: failed,
    };
  });

  // 2. Assemble the three-part prompt and ask btw (no umo: pure prompt).
  const prompt = buildChangelogPrompt({
    instruction: instruction.value,
    commits: promptCommits,
    reference: reference.value,
  });
  const result = await btw.ask({ prompt, providerId: providerId.value });
  if (!result.ok) {
    if (result.reason !== "aborted") {
      generateErrorKey.value =
        result.reason in ERROR_KEYS ? result.reason : "unknown";
    }
    return;
  }
  const cleaned = cleanChangelogReply(result.reply);
  if (!cleaned) {
    generateErrorKey.value = "empty_response";
    return;
  }
  content.value = cleaned;
}

// ── Save (existence probe → overwrite confirm → file-write) ──
const fileWrite = useSpcodeFileWrite(computed(() => props.worktree));
const overwriteConfirmOpen = ref(false);
const saveErrorKey = ref<string | null>(null);

const targetPath = computed(
  () => `${CHANGELOG_DIR}/${changelogFilename(version.value)}`,
);
const canSave = computed(
  () =>
    content.value.trim().length > 0 &&
    version.value.trim().length > 0 &&
    !btw.isGenerating.value,
);

async function onSave(): Promise<void> {
  saveErrorKey.value = null;
  await fileBrowser.refresh(targetPath.value);
  if (fileBrowser.state.value.kind === "file") {
    overwriteConfirmOpen.value = true;
    return;
  }
  await doSave();
}

async function doSave(): Promise<void> {
  overwriteConfirmOpen.value = false;
  const r = await fileWrite.save({
    path: targetPath.value,
    content: content.value.trimEnd() + "\n",
  });
  if (r.ok) {
    emit("saved", targetPath.value);
    close();
    return;
  }
  if (r.reason === "aborted") return;
  saveErrorKey.value = r.reason === "network" ? "network" : "unknown";
}

// ── Lifecycle ──
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    // Fresh state on every open; instruction persists via localStorage.
    version.value = "";
    providerId.value = AUTO_PROVIDER;
    content.value = "";
    generateErrorKey.value = null;
    saveErrorKey.value = null;
    diffFailedCount.value = 0;
    void loadProviders();
    void loadReference();
  },
);

function close(): void {
  // Generation never blocks closing (btw is side-effect-free).
  btw.cancel();
  emit("update:modelValue", false);
  emit("close");
}

onBeforeUnmount(() => {
  btw.dispose();
  gitShow.dispose();
  fileBrowser.dispose();
  fileWrite.dispose();
});
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    scrollable
    @update:model-value="(v) => (v ? null : close())"
  >
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">
        {{ tm(`${I18N}.dialogTitle`) }}
      </v-card-title>
      <v-card-text>
        <!-- Selected commits (oldest → newest, read-only) -->
        <div class="changelog-dialog-list">
          <div v-for="c in commits" :key="c.sha" class="changelog-dialog-item">
            <span class="changelog-dialog-sha">{{ c.sha.slice(0, 7) }}</span>
            <span class="changelog-dialog-subject">{{ c.subject }}</span>
          </div>
        </div>

        <v-text-field
          v-model="version"
          :label="tm(`${I18N}.versionLabel`)"
          density="compact"
          variant="outlined"
          hide-details="auto"
          :messages="versionInvalid ? tm(`${I18N}.versionWarning`) : []"
          :warning="versionInvalid"
          class="mb-3"
        />

        <v-select
          v-if="providerOptions.length > 0"
          v-model="providerId"
          :items="[
            { id: AUTO_PROVIDER, label: tm(`${I18N}.providerAuto`) },
            ...providerOptions,
          ]"
          item-value="id"
          item-title="label"
          :label="tm(`${I18N}.providerLabel`)"
          density="compact"
          variant="outlined"
          hide-details
          class="mb-3"
        />

        <div class="changelog-dialog-label-row">
          <label class="changelog-dialog-label">
            {{ tm(`${I18N}.instructionLabel`) }}
          </label>
          <v-btn size="x-small" variant="text" @click="onResetInstruction">
            {{ tm(`${I18N}.instructionReset`) }}
          </v-btn>
        </div>
        <v-textarea
          v-model="instruction"
          density="compact"
          variant="outlined"
          hide-details
          rows="6"
          auto-grow
          max-rows="14"
          class="mb-2"
        />

        <div class="changelog-dialog-reference">
          {{
            reference
              ? tm(`${I18N}.referenceSome`, { file: reference.filename })
              : tm(`${I18N}.referenceNone`)
          }}
        </div>

        <div v-if="diffFailedCount > 0" class="changelog-dialog-warning">
          {{ tm(`${I18N}.diffFailedWarning`, { count: diffFailedCount }) }}
        </div>
        <div v-if="generateErrorKey" class="changelog-dialog-error">
          {{
            generateErrorKey === "unknown"
              ? tm(`${I18N}.error.unknown`, { reason: "unknown" })
              : tm(`${I18N}.error.${generateErrorKey}`)
          }}
        </div>

        <v-btn
          size="small"
          variant="tonal"
          :loading="btw.isGenerating.value"
          :disabled="btw.isGenerating.value"
          class="mt-2"
          @click="onGenerate"
        >
          {{ tm(content ? `${I18N}.regenerate` : `${I18N}.generate`) }}
        </v-btn>
        <div v-if="btw.isGenerating.value" class="changelog-dialog-hint">
          {{ tm(`${I18N}.generatingHint`) }}
        </div>

        <v-textarea
          v-model="content"
          density="compact"
          variant="outlined"
          hide-details
          rows="10"
          auto-grow
          class="changelog-dialog-content mt-3"
        />

        <div v-if="saveErrorKey" class="changelog-dialog-error">
          {{
            saveErrorKey === "network"
              ? tm(`${I18N}.saveError.network`)
              : tm(`${I18N}.saveError.unknown`, { reason: "unknown" })
          }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">
          {{ tm(`${I18N}.cancel`) }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :disabled="!canSave"
          :loading="fileWrite.isSaving.value"
          @click="onSave"
        >
          {{ tm(`${I18N}.save`) }}
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Overwrite confirmation -->
    <v-dialog v-model="overwriteConfirmOpen" max-width="420">
      <v-card>
        <v-card-title class="text-h3 pa-4 pb-0 pl-6">
          {{ tm(`${I18N}.overwriteTitle`) }}
        </v-card-title>
        <v-card-text>
          {{ tm(`${I18N}.overwriteMessage`, { file: targetPath }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="overwriteConfirmOpen = false">
            {{ tm(`${I18N}.cancel`) }}
          </v-btn>
          <v-btn variant="tonal" color="warning" @click="doSave">
            {{ tm(`${I18N}.overwriteOk`) }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<style scoped>
.changelog-dialog-list {
  max-height: 120px;
  overflow-y: auto;
  margin-bottom: 12px;
  font-size: 12px;
}
.changelog-dialog-item {
  display: flex;
  gap: 8px;
  padding: 2px 0;
}
.changelog-dialog-sha {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: rgb(var(--v-theme-primary));
  flex: 0 0 auto;
}
.changelog-dialog-subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.changelog-dialog-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.changelog-dialog-label {
  font-size: 12px;
  opacity: 0.7;
}
.changelog-dialog-reference {
  font-size: 12px;
  opacity: 0.6;
  margin-bottom: 4px;
}
.changelog-dialog-warning {
  font-size: 12px;
  color: rgb(var(--v-theme-warning));
  margin: 4px 0;
}
.changelog-dialog-error {
  font-size: 12px;
  color: rgb(var(--v-theme-error));
  margin: 4px 0;
}
.changelog-dialog-hint {
  font-size: 12px;
  opacity: 0.6;
  margin-top: 4px;
}
.changelog-dialog-content :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
</style>
