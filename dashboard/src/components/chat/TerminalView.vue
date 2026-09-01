<!-- Author: elecvoid243 @ 2026-09-01
     Terminal sub-page: persistent shell (PowerShell/cmd) rendered with
     xterm.js (output only), input via a native browser text field.
     No PTY: PowerShell/cmd echo input themselves in pipe mode (verified
     2026-09-01: 'pwd' -> echo '> pwd'; DEL char is NOT handled by the
     shell, so character-level echo/backspace inside xterm double-prints
     and never erases). The native input field gives correct editing.
     UI: Vuetify controls (v-btn-toggle / v-btn / v-chip), command lines
     are highlighted by the frontend and the shell's own echo line is
     filtered out in the SSE stream (pattern: `<prompt>> <command>`). -->
<template>
  <div class="terminal-view">
    <div class="terminal-toolbar">
      <v-btn-toggle
        v-model="shell"
        mandatory
        variant="outlined"
        density="comfortable"
        class="terminal-shell-toggle"
        :disabled="running"
      >
        <v-btn value="powershell" size="small" :ripple="false">
          PowerShell
        </v-btn>
        <v-btn value="cmd" size="small" :ripple="false">
          cmd
        </v-btn>
      </v-btn-toggle>
      <div class="terminal-cwd" :title="projectRoot ?? ''">
        {{ projectRoot ?? "" }}
      </div>
      <v-chip
        size="small"
        variant="tonal"
        class="terminal-status-chip"
        :class="`is-${status}`"
      >
        {{ statusLabel }}
      </v-chip>
      <v-btn
        v-if="!running"
        variant="text"
        size="small"
        color="primary"
        :disabled="busy || !props.umo"
        @click="onStart"
      >
        {{ tm("spcodeProjectLoad.gitDiffSidebar.terminal.connect") }}
      </v-btn>
      <template v-else>
        <v-btn variant="text" size="small" @click="onInterrupt">
          {{ tm("spcodeProjectLoad.gitDiffSidebar.terminal.interrupt") }}
        </v-btn>
        <v-btn
          variant="tonal"
          size="small"
          color="error"
          @click="onStop"
        >
          {{ tm("spcodeProjectLoad.gitDiffSidebar.terminal.stop") }}
        </v-btn>
      </template>
      <v-btn variant="text" size="small" @click="onClear">
        {{ tm("spcodeProjectLoad.gitDiffSidebar.terminal.clear") }}
      </v-btn>
    </div>
    <div ref="hostRef" class="terminal-host" />
    <div class="terminal-input-row">
      <span class="terminal-input-prompt">&#10095;</span>
      <input
        ref="inputRef"
        v-model="lineInput"
        class="terminal-input"
        :disabled="!running || busy"
        :placeholder="
          tm('spcodeProjectLoad.gitDiffSidebar.terminal.inputPlaceholder')
        "
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        @keydown.enter.prevent="submitLine"
        @keydown.up.prevent="historyPrev"
        @keydown.down.prevent="historyNext"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { pluginExtensionApi } from "@/api/v1";
import { fetchWithAuth } from "@/api/http";
import { useModuleI18n } from "@/i18n/composables";
import {
  parseSpcodeTerminalStreamBlock,
  splitSpcodeTerminalBlocks,
} from "@/composables/parseSpcodeTerminalStream";

interface TerminalStartData {
  session_id: string;
  pid: number;
  shell: string;
  cwd: string;
  status: string;
}

interface TerminalStatusData {
  session_id: string;
  pid: number;
  status: string;
  stdout: string;
  exit_code: number | null;
  cursor: number;
  has_more: boolean;
  error?: string;
}

const props = defineProps<{
  umo: string | null;
  projectRoot: string | null;
  isDark: boolean;
}>();

const { tm } = useModuleI18n("features/chat");

const SHELL_KEY = "astrbot.spcode.gitDiffSidebar.terminalShell";

