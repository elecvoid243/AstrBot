<!--
  GitPushDialog
  ─────────────────────────────────────────────────────────────────────
  Confirmation dialog for POST /spcode/git-push. Dumb component:
  collects the remote / local branch / remote target branch and emits
  submit; the parent (GitDiffSidebar) owns the mutation. Mirrors
  GitPullDialog. The remote target branch may differ from the local
  branch name (refspec `local:remote`); leaving it empty pushes to a
  same-name remote branch.

  API doc: astrbot_plugin_spcode_toolkit docs/api/webapi-git-pull-push-remote-api.md §3
  Author: elecvoid243 @ 2026-08-13
-->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    loading: boolean;
    remotes: string[];
    localBranches: string[];
    currentBranch: string | null;
    /** e.g. "origin/main"; used to prefill remote + branch. */
    upstream: string | null;
  }>(),
  {
    remotes: () => [],
    localBranches: () => [],
    currentBranch: null,
    upstream: null,
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "submit", p: { remote: string; branch: string; remoteBranch: string }): void;
}>();

const { tm } = useModuleI18n("features/chat");
const I18N = "spcodeProjectLoad.diffSidebar.push.dialog";

const remote = ref("");
const branch = ref("");
const remoteBranch = ref("");

/** "origin/main" → { remote: "origin", branch: "main" }; null when malformed. */
function splitUpstream(
  upstream: string | null,
): { remote: string; branch: string } | null {
  if (!upstream) return null;
  const i = upstream.indexOf("/");
  if (i <= 0) return null;
  return { remote: upstream.slice(0, i), branch: upstream.slice(i + 1) };
}

// Reset the form every time the dialog opens.
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    const up = splitUpstream(props.upstream);
    remote.value = up?.remote ?? props.remotes[0] ?? "";
    const upBranch = up?.branch && props.localBranches.includes(up.branch)
      ? up.branch
      : "";
    branch.value = upBranch || (props.currentBranch ?? "");
    remoteBranch.value = "";
  },
);

const canSubmit = computed(
  () => !props.loading && remote.value !== "" && branch.value !== "",
);

function onSubmit(): void {
  if (!canSubmit.value) return;
  emit("submit", {
    remote: remote.value,
    branch: branch.value,
    remoteBranch: remoteBranch.value.trim(),
  });
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    persistent
    max-width="480"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-h3 pa-4 pb-0 pl-6">
        {{ tm(`${I18N}.title`) }}
      </v-card-title>
      <v-card-text class="pt-4">
        <div class="git-push-dialog-info">
          <v-icon size="14" class="git-push-dialog-info-icon">
            mdi-source-branch
          </v-icon>
          <span v-if="upstream" class="git-push-dialog-info-text">
            {{ tm(`${I18N}.upstreamHint`, { upstream }) }}
          </span>
          <span v-else class="git-push-dialog-info-text">
            {{ tm(`${I18N}.noUpstreamHint`) }}
          </span>
        </div>

        <v-select
          v-model="remote"
          :items="remotes"
          :label="tm(`${I18N}.remoteLabel`)"
          density="compact"
          hide-details
          class="mt-3"
        />
        <div v-if="remotes.length === 0" class="git-push-dialog-warn">
          {{ tm(`${I18N}.noRemoteHint`) }}
        </div>

        <v-select
          v-model="branch"
          :items="localBranches"
          :label="tm(`${I18N}.localBranchLabel`)"
          density="compact"
          hide-details
          class="mt-3"
        />

        <v-text-field
          v-model="remoteBranch"
          :label="tm(`${I18N}.remoteBranchLabel`)"
          :placeholder="branch || tm(`${I18N}.remoteBranchPlaceholder`)"
          :hint="tm(`${I18N}.remoteBranchHint`)"
          density="compact"
          persistent-hint
          class="mt-3"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="loading"
          @click="emit('update:modelValue', false)"
        >
          {{ tm(`${I18N}.cancel`) }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :loading="loading"
          :disabled="!canSubmit"
          @click="onSubmit"
        >
          {{ tm(`${I18N}.submit`) }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.git-push-dialog-info {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 4px;
  background: rgba(var(--v-theme-primary), 0.06);
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.git-push-dialog-info-icon {
  color: rgb(var(--v-theme-primary));
  flex-shrink: 0;
}
.git-push-dialog-info-text {
  word-break: break-word;
}
.git-push-dialog-warn {
  margin-top: 4px;
  font-size: 11.5px;
  font-style: italic;
  color: rgba(var(--v-theme-warning), 0.9);
}
</style>
