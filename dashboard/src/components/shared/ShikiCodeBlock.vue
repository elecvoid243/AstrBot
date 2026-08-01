<!-- Author: elecvoid243, 2026-07-31
     Spec: docs/superpowers/specs/2026-07-31-chat-code-block-shiki-design.md
     Lightweight code block for markstream-vue's code_block slot. Replaces
     the library's Monaco-based renderer (its stream-monaco peer dep is not
     installed, so code blocks degraded to an unstyled bare <pre>). Shiki
     highlighting comes from the shared @/utils/shiki singleton; all colors
     are self-contained so the block survives the DocumentManager fullscreen
     Teleport (which detaches the tree from Vuetify's color provider). -->
<script setup lang="ts">
import { computed, inject, ref, watch, type PropType, type Ref } from "vue";
import { useTheme } from "vuetify";
import { getShikiHighlighter, renderShikiCode } from "@/utils/shiki";
import { copyToClipboard } from "@/utils/clipboard";
import { useModuleI18n } from "@/i18n/composables";
import DiffPreview from "@/components/chat/message_list_comps/DiffPreview.vue";

const props = defineProps({
  /** markstream code_block node: lang / code / loading are read. */
  node: { type: Object as PropType<Record<string, unknown>>, required: true },
  /** Passed through by MarkdownRender; falls back to the isDark
   *  provide/inject chain, then to the Vuetify theme, then to light.
   *
   *  2026-08-01: declared with `default: undefined` on purpose — a
   *  type-only `isDark?: boolean` compiles to a Boolean prop that
   *  defaults to FALSE when absent, which silently short-circuits the
   *  `??` fallback chain below and pins every un-prop'd render to the
   *  light theme (the dark-fullscreen bug). undefined keeps "not
   *  provided" distinguishable from an explicit false. */
  isDark: { type: Boolean, default: undefined },
});

const emit = defineEmits<{
  copy: [payload: string];
}>();

const { tm } = useModuleI18n("features/chat");

// 2026-08-01 dark-fallback fix: the "document-view" render path has no
// isDark provider (only the chat message list provides one), and
// markstream does not reliably forward isDark as a prop to custom
// components — so plain / language-less blocks in the document manager
// rendered with the LIGHT shiki theme (dark text) on the dark container
// and became nearly invisible, worst in the fullscreen Teleport. Fall
// back to the Vuetify theme, mirroring CodeMirrorEditor's pattern.
let vuetifyDark: Ref<boolean> | null = null;
try {
  const theme = useTheme();
  vuetifyDark = computed(() => theme.current.value.dark);
} catch {
  // No Vuetify in context (bare unit-test mount) — stay light.
}

const injectedIsDark = inject<Ref<boolean> | boolean | undefined>(
  "isDark",
  undefined,
);
// 2026-08-01 dark-fallback fix, round 2: markstream passes isDark=false
// to custom code_block components in the "document-view" path even when
// its own NodeRenderer has is-dark=true (the flag is simply not
// forwarded correctly), and the chat path provides isDark via inject
// instead. Since a passed `false` is therefore NOT authoritative, the
// chain uses OR semantics: any source saying "dark" wins, `false` falls
// through to the next source. All sources in this app derive from the
// same customizer store, so they never legitimately disagree.
const effectiveIsDark = computed(
  () =>
    props.isDark ||
    (injectedIsDark instanceof Object && "value" in injectedIsDark
      ? injectedIsDark.value
      : injectedIsDark) === true ||
    (vuetifyDark?.value ?? false),
);

const code = computed(() => String(props.node.code ?? props.node.content ?? ""));
const lang = computed(() =>
  String(props.node.lang ?? props.node.language ?? "").trim(),
);
const langLabel = computed(() => (lang.value || "text").toLowerCase());
const isLoading = computed(() => props.node.loading === true);
const isDiff = computed(() => langLabel.value === "diff");

/** Highlighted HTML. Empty while the highlighter is still loading or the
 *  node is mid-stream — the plain-text branch renders in that window so
 *  streaming never re-highlights per token. */
const highlightedHtml = ref("");
let highlighter: unknown = null;
let highlightToken = 0;

watch(
  [code, effectiveIsDark, isLoading],
  async () => {
    if (isDiff.value || isLoading.value || !code.value) {
      highlightedHtml.value = "";
      return;
    }
    const token = ++highlightToken;
    if (!highlighter) highlighter = await getShikiHighlighter();
    if (token !== highlightToken) return; // superseded while awaiting
    highlightedHtml.value = renderShikiCode(
      highlighter,
      code.value,
      lang.value || "text",
      effectiveIsDark.value ? "dark" : "light",
    );
  },
  { immediate: true },
);

const showPlain = computed(() => highlightedHtml.value === "");

// Copy button with a 1s check-icon confirmation, mirroring the file
// preview's copy feedback pattern.
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

async function onCopy(): Promise<void> {
  if (!code.value) return;
  await copyToClipboard(code.value);
  emit("copy", code.value);
  copied.value = true;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copied.value = false;
  }, 1000);
}
</script>

<template>
  <DiffPreview
    v-if="isDiff"
    :content="code"
    :is-dark="effectiveIsDark"
    :max-lines="30"
  />
  <div v-else class="shiki-code-block">
    <div class="shiki-code-block__header">
      <span class="shiki-code-block__lang">{{ langLabel }}</span>
      <button
        type="button"
        class="shiki-code-block__copy"
        :aria-label="tm('spcodeProjectLoad.fileBrowser.preview.copy')"
        @click="onCopy"
      >
        <v-icon size="14">{{ copied ? "mdi-check" : "mdi-content-copy" }}</v-icon>
      </button>
    </div>
    <!-- shiki output is generated locally from the same content the file
         preview already renders via v-html; no new trust boundary. -->
    <div
      v-if="!showPlain"
      class="shiki-code-block__body"
      v-html="highlightedHtml"
    />
    <pre
      v-else
      class="shiki-code-block__body shiki-code-block__plain"
    ><code v-text="code" /></pre>
  </div>
</template>

<style scoped>
.shiki-code-block {
  margin: 8px 0;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  /* Explicit text color so the plain-text fallback branch stays readable
     when the block is teleported outside Vuetify's color provider
     (DocumentManager fullscreen); shiki's inline span colors still win
     for highlighted content. */
  color: rgb(var(--v-theme-on-surface));
  overflow: hidden;
}

.shiki-code-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 4px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.shiki-code-block__lang {
  font-size: 11px;
  text-transform: lowercase;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-variant-numeric: tabular-nums;
}

.shiki-code-block__copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
}

.shiki-code-block__copy:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.87);
}

.shiki-code-block__body {
  padding: 12px;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.55;
}

/* shiki wraps its output in its own <pre> with a themed background;
   flatten it so the container background owns both themes. */
.shiki-code-block__body :deep(pre) {
  margin: 0;
  background: transparent !important;
  font: inherit;
}

/* 2026-08-01 cascade isolation: shiki's inline text color lives on the
   <pre> element only. Any global `pre code { color: … }` rule would
   otherwise win over inheritance on the descendant <code>/<span>
   (no !important needed), which is exactly how language-less blocks
   ended up dark-blue on the dark app background while token-colored
   languages looked "fine". Pin descendants to inherit the pre's inline
   color with a higher-specificity selector. */
.shiki-code-block__body :deep(pre code),
.shiki-code-block__body :deep(pre code span) {
  color: inherit;
}

.shiki-code-block__plain {
  margin: 0;
  white-space: pre;
}
</style>