function loadShell(): "powershell" | "cmd" {
  try {
    const v = localStorage.getItem(SHELL_KEY);
    if (v === "cmd") return "cmd";
  } catch {
    /* localStorage unavailable (private mode) */
  }
  return "powershell";
}

const shell = ref<"powershell" | "cmd">(loadShell());
const status = ref<"idle" | "running" | "exited" | "error">("idle");
const busy = ref(false);
const sessionId = ref<string | null>(null);
const lineInput = ref("");
const hostRef = ref<HTMLDivElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let abortController: AbortController | null = null;
let resizeObserver: ResizeObserver | null = null;
// Local command history for the native input field (ArrowUp/Down).
const history: string[] = [];
let historyIndex = -1;
// Last command submitted; used to filter the shell's own echo line.
let lastSubmittedLine = "";

const running = computed(() => status.value === "running");

const statusLabel = computed(() => {
  const t = tm as (key: string) => string;
  switch (status.value) {
    case "running":
      return t("spcodeProjectLoad.gitDiffSidebar.terminal.connected");
    case "exited":
      return t("spcodeProjectLoad.gitDiffSidebar.terminal.exited");
    case "error":
      return t("spcodeProjectLoad.gitDiffSidebar.terminal.connectionError");
    default:
      return t("spcodeProjectLoad.gitDiffSidebar.terminal.noSession");
  }
});

/** ANSI color helper: wrap text in a foreground color without resets. */
function ansi(color: string, text: string): string {
  return `\x1b[${color}m${text}\x1b[0m`;
}

/** Dark editor palette (GitHub Dark-like). */
const DARK_THEME = {
  background: "#101418",
  foreground: "#d6dde5",
  cursor: "#6ab4ff",
  cursorAccent: "#101418",
  selectionBackground: "rgba(106, 180, 255, 0.28)",
  black: "#101418",
  brightBlack: "#5c6770",
  blue: "#6ab4ff",
  brightBlue: "#8cc6ff",
  green: "#7ec699",
  brightGreen: "#9adbad",
  cyan: "#56c8d8",
  brightCyan: "#7ee0ee",
  yellow: "#d8b76a",
  brightYellow: "#f0d08a",
  red: "#e07070",
  brightRed: "#f08a8a",
  magenta: "#c48ad8",
  brightMagenta: "#d9a8ea",
  white: "#d6dde5",
  brightWhite: "#ffffff",
} as const;

/** Light editor palette (GitHub Light-like). */
const LIGHT_THEME = {
  background: "#fbfbf8",
  foreground: "#24292f",
  cursor: "#0969da",
  cursorAccent: "#fbfbf8",
  selectionBackground: "rgba(9, 105, 218, 0.18)",
  black: "#24292f",
  brightBlack: "#6e7781",
  blue: "#0969da",
  brightBlue: "#218bff",
  green: "#1a7f37",
  brightGreen: "#2da44e",
  cyan: "#1b7c83",
  brightCyan: "#3192aa",
  yellow: "#9a6700",
  brightYellow: "#bf8700",
  red: "#cf222e",
  brightRed: "#f14c4c",
  magenta: "#8250df",
  brightMagenta: "#a475f9",
  white: "#24292f",
  brightWhite: "#1f2328",
} as const;

