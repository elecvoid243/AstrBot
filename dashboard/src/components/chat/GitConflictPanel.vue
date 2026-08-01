<!-- Author: elecvoid243 @ 2026-08-01
     Spec: docs/superpowers/specs/2026-08-01-git-merge-cherrypick-conflict-frontend-design.md §4.3
     Conflict banner + resolution panel. Renders only while the polled
     conflict-status snapshot reports inConflict. Mutations go through the
     useSpcodeGitConflict handle passed as a prop (same pattern as
     GitLogView receiving the gitShow handle). -->
<template>
  <!-- The computed below already filters to inConflict-only snapshots, so
       a bare `v-if="snapshot"` is the full guard (also keeps vue-tsc
       narrowing happy for the children). -->
  <div v-if="snapshot" class="git-conflict-panel">
    <!-- Banner: operation + subject + progress; click toggles the panel. -->
    <button
      type="button"
      class="git-conflict-banner"
      @click="expanded = !expanded"
    >
      <v-icon size="14" color="warning">mdi-alert-outline</v-icon>
      <span class="git-conflict-banner-text">
        {{
          tm(
            `spcodeProjectLoad.diffSidebar.conflict.banner.${snapshot.operation ?? "merge"}`,
          )
        }}
        <template v-if="snapshot.operationSubject">
          · {{ snapshot.operationSubject }}
        </template>
      </span>
      <span class="git-conflict-banner-progress">
        {{
          tm("spcodeProjectLoad.diffSidebar.conflict.banner.progress", {
            resolved: snapshot.totalResolved,
            total: snapshot.totalResolved + snapshot.totalConflicted,
          })
        }}
      </span>
      <v-icon size="14">{{
        expanded ? "mdi-chevron-up" : "mdi-chevron-down"
      }}</v-icon>
    </button>

    <div v-if="expanded" class="git-conflict-body">
      <!-- Unresolved files -->
      <div class="git-conflict-group-label">
        {{
          tm("spcodeProjectLoad.diffSidebar.conflict.file.unresolvedGroup", {
            count: snapshot.totalConflicted,
          })
        }}
      </div>
      <div
        v-for="f in snapshot.conflictedFiles"
        :key="f.path"
        class="git-conflict-file"
      >
        <button
          type="button"
          class="git-conflict-file-head"
          @click="toggleFile(f.path)"
        >
          <v-icon size="13">mdi-file-alert-outline</v-icon>
          <span class="git-conflict-file-path">{{ f.path }}</span>
          <span class="git-conflict-file-status">{{ f.status }}</span>
          <v-icon size="13">{{
            openFile === f.path ? "mdi-chevron-up" : "mdi-chevron-down"
          }}</v-icon>
        </button>

        <div v-if="openFile === f.path" class="git-conflict-file-body">
          <!-- Binary / oversized: whole-file only -->
          <div v-if="f.binary || f.truncated" class="git-conflict-note">
            {{
              tm(
                f.binary
                  ? "spcodeProjectLoad.diffSidebar.conflict.file.binary"
                  : "spcodeProjectLoad.diffSidebar.conflict.file.truncated",
              )
            }}
          </div>

          <!-- Hunk list -->
          <template v-else>
            <div v-for="h in f.hunks" :key="h.index" class="git-conflict-hunk">
              <div class="git-conflict-hunk-head">
                <span>L{{ h.startLine }}–{{ h.endLine }}</span>
                <v-radio-group
                  :model-value="choices[f.path]?.[h.index]"
                  density="compact"
                  hide-details
                  inline
                  @update:model-value="setChoice(f.path, h.index, $event)"
                >
                  <v-radio
                    value="ours"
                    :label="
                      tm(
                        'spcodeProjectLoad.diffSidebar.conflict.file.hunkChoiceOurs',
                      )
                    "
                  />
                  <v-radio
                    value="theirs"
                    :label="
                      tm(
                        'spcodeProjectLoad.diffSidebar.conflict.file.hunkChoiceTheirs',
                      )
                    "
                  />
                  <v-radio
                    v-if="h.base !== null"
                    value="base"
                    :label="
                      tm(
                        'spcodeProjectLoad.diffSidebar.conflict.file.hunkChoiceBase',
                      )
                    "
                  />
                </v-radio-group>
              </div>
              <div class="git-conflict-hunk-cols">
                <div class="git-conflict-hunk-col">
                  <div class="git-conflict-hunk-label">
                    {{
                      tm(
                        "spcodeProjectLoad.diffSidebar.conflict.file.oursLabel",
                        { label: h.oursLabel },
                      )
                    }}
                  </div>
                  <pre>{{ h.ours }}</pre>
                </div>
                <div class="git-conflict-hunk-col">
                  <div class="git-conflict-hunk-label">
                    {{
                      tm(
                        "spcodeProjectLoad.diffSidebar.conflict.file.theirsLabel",
                        { label: h.theirsLabel },
                      )
                    }}
                  </div>
                  <pre>{{ h.theirs }}</pre>
                </div>
              </div>
            </div>
          </template>

          <!-- Custom editor (prefilled with the full ours content) -->
          <div v-if="customEditing === f.path" class="git-conflict-custom">
            <v-textarea
              v-model="customContent"
              rows="12"
              auto-grow
              density="compact"
              variant="outlined"
              class="git-conflict-custom-editor"
              name="conflict-custom-content"
            />
            <div class="git-conflict-actions">
              <v-btn size="x-small" variant="text" @click="customEditing = null">
                {{
                  tm(
                    "spcodeProjectLoad.diffSidebar.conflict.file.customCancel",
                  )
                }}
              </v-btn>
              <v-btn
                size="x-small"
                variant="tonal"
                color="primary"
                :disabled="!customContent"
                @click="applyCustom(f.path)"
              >
                {{
                  tm("spcodeProjectLoad.diffSidebar.conflict.file.customApply")
                }}
              </v-btn>
            </div>
          </div>

          <!-- File-level actions -->
          <div v-else class="git-conflict-actions">
            <v-btn
              v-if="!f.binary && !f.truncated && f.hunks.length > 0"
              size="x-small"
              variant="tonal"
              color="primary"
              :disabled="chosenCount(f) < f.hunks.length"
              @click="applyHunks(f)"
            >
              {{
                tm("spcodeProjectLoad.diffSidebar.conflict.file.applyHunks", {
                  chosen: chosenCount(f),
                  total: f.hunks.length,
                })
              }}
            </v-btn>
            <v-btn
              size="x-small"
              variant="text"
              @click="applyWhole(f.path, 'ours')"
            >
              {{ tm("spcodeProjectLoad.diffSidebar.conflict.file.useOurs") }}
            </v-btn>
            <v-btn
              size="x-small"
              variant="text"
              @click="applyWhole(f.path, 'theirs')"
            >
              {{ tm("spcodeProjectLoad.diffSidebar.conflict.file.useTheirs") }}
            </v-btn>
            <v-btn
              v-if="!f.binary"
              size="x-small"
              variant="text"
              @click="startCustom(f)"
            >
              {{ tm("spcodeProjectLoad.diffSidebar.conflict.file.customEdit") }}
            </v-btn>
          </div>
        </div>
      </div>

      <!-- Resolved files -->
      <template v-if="snapshot.resolvedFiles.length > 0">
        <div class="git-conflict-group-label">
          {{
            tm("spcodeProjectLoad.diffSidebar.conflict.file.resolvedGroup", {
              count: snapshot.totalResolved,
            })
          }}
        </div>
        <div
          v-for="p in snapshot.resolvedFiles"
          :key="p"
          class="git-conflict-resolved-file"
        >
          <v-icon size="13" color="success">mdi-check</v-icon>
          <span class="git-conflict-file-path">{{ p }}</span>
        </div>
      </template>

      <!-- Footer: batch / abort / continue -->
      <div class="git-conflict-footer">
        <v-btn size="x-small" variant="text" @click="confirmAll('ours')">
          {{
            tm("spcodeProjectLoad.diffSidebar.conflict.footer.resolveAllOurs")
          }}
        </v-btn>
        <v-btn size="x-small" variant="text" @click="confirmAll('theirs')">
          {{
            tm("spcodeProjectLoad.diffSidebar.conflict.footer.resolveAllTheirs")
          }}
        </v-btn>
        <v-spacer />
        <v-btn
          size="x-small"
          variant="text"
          color="error"
          @click="abortOpen = true"
        >
          {{
            tm("spcodeProjectLoad.diffSidebar.conflict.footer.abort", {
              operation: opLabel,
            })
          }}
        </v-btn>
        <v-btn
          size="x-small"
          variant="tonal"
          color="primary"
          :disabled="!snapshot.allResolved"
          :title="
            snapshot.allResolved
              ? ''
              : tm(
                  'spcodeProjectLoad.diffSidebar.conflict.footer.continueBlocked',
                )
          "
          @click="continueOpen = true"
        >
          {{
            tm("spcodeProjectLoad.diffSidebar.conflict.footer.continue", {
              operation: opLabel,
            })
          }}
        </v-btn>
      </div>
    </div>

    <!-- Continue confirm (message field only for merge) -->
    <v-dialog v-model="continueOpen" persistent max-width="440">
      <v-card>
        <v-card-title class="text-h3 pa-4 pb-0 pl-6">
          {{
            tm("spcodeProjectLoad.diffSidebar.conflict.footer.continue", {
              operation: opLabel,
            })
          }}
        </v-card-title>
        <v-card-text class="pt-4">
          <v-textarea
            v-if="snapshot.operation === 'merge'"
            v-model="continueMessage"
            :label="
              tm(
                'spcodeProjectLoad.diffSidebar.conflict.footer.continueMessageLabel',
              )
            "
            rows="2"
            auto-grow
            density="compact"
            variant="outlined"
            name="conflict-continue-message"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="continueOpen = false">
            {{ tm("spcodeProjectLoad.diffSidebar.conflict.footer.cancel") }}
          </v-btn>
          <v-btn variant="tonal" color="primary" @click="doContinue">
            {{
              tm("spcodeProjectLoad.diffSidebar.conflict.footer.continue", {
                operation: opLabel,
              })
            }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Abort confirm -->
    <v-dialog v-model="abortOpen" persistent max-width="440">
      <v-card>
        <v-card-title class="text-h3 pa-4 pb-0 pl-6">
          {{
            tm(
              "spcodeProjectLoad.diffSidebar.conflict.footer.abortConfirmTitle",
              { operation: opLabel },
            )
          }}
        </v-card-title>
        <v-card-text class="pt-4">
          {{
            tm(
              "spcodeProjectLoad.diffSidebar.conflict.footer.abortConfirmMessage",
              { operation: opLabel },
            )
          }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="abortOpen = false">
            {{ tm("spcodeProjectLoad.diffSidebar.conflict.footer.cancel") }}
          </v-btn>
          <v-btn variant="tonal" color="error" @click="doAbort">
            {{
              tm(
                "spcodeProjectLoad.diffSidebar.conflict.footer.abortConfirmAction",
              )
            }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Resolve-all confirm -->
    <v-dialog v-model="allOpen" persistent max-width="440">
      <v-card>
        <v-card-title class="text-h3 pa-4 pb-0 pl-6">
          {{
            tm(
              "spcodeProjectLoad.diffSidebar.conflict.footer.resolveAllConfirmTitle",
            )
          }}
        </v-card-title>
        <v-card-text class="pt-4">
          {{
            tm(
              "spcodeProjectLoad.diffSidebar.conflict.footer.resolveAllConfirm",
              { count: snapshot.totalConflicted, side: allSide },
            )
          }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="allOpen = false">
            {{ tm("spcodeProjectLoad.diffSidebar.conflict.footer.cancel") }}
          </v-btn>
          <v-btn variant="tonal" color="primary" @click="doResolveAll">
            {{
              tm(
                "spcodeProjectLoad.diffSidebar.conflict.footer.resolveAllAction",
              )
            }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import type { UseSpcodeGitConflict } from "@/composables/useSpcodeGitConflict";
import type {
  ConflictedFile,
  ConflictSnapshot,
  SpcodeResolveResult,
  SpcodeConflictActionResult,
} from "@/composables/parseSpcodeGitConflict";

const props = defineProps<{ conflict: UseSpcodeGitConflict }>();

const emit = defineEmits<{
  (e: "resolved"): void;
  (e: "completed"): void;
  (
    e: "failed",
    payload: { reason: string; stderr?: string; count?: number },
  ): void;
}>();

const { tm } = useModuleI18n("features/chat");

const snapshot = computed<ConflictSnapshot | null>(() => {
  const s = props.conflict.state.value;
  return s.kind === "ok" && s.snapshot.inConflict ? s.snapshot : null;
});

const opLabel = computed(() =>
  tm(
    `spcodeProjectLoad.diffSidebar.conflict.op.${snapshot.value?.operation ?? "merge"}`,
  ),
);

const expanded = ref(false);
const openFile = ref<string | null>(null);
const choices = ref<Record<string, Record<number, "ours" | "theirs" | "base">>>(
  {},
);
const customEditing = ref<string | null>(null);
const customContent = ref("");
const continueOpen = ref(false);
const continueMessage = ref("");
const abortOpen = ref(false);
const allOpen = ref(false);
const allSide = ref<"ours" | "theirs">("ours");

// Reset per-file UI state when a NEW conflict operation starts (identity
// = operation + ref); mid-operation status refreshes keep the choices.
watch(
  () => [snapshot.value?.operation, snapshot.value?.operationRef],
  () => {
    choices.value = {};
    openFile.value = null;
    customEditing.value = null;
  },
);

function toggleFile(path: string): void {
  openFile.value = openFile.value === path ? null : path;
}

function setChoice(path: string, index: number, choice: unknown): void {
  if (choice !== "ours" && choice !== "theirs" && choice !== "base") return;
  const c = choice as "ours" | "theirs" | "base";
  const fileChoices: Record<number, "ours" | "theirs" | "base"> = {
    ...(choices.value[path] ?? {}),
    [index]: c,
  };
  choices.value = { ...choices.value, [path]: fileChoices };
}

function chosenCount(f: ConflictedFile): number {
  return Object.keys(choices.value[f.path] ?? {}).length;
}

// Shared result fan-out: ok → tell the parent which refresh tier to run;
// failure → parent surfaces the reason via the snackbar.
function handleResult(
  r: SpcodeResolveResult | SpcodeConflictActionResult,
  kind: "resolve" | "complete",
): void {
  if (r.ok) {
    if (kind === "resolve") {
      emit("resolved");
    } else {
      emit("completed");
    }
    return;
  }
  const remaining = "remainingConflicts" in r ? r.remainingConflicts : undefined;
  emit("failed", {
    reason: r.reason,
    stderr: r.stderr,
    count: remaining?.length,
  });
}

async function applyHunks(f: ConflictedFile): Promise<void> {
  const fileChoices = choices.value[f.path] ?? {};
  const hunks = Object.entries(fileChoices).map(([idx, choice]) => ({
    index: Number(idx),
    choice,
  }));
  const r = await props.conflict.resolve({ mode: "hunks", file: f.path, hunks });
  if (r.ok && !r.partial) {
    const next = { ...choices.value };
    delete next[f.path];
    choices.value = next;
  }
  handleResult(r, "resolve");
}

async function applyWhole(path: string, side: "ours" | "theirs"): Promise<void> {
  handleResult(
    await props.conflict.resolve({ mode: "whole", file: path, resolution: side }),
    "resolve",
  );
}

function startCustom(f: ConflictedFile): void {
  // Prefill with the full ours-side stage content from the status payload
  // (/spcode/git-file reads blobs at a ref, not the working tree).
  customContent.value = f.threeWay.ours ?? "";
  customEditing.value = f.path;
}

async function applyCustom(path: string): Promise<void> {
  const r = await props.conflict.resolve({
    mode: "custom",
    file: path,
    content: customContent.value,
  });
  if (r.ok) customEditing.value = null;
  handleResult(r, "resolve");
}

function confirmAll(side: "ours" | "theirs"): void {
  allSide.value = side;
  allOpen.value = true;
}

async function doResolveAll(): Promise<void> {
  allOpen.value = false;
  handleResult(
    await props.conflict.resolve({ mode: "all", resolution: allSide.value }),
    "resolve",
  );
}

async function doContinue(): Promise<void> {
  continueOpen.value = false;
  const msg = continueMessage.value.trim();
  continueMessage.value = "";
  handleResult(await props.conflict.continueOp(msg || undefined), "complete");
}

async function doAbort(): Promise<void> {
  abortOpen.value = false;
  handleResult(await props.conflict.abort(), "complete");
}
</script>

<style scoped>
.git-conflict-panel {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.git-conflict-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 12px;
  font-size: 12px;
  background: rgba(var(--v-theme-warning), 0.12);
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  border: none;
  text-align: left;
}
.git-conflict-banner-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.git-conflict-banner-progress {
  flex-shrink: 0;
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}
.git-conflict-body {
  padding: 8px 12px;
  font-size: 12px;
}
.git-conflict-group-label {
  font-weight: 600;
  opacity: 0.7;
  margin: 6px 0 4px;
}
.git-conflict-file {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  margin-bottom: 6px;
}
.git-conflict-file-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 8px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: inherit;
  text-align: left;
}
.git-conflict-file-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
}
.git-conflict-file-status {
  opacity: 0.6;
  font-family: monospace;
}
.git-conflict-file-body {
  padding: 4px 8px 8px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.git-conflict-hunk {
  margin-top: 6px;
}
.git-conflict-hunk-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: monospace;
  opacity: 0.8;
}
.git-conflict-hunk-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 2px;
}
.git-conflict-hunk-col pre {
  font-size: 11px;
  font-family: monospace;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 4px;
  padding: 4px 6px;
  overflow: auto;
  max-height: 160px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
.git-conflict-hunk-label {
  font-size: 11px;
  opacity: 0.6;
}
.git-conflict-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.git-conflict-resolved-file {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0.7;
  padding: 1px 8px;
}
.git-conflict-footer {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding-top: 8px;
}
.git-conflict-note {
  opacity: 0.7;
  padding: 4px 0;
}
.git-conflict-custom-editor :deep(textarea) {
  font-family: monospace;
  font-size: 11px;
}
</style>
