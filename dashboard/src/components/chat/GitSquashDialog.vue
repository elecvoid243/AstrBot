<!-- Author: elecvoid243 @ 2026-08-03
     Spec: docs/superpowers/specs/2026-08-03-git-squash-design.md §4.3
     Squash dialog: lists the selected commits (oldest → newest) with an
     editable message pre-filled with the concatenated subjects. Cloned
     from GitCherryPickDialog.vue (v-model + loading + submit pattern).

     2026-08-03 AI-generate: the 中文/EN toggle + "AI 生成" button are
     cloned from GitCommitDialog.vue, but the prompt context is ONLY
     the historical commit messages (subject + body) — no git diff is
     fetched or sent (user requirement 2026-08-03).

     2026-08-09 provider selector: cloned from GitCommitDialog — shares
     the same persisted key (astrbot.spcode.gitDiffSidebar.commitProviderId)
     so commit + squash message generation use ONE provider preference.
     The btw call now forwards providerId; __auto__ keeps the old
     "follow the session default provider" behaviour. -->
<template>
  <v-dialog
    :model-value="modelValue"
    persistent
    max-width="560"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card id="git-squash-dialog-card">
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">
        {{ tm("spcodeProjectLoad.diffSidebar.squash.dialogTitle") }}
      </v-card-title>
      <v-card-text class="pt-4">
        <div class="git-squash-dialog-list">
          <div
            v-for="c in commits"
            :key="c.sha"
            class="git-squash-dialog-item"
          >
            <span class="git-squash-dialog-sha">{{ c.sha.slice(0, 7) }}</span>
            <span class="git-squash-dialog-subject">{{ c.subject }}</span>
          </div>
        </div>
        <div class="git-squash-dialog-label-row">
          <label class="git-squash-dialog-label">
            {{ tm("spcodeProjectLoad.diffSidebar.squash.messageLabel") }}
          </label>
          <div class="git-squash-dialog-generate-controls">
            <v-select
              v-if="providerOptions.length > 0"
              v-model="providerId"
              :items="[
                {
                  id: AUTO_PROVIDER,
                  label: tm(
                    'spcodeProjectLoad.diffSidebar.gitWorkflow.commit.dialog.providerAuto',
                  ),
                },
                ...providerOptions,
              ]"
              item-value="id"
              item-title="label"
              :label="
                tm(
                  'spcodeProjectLoad.diffSidebar.gitWorkflow.commit.dialog.providerLabel',
                )
              "
              density="compact"
              hide-details
              variant="outlined"
              class="git-squash-dialog-provider-select"
              :disabled="btw.isGenerating.value"
              attach="#git-squash-dialog-card"
            />
            <v-btn-toggle
              v-model="msgLanguage"
              mandatory
              density="compact"
              variant="tonal"
              :aria-label="
                tm(
                  'spcodeProjectLoad.diffSidebar.gitWorkflow.commit.dialog.langToggleAria',
                )
              "
            >
              <v-btn value="zh" size="x-small">
                {{
                  tm(
                    "spcodeProjectLoad.diffSidebar.gitWorkflow.commit.dialog.langZh",
                  )
                }}
              </v-btn>
              <v-btn value="en" size="x-small">
                {{
                  tm(
                    "spcodeProjectLoad.diffSidebar.gitWorkflow.commit.dialog.langEn",
                  )
                }}
              </v-btn>
            </v-btn-toggle>
            <v-btn
              variant="text"
              size="small"
              color="primary"
              prepend-icon="mdi-auto-fix"
              :loading="btw.isGenerating.value"
              :disabled="!canGenerate"
              :aria-label="
                tm(
                  'spcodeProjectLoad.diffSidebar.gitWorkflow.commit.dialog.generateAria',
                )
              "
              @click="onGenerate"
            >
              {{
                tm(
                  "spcodeProjectLoad.diffSidebar.gitWorkflow.commit.dialog.generate",
                )
              }}
            </v-btn>
          </div>
        </div>
        <div
          v-if="btw.isGenerating.value"
          class="git-squash-dialog-generating-hint"
        >
          <v-progress-circular
            indeterminate
            size="14"
            width="2"
            color="primary"
          />
          <span>
            {{
              tm(
                "spcodeProjectLoad.diffSidebar.gitWorkflow.commit.dialog.generating",
              )
            }}
          </span>
        </div>
        <v-textarea
          v-model="messageInput"
          :placeholder="
            tm(
              'spcodeProjectLoad.diffSidebar.gitWorkflow.commit.dialog.messagePlaceholder',
            )
          "
          :error-messages="messageError ? [messageError] : []"
          density="compact"
          variant="outlined"
          rows="4"
          auto-grow
          autocomplete="off"
          name="git-squash-message"
          hide-details="auto"
        />
        <div v-if="generateErrorKey" class="git-squash-dialog-generate-error">
          {{
            tm(
              `spcodeProjectLoad.diffSidebar.gitWorkflow.commit.dialog.generateError.${generateErrorKey}`,
            )
          }}
        </div>
        <div class="git-squash-dialog-warning">
          {{ tm("spcodeProjectLoad.diffSidebar.squash.historyRewriteWarning") }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="loading"
          @click="emit('update:modelValue', false)"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.squash.cancel") }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :loading="loading"
          @click="onSubmit"
        >
          {{ tm("spcodeProjectLoad.diffSidebar.squash.submit") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n, useModuleI18n } from "@/i18n/composables";
import {
  buildSquashMessagePrompt,
  parseCommitMessageReply,
} from "@/composables/commitMessagePrompt";
import { useSpcodeBtw } from "@/composables/useSpcodeBtw";
import { listProviders } from "@/api/generated/openapi-v1";
import type { SquashPayloadCommit } from "./message_list_comps/GitLogView.vue";

const props = defineProps<{
  modelValue: boolean;
  /** Selected commits, oldest → newest (drives both the list, the
   *  message pre-fill, and the AI-generate prompt context). */
  commits: SquashPayloadCommit[];
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "submit", p: { shas: string[]; message: string }): void;
}>();

const { tm } = useModuleI18n("features/chat");

const messageInput = ref("");
const messageError = ref("");

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      // 2026-08-03 revision: start EMPTY. The concatenated-subjects
      // pre-fill was dropped per user feedback — the user either
      // types the message or clicks "AI 生成" (which still receives
      // the historical messages as its prompt context).
      messageInput.value = "";
      messageError.value = "";
      generateErrorKey.value = null;
      void loadProviders();
    } else {
      // Generation never blocks closing (btw is side-effect-free);
      // abort it so a late resolution can't write into a closed
      // dialog (mirrors GitCommitDialog.onCancel).
      btw.cancel();
    }
  },
);