function initTerm(): void {
  if (!hostRef.value) return;
  const host = hostRef.value;
  term = new Terminal({
    fontSize: 12,
    fontFamily: 'Consolas, "Courier New", monospace',
    convertEol: true,
    cursorBlink: true,
    theme: props.isDark ? DARK_THEME : LIGHT_THEME,
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  void nextTick(() => fit?.fit());

  resizeObserver = new ResizeObserver(() => fit?.fit());
  resizeObserver.observe(host);
}

function writeNotice(text: string): void {
  term?.write(`${ansi("90", text)}\r\n`);
}

/** Escape a string for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Filter the shell's echo line (e.g. `PS C:\repo> pwd` / `C:\repo>pwd`)
 * out of a received output block — the frontend already rendered the
 * submitted line itself with highlight. Non-matching output passes
 * through untouched.
 */
function filterEchoLine(text: string): string {
  if (!lastSubmittedLine) return text;
  const esc = escapeRegExp(lastSubmittedLine);
  const re = new RegExp(`^[^\\r\\n]*>[ \\t]*${esc}[ \\t]*\\r?\\n?$`, "gm");
  return text.replace(re, "");
}

/** Submit the current input line to the shell as one complete line. */
function submitLine(): void {
  if (!props.umo || !sessionId.value) return;
  const line = lineInput.value;
  lineInput.value = "";
  historyIndex = -1;
  if (line.trim()) {
    history.push(line);
    lastSubmittedLine = line.trim();
    // Highlighted command line, rendered locally (the shell's echo of
    // the same line is filtered out in openStream). Guaranteed to be
    // visible for both PowerShell and cmd regardless of their pipe
    // echo behaviour.
    term?.write(
      `${ansi("36", "\u276f")} ${ansi("1;36", line.trim())}\r\n`,
    );
    term?.scrollToBottom();
  }
  void pluginExtensionApi
    .post("spcode/terminal/input", {
      umo: props.umo,
      session_id: sessionId.value,
      chars: `${line}\n`,
    })
    .catch(() => {
      /* transient input loss — SSE error handling covers the rest */
    });
  void nextTick(() => inputRef.value?.focus());
}

function historyPrev(): void {
  if (history.length === 0) return;
  if (historyIndex === -1) {
    historyIndex = history.length - 1;
  } else if (historyIndex > 0) {
    historyIndex -= 1;
  }
  lineInput.value = history[historyIndex] ?? "";
}

function historyNext(): void {
  if (history.length === 0 || historyIndex === -1) return;
  historyIndex += 1;
  if (historyIndex >= history.length) {
    historyIndex = -1;
    lineInput.value = "";
    return;
  }
  lineInput.value = history[historyIndex] ?? "";
}

async function onStart(): Promise<void> {
  if (!props.umo || busy.value) return;
  busy.value = true;
  try {
    const resp = await pluginExtensionApi.post<TerminalStartData>(
      "spcode/terminal/start",
      { umo: props.umo, shell: shell.value, cwd: props.projectRoot ?? "" },
    );
    const data = resp.data?.data;
    if (!data?.session_id) {
      status.value = "error";
      writeNotice(tm("spcodeProjectLoad.gitDiffSidebar.terminal.startFailed"));
      return;
    }
    try {
      localStorage.setItem(SHELL_KEY, shell.value);
    } catch {
      /* ignore */
    }
    sessionId.value = data.session_id;
    status.value = "running";
    writeNotice(`[spcode] ${data.shell} @ ${data.cwd} (pid ${data.pid})`);
    await openStream(0);
    void nextTick(() => inputRef.value?.focus());
  } finally {
    busy.value = false;
  }
}

async function openStream(startCursor: number): Promise<void> {
  if (!props.umo || !sessionId.value) return;
  abortController?.abort();
  abortController = new AbortController();
  const url =
    `/api/v1/plugins/extensions/spcode/terminal/stream` +
    `?umo=${encodeURIComponent(props.umo)}` +
    `&session_id=${encodeURIComponent(sessionId.value)}` +
    `&cursor=${startCursor}`;
  try {
    const resp = await fetchWithAuth(url, { signal: abortController.signal });
    if (!resp.ok || !resp.body) {
      throw new Error(`stream failed: ${resp.status}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { blocks, remainder } = splitSpcodeTerminalBlocks(buffer);
      buffer = remainder;
      for (const block of blocks) {
        const event = parseSpcodeTerminalStreamBlock(block);
        if (!event) continue;
        if (event.type === "output") {
          const text = String(event.data);
          if (lastSubmittedLine) {
            term?.write(filterEchoLine(text));
          } else {
            term?.write(text);
          }
        } else if (event.type === "exit") {
          status.value = "exited";
          writeNotice(
            `[spcode] session exited (code ${
              (event.data as { code?: number | null }).code ?? "?"
            })`,
          );
          sessionId.value = null;
          return;
        } else if (event.type === "error") {
          status.value = "error";
          sessionId.value = null;
          writeNotice(String(event.data));
          return;
        }
      }
    }
  } catch {
    if (abortController?.signal.aborted) return;
    status.value = "error";
    writeNotice(tm("spcodeProjectLoad.gitDiffSidebar.terminal.connectionError"));
  }
}

async function restoreSession(): Promise<void> {
  if (!props.umo) return;
  try {
    const resp = await pluginExtensionApi.get<TerminalStatusData>(
      "spcode/terminal/status",
      { params: { umo: props.umo } },
    );
    const data = resp.data?.data;
    if (!data?.session_id || data.error === "no_session") return;
    sessionId.value = data.session_id;
    if (data.stdout) term?.write(data.stdout);
    status.value = data.status === "running" ? "running" : "exited";
    if (data.status === "running") {
      await openStream(data.cursor ?? 0);
    } else {
      sessionId.value = null;
    }
  } catch {
    /* offline status probe — stays idle */
  }
}

async function onInterrupt(): Promise<void> {
  if (!props.umo || !sessionId.value) return;
  term?.write("\r\n");
  try {
    await pluginExtensionApi.post("spcode/terminal/interrupt", {
      umo: props.umo,
      session_id: sessionId.value,
    });
  } catch {
    /* ignore */
  }
}

async function onStop(): Promise<void> {
  if (!props.umo || !sessionId.value) return;
  // Abort the SSE first so the session-cleanup error event (poll of a
  // removed session) cannot overwrite the manual "idle" status below.
  abortController?.abort();
  try {
    await pluginExtensionApi.post("spcode/terminal/stop", {
      umo: props.umo,
      session_id: sessionId.value,
    });
  } catch {
    /* ignore */
  }
  term?.write("\r\n[spcode] session terminated\r\n");
  status.value = "idle";
  sessionId.value = null;
}

function onClear(): void {
  term?.clear();
}

onMounted(() => {
  initTerm();
  // Recover a live session after e.g. a browser refresh.
  void restoreSession();
});

// Apply theme changes to a live terminal (global dark/light toggle).
watch(
  () => props.isDark,
  (dark) => {
    if (term) term.options.theme = dark ? DARK_THEME : LIGHT_THEME;
  },
);

onBeforeUnmount(() => {
  abortController?.abort();
  resizeObserver?.disconnect();
  term?.dispose();
  term = null;
  fit = null;
  // Deliberately NOT terminating the process: the shell keeps running so
  // switching tabs does not kill long-running tasks.
});
</script>

<style scoped>
.terminal-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 320px;
}
.terminal-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  flex-wrap: wrap;
}
.terminal-shell-toggle {
  border-radius: 6px;
}
.terminal-shell-toggle :deep(.v-btn) {
  text-transform: none;
  font-size: 12px;
  letter-spacing: 0;
}
.terminal-cwd {
  font-size: 11px;
  opacity: 0.65;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
  flex: 1;
  min-width: 80px;
}
.terminal-status-chip {
  font-size: 11px;
}
.terminal-status-chip.is-running {
  color: var(--v-theme-success) !important;
}
.terminal-status-chip.is-error {
  color: var(--v-theme-error) !important;
}
.terminal-host {
  flex: 1;
  min-height: 0;
  margin: 0 8px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.terminal-host :deep(.xterm) {
  height: 100%;
  padding: 6px 8px;
}
.terminal-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}
.terminal-input-prompt {
  font-family: Consolas, "Courier New", monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--v-theme-success);
}
.terminal-input {
  flex: 1;
  font-family: Consolas, "Courier New", monospace;
  font-size: 12px;
  background: transparent;
  color: inherit;
  border: none;
  outline: none;
}
.terminal-input::placeholder {
  opacity: 0.45;
}
</style>
