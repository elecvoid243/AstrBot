<!-- Author: elecvoid243 @ 2026-09-01
     Terminal sub-page: persistent shell (PowerShell/cmd) rendered with
     xterm.js, output streamed over SSE, input echoed locally (no PTY). -->
<template>
  <div class="terminal-view">
    <div class="terminal-toolbar">
      <select
        v-model="shell"
        class="terminal-shell-select"
        :disabled="running"
        :aria-label="tm('spcodeProjectLoad.gitDiffSidebar.terminal.shellLabel')"
      >
        <option value="powershell">PowerShell</option>
        <option value="cmd">cmd</option>
      </select>
      <div class="terminal-cwd" :title="projectRoot ?? ''">
        {{ projectRoot ?? "" }}
      </div>
      <span class="terminal-status" :class="`is-${status}`">
        {{ statusLabel }}
      </span>
      <button
        v-if="!running"
        type="button"
        class="terminal-btn"
        :disabled="busy || !props.umo"
        @click="onStart"
      >
        {{ tm("spcodeProjectLoad.gitDiffSidebar.terminal.connect") }}
      </button>
      <template v-else>
        <button type="button" class="terminal-btn" @click="onInterrupt">
          {{ tm("spcodeProjectLoad.gitDiffSidebar.terminal.interrupt") }}
        </button>
        <button type="button" class="terminal-btn" @click="onStop">
          {{ tm("spcodeProjectLoad.gitDiffSidebar.terminal.stop") }}
        </button>
      </template>
      <button type="button" class="terminal-btn" @click="onClear">
        {{ tm("spcodeProjectLoad.gitDiffSidebar.terminal.clear") }}
      </button>
    </div>
    <div ref="hostRef" class="terminal-host" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
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
const hostRef = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let abortController: AbortController | null = null;
let resizeObserver: ResizeObserver | null = null;

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

function initTerm(): void {
  if (!hostRef.value) return;
  term = new Terminal({
    fontSize: 12,
    fontFamily: 'Consolas, "Courier New", monospace',
    convertEol: true,
    cursorBlink: true,
    theme: props.isDark
      ? { background: "#1e1e1e", foreground: "#d4d4d4" }
      : { background: "#ffffff", foreground: "#1f1f1f" },
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(hostRef.value);
  void nextTick(() => fit?.fit());

  resizeObserver = new ResizeObserver(() => fit?.fit());
  resizeObserver.observe(hostRef.value);

  term.onData((data) => {
    if (data === "\x03") {
      void onInterrupt();
      return;
    }
    if (!sessionId.value) return;
    // Local echo (the backend pipe has no TTY, the shell will not echo).
    term?.write(data === "\r" ? "\r\n" : data);
    const chars = data === "\r" ? "\n" : data;
    void pluginExtensionApi
      .post("spcode/terminal/input", {
        umo: props.umo,
        session_id: sessionId.value,
        chars,
      })
      .catch(() => {
        /* transient input loss — SSE error handling covers the rest */
      });
  });
}

function writeNotice(text: string): void {
  term?.write(`\x1b[90m${text}\x1b[0m\r\n`);
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
          term?.write(String(event.data));
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
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid rgba(127, 127, 127, 0.25);
  flex-wrap: wrap;
}
.terminal-shell-select {
  font-size: 12px;
  padding: 2px 4px;
  background: transparent;
  color: inherit;
  border: 1px solid rgba(127, 127, 127, 0.4);
  border-radius: 4px;
}
.terminal-cwd {
  font-size: 11px;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}
.terminal-status {
  font-size: 11px;
  opacity: 0.85;
  margin-left: auto;
}
.terminal-status.is-running {
  color: #4caf50;
}
.terminal-status.is-error {
  color: #ef5350;
}
.terminal-btn {
  font-size: 12px;
  padding: 3px 10px;
  border: 1px solid rgba(127, 127, 127, 0.4);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.terminal-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.terminal-host {
  flex: 1;
  min-height: 0;
  padding: 4px 2px;
}
.terminal-host :deep(.xterm) {
  height: 100%;
}
</style>