// ── AI message generation (2026-08-03) ───────────────────────────
// Context: ONLY the historical commit messages (subject + body) of
// the selected commits — no diff is fetched or embedded. Reuses the
// commit dialog's language preference key so both surfaces share
// one setting.
const { locale } = useI18n();
const btw = useSpcodeBtw();

const COMMIT_MSG_LANG_KEY = "astrbot.spcode.gitDiffSidebar.commitMsgLang";
type MsgLang = "zh" | "en";

function loadMsgLang(): MsgLang {
  try {
    const v = localStorage.getItem(COMMIT_MSG_LANG_KEY);
    if (v === "zh" || v === "en") return v;
  } catch {
    /* localStorage may be unavailable (private mode) — fall through */
  }
  return locale.value === "zh-CN" ? "zh" : "en";
}

const msgLanguage = ref<MsgLang>(loadMsgLang());
watch(msgLanguage, (v) => {
  try {
    localStorage.setItem(COMMIT_MSG_LANG_KEY, v);
  } catch {
    /* no-op */
  }
});

// ── Provider selection (2026-08-09) ─────────────────────────────
// Mirrors GitCommitDialog: the SAME localStorage key is shared so
// commit + squash message generation follow one provider preference.
// "__auto__" keeps the pre-existing "follow the session default
// provider" behaviour (btw omits provider_id for it).
const COMMIT_PROVIDER_KEY = "astrbot.spcode.gitDiffSidebar.commitProviderId";
const AUTO_PROVIDER = "__auto__";

function loadProviderId(): string {
  try {
    const v = localStorage.getItem(COMMIT_PROVIDER_KEY);
    if (v && v !== AUTO_PROVIDER) return v;
  } catch {
    /* localStorage may be unavailable (private mode) — fall through */
  }
  return AUTO_PROVIDER;
}

const providerId = ref<string>(loadProviderId());
watch(providerId, (v) => {
  try {
    localStorage.setItem(COMMIT_PROVIDER_KEY, v);
  } catch {
    /* no-op */
  }
});

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
    const providers = (
      resp.data?.data as { providers?: any[] } | undefined
    )?.providers;
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
    // API failure degrades to "Auto" only; existing behaviour unchanged.
    providerOptions.value = [];
  }
}

// i18n key suffix of the last generate failure; null = no error.
const generateErrorKey = ref<string | null>(null);

const canGenerate = computed(
  () =>
    props.commits.length >= 2 &&
    !props.loading &&
    !btw.isGenerating.value,
);

async function onGenerate(): Promise<void> {
  if (!canGenerate.value) return;
  generateErrorKey.value = null;
  const prompt = buildSquashMessagePrompt({
    language: msgLanguage.value,
    commits: props.commits,
  });
  // Deliberately context-free (no umo) — same rationale as
  // GitCommitDialog: self-contained prompts follow the strict JSON
  // contract more reliably.
  const result = await btw.ask({
    prompt,
    providerId: providerId.value,
  });
  if (result.ok) {
    // Tolerant parse of the JSON contract; fall back to the
    // fence-stripped raw reply so the user can still edit.
    messageInput.value =
      parseCommitMessageReply(result.reply) ??
      result.reply
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
    messageError.value = "";
    return;
  }
  if (result.reason === "aborted") return; // dialog closed mid-flight
  generateErrorKey.value =
    result.reason === "no_provider" ||
    result.reason === "empty_response" ||
    result.reason === "llm_error" ||
    result.reason === "network" ||
    result.reason === "provider_not_found" ||
    result.reason === "provider_type_invalid"
      ? result.reason
      : "unknown";
}

onBeforeUnmount(() => {
  btw.dispose();
});

function onSubmit(): void {
  messageError.value = "";
  const message = messageInput.value.trim();
  if (!message) {
    messageError.value = tm(
      "spcodeProjectLoad.diffSidebar.squash.messageRequired",
    );
    return;
  }
  emit("submit", { shas: props.commits.map((c) => c.sha), message });
}
</script>

<style scoped>
.git-squash-dialog-list {
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 4px;
  padding: 4px 8px;
}
.git-squash-dialog-item {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.8;
}
.git-squash-dialog-sha {
  font-family: monospace;
  color: rgba(var(--v-theme-on-surface), 0.6);
  flex-shrink: 0;
}
.git-squash-dialog-subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.git-squash-dialog-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
  margin-bottom: 4px;
}
.git-squash-dialog-label {
  font-size: 12px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.git-squash-dialog-generate-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.git-squash-dialog-provider-select {
  max-width: 200px;
  min-width: 140px;
  font-size: 12px;
}
.git-squash-dialog-generating-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.git-squash-dialog-generate-error {
  margin-top: 4px;
  font-size: 12px;
  color: rgb(var(--v-theme-error));
}
.git-squash-dialog-warning {
  margin-top: 8px;
  font-size: 11.5px;
  color: rgb(var(--v-theme-warning));
}
</style>
<!-- v-menu 下拉列表经由 attach 传送到 v-card 内；此处用全局（非 scoped）
     样式覆盖下拉项默认 14px 字号，并让超长 provider 名横向滚动。 -->
<style>
#git-squash-dialog-card .v-list-item {
  min-height: 32px;
}
#git-squash-dialog-card .v-list-item-title {
  font-size: 12px;
  line-height: 1.4;
  max-width: 520px;
  overflow-x: auto;
  white-space: nowrap;
}
#git-squash-dialog-card .v-select .v-field {
  font-size: 12px;
}
</style>
