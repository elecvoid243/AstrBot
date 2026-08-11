<!--
  ShellSessionToolResultView
  ─────────────────────────────────────────────────────────────────────
  astrbot_shell_session(托管 Shell 会话管理)工具的结果展示组件。

  后端按 action 返回三种 JSON 形态(见 shell_session_tools/format.ts):
    - list                 : 会话摘要列表
    - write / write_line   : 写入确认(written_chars)
    - poll / interrupt / terminate : 增量输出 + 会话状态

  视觉设计:
    复用 IntaShellToolResultView 的 session-card 骨架(1px 边框 + 4px
    圆角 + 头部条 + 行间分隔线)与 StateChip 状态徽章(GitHub 色板),
    状态元数据按后端 local.py 的 status 值(running / completed /
    failed / timed_out / terminated)在 shell_session_tools/icons.ts
    中单独维护。解析层复用 @/utils/shellToolResult,可抵御后端溢出
    截断与 [SYSTEM NOTICE] 后缀。

  Author: elecvoid243 | 2026-08-11
-->
<template>
    <!-- ── 纯文本错误(非 JSON)───────────────────────────────── -->
    <div v-if="isPlainError" class="result-status error">
        <v-icon size="16">mdi-alert-circle</v-icon>
        <span>{{ plainText }}</span>
    </div>

    <!-- ── JSON 截断/畸形:降级为原始文本 ────────────────────── -->
    <pre v-else-if="!json" class="result-raw">{{ plainText }}</pre>

    <!-- ── list ────────────────────────────────────────────── -->
    <div v-else-if="action === 'list'" class="session-card">
        <div class="session-card-header">
            <v-icon size="14" class="header-icon">{{ actionIcon }}</v-icon>
            <span class="header-title">
                {{ tm('shellSession.headers.list', { count: sessionsList.length }) }}
            </span>
        </div>
        <div v-if="sessionsList.length" class="session-list">
            <div v-for="s in sessionsList" :key="s.session_id" class="session-list-item">
                <div class="session-list-line">
                    <CopyableText
                        :value="s.session_id"
                        :display-value="shortId(s.session_id)"
                        :title="s.session_id"
                        mode="code"
                        class="session-id compact"
                    />
                    <StateChip :status="s.status" />
                    <span
                        v-if="s.exit_code !== null && s.exit_code !== undefined"
                        class="exit-code-mini"
                        :class="s.exit_code === 0 ? 'success' : 'error'"
                    >exit {{ s.exit_code }}</span>
                </div>
                <div class="session-list-meta">
                    <CopyableText :value="`pid ${s.pid}`" mode="inline" class="meta-value-dim" />
                    <template v-if="s.started_at">
                        <span class="meta-sep">·</span>
                        <CopyableText
                            :value="formatRelativeTime(s.started_at)"
                            mode="inline"
                            class="meta-value-dim"
                        />
                    </template>
                    <span class="meta-sep">·</span>
                    <span class="meta-value-dim">
                        {{ tm('shellSession.labels.unread') }} {{ formatBytes(s.unread_output_bytes) }}
                    </span>
                    <template v-if="s.sandboxed">
                        <span class="meta-sep">·</span>
                        <span class="meta-value-dim">{{ tm('shellSession.labels.sandboxed') }}</span>
                    </template>
                </div>
            </div>
        </div>
        <div v-else class="session-card-body">
            <span class="empty-note">{{ tm('shellSession.labels.noSessions') }}</span>
        </div>
    </div>

    <!-- ── write / write_line ───────────────────────────────── -->
    <div v-else-if="action === 'write' || action === 'write_line'" class="session-card">
        <div class="session-card-header">
            <v-icon size="14" class="header-icon">{{ actionIcon }}</v-icon>
            <span class="header-title">{{ actionTitle }}</span>
            <CopyableText
                v-if="writeResult?.session_id"
                :value="writeResult.session_id"
                :display-value="shortId(writeResult.session_id)"
                :title="writeResult.session_id"
                mode="code"
                class="session-id"
            />
            <StateChip v-if="writeResult" :status="writeResult.status" />
        </div>
        <div v-if="writeResult" class="session-card-body">
            <div class="meta-row">
                <span class="meta-label">{{ tm('shellSession.labels.writtenChars') }}</span>
                <CopyableText
                    :value="String(writeResult.written_chars)"
                    mode="inline"
                    class="meta-value"
                />
            </div>
        </div>
    </div>

    <!-- ── poll / interrupt / terminate(增量输出)────────────── -->
    <div v-else class="session-card">
        <div class="session-card-header">
            <v-icon size="14" class="header-icon">{{ actionIcon }}</v-icon>
            <span class="header-title">{{ actionTitle }}</span>
            <CopyableText
                v-if="pollResult?.session_id"
                :value="pollResult.session_id"
                :display-value="shortId(pollResult.session_id)"
                :title="pollResult.session_id"
                mode="code"
                class="session-id"
            />
            <StateChip v-if="pollResult" :status="pollResult.status" />
        </div>
        <div v-if="pollResult" class="session-card-body">
            <div class="output-block">
                <span class="meta-label">{{ tm('shellSession.labels.stdout') }}</span>
                <CopyableText
                    v-if="pollResult.stdout"
                    :value="pollResult.stdout"
                    mode="block"
                    :multiline="true"
                    class="output-value"
                />
                <span v-else class="empty-note">{{ tm('shellSession.labels.noOutput') }}</span>
            </div>
            <div v-if="pollResult.stderr" class="output-block output-stderr">
                <span class="meta-label">{{ tm('shellSession.labels.stderr') }}</span>
                <CopyableText
                    :value="pollResult.stderr"
                    mode="block"
                    :multiline="true"
                    class="output-value output-stderr-text"
                />
            </div>
            <div class="meta-row">
                <template v-if="pollResult.exit_code !== null && pollResult.exit_code !== undefined">
                    <span class="meta-label">{{ tm('shellSession.labels.exitCode') }}</span>
                    <span
                        class="exit-code"
                        :class="pollResult.exit_code === 0 ? 'success' : 'error'"
                    >{{ pollResult.exit_code }}</span>
                </template>
                <span v-if="pollResult.has_more" class="hint-note">
                    {{ tm('shellSession.labels.moreOutput') }}
                </span>
                <span v-if="pollResult.session_closed" class="hint-note">
                    {{ tm('shellSession.labels.sessionClosed') }}
                </span>
            </div>
        </div>
    </div>

    <!-- ── 系统通知后缀([SYSTEM NOTICE] 等)───────────────────── -->
    <div v-if="extra" class="extra-text">{{ extra }}</div>
</template>

<script setup lang="ts">
import { computed, h, defineComponent } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import CopyableText from "./__shared__/CopyableText.vue";
import { formatRelativeTime } from "./inta_shell_tools/format";
import {
    getShellSessionActionIcon,
    getShellSessionStatusMeta,
    type ShellSessionStatusMeta,
} from "./shell_session_tools/icons";
import {
    parseShellSessionResult,
    inferShellSessionAction,
    formatBytes,
    type ShellSessionPollResult,
    type ShellSessionWriteResult,
    type ShellSessionListItem,
} from "./shell_session_tools/format";

const props = defineProps<{
    toolName: string;
    result: string;
    args?: Record<string, any>;
}>();

const { tm } = useModuleI18n("features/chat");

// ── Parse once(truncation / system-notice safe) ────────────────
const parsed = computed(() => parseShellSessionResult(props.result));
const json = computed(() => parsed.value.json);
const extra = computed(() => parsed.value.extra);

/** 非 JSON 结果(如 "Error managing shell session: …")的纯文本。 */
const plainText = computed(() => (props.result ?? "").trim());
const isPlainError = computed(
    () => !json.value && /^error\b/i.test(plainText.value),
);

// action 优先取工具参数,缺失时按 JSON 形态推断。
const action = computed(() =>
    inferShellSessionAction(props.args, json.value),
);
const actionIcon = computed(() => getShellSessionActionIcon(action.value));

const HEADER_I18N_KEYS: Record<string, string> = {
    list: "list",
    poll: "poll",
    write: "write",
    write_line: "writeLine",
    interrupt: "interrupt",
    terminate: "terminate",
};
const actionTitle = computed(() =>
    tm(`shellSession.headers.${HEADER_I18N_KEYS[action.value] ?? "poll"}`),
);

// ── Per-action result views ─────────────────────────────────────
const pollResult = computed<ShellSessionPollResult | null>(() =>
    json.value ? (json.value as unknown as ShellSessionPollResult) : null,
);
const writeResult = computed<ShellSessionWriteResult | null>(() =>
    json.value ? (json.value as unknown as ShellSessionWriteResult) : null,
);
const sessionsList = computed<ShellSessionListItem[]>(() =>
    Array.isArray(json.value?.sessions)
        ? (json.value!.sessions as ShellSessionListItem[])
        : [],
);

/** session_id 显示为前 8 位缩短形式(悬停/复制取全量)。 */
function shortId(id: string): string {
    return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

// ── Inline sub-component: StateChip ─────────────────────────────
// 状态徽章:图标 + 标签 + 颜色 + (running 时) pulse 动画。
// 结构与 IntaShellToolResultView 的 StateChip 一致,数据源换成
// shell_session 的 status 元数据。
const StateChip = defineComponent({
    name: "ShellSessionStateChip",
    props: {
        status: { type: String, required: true },
    },
    setup(p) {
        return () => {
            const meta: ShellSessionStatusMeta = getShellSessionStatusMeta(p.status);
            const label = tm(`shellSession.stateLabels.${meta.i18nKey}`);
            return h(
                "span",
                {
                    class: ["state-chip", { pulse: !!meta.pulse }],
                    style: { color: meta.color, borderColor: meta.color },
                    title: p.status,
                },
                [
                    h("i", {
                        class: ["mdi", meta.icon, "state-chip-icon"],
                        style: { color: meta.color },
                    }),
                    h("span", { class: "state-chip-label" }, label),
                ],
            );
        };
    },
});
</script>

<style scoped>
/* ── 与 IntaShellToolResultView 相同的视觉 DNA ──────────────── */

.result-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 12px;
}

.result-status.error {
    background: rgba(255, 100, 100, 0.08);
    color: #cf222e;
}

.result-raw {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 300px;
    overflow-y: auto;
    color: rgba(var(--v-theme-on-surface), 0.8);
}

.session-card {
    border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
    border-radius: 4px;
    overflow: hidden;
    font-size: 12px;
    line-height: 1.55;
}

.session-card-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

.header-icon {
    color: rgba(var(--v-theme-on-surface), 0.5);
    flex-shrink: 0;
}

.header-title {
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.75);
    font-size: 11.5px;
}

.meta-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    font-size: 11px;
    line-height: 1.55;
}

.meta-row + .meta-row {
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}

.meta-label {
    flex-shrink: 0;
    width: 64px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.5);
    padding-right: 8px;
}

.meta-value {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    color: rgba(var(--v-theme-on-surface), 0.8);
    word-break: break-all;
}

.meta-value-dim {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    color: rgba(var(--v-theme-on-surface), 0.55);
}

.meta-sep {
    color: rgba(var(--v-theme-on-surface), 0.3);
    user-select: none;
}

/* ── 输出块(stdout / stderr)───────────────────────────────── */
.output-block {
    padding: 3px 8px;
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}

.session-card-body .output-block:first-child {
    border-top: none;
}

.output-block .meta-label {
    display: block;
    width: auto;
    padding-right: 0;
    margin-bottom: 4px;
}

.output-value {
    flex: 1;
    margin: 0;
    padding: 8px 10px;
    border-radius: 4px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11.5px;
    color: rgba(var(--v-theme-on-surface), 0.8);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 240px;
    overflow-y: auto;
    overflow-x: auto;
}

.output-stderr {
    background: rgba(207, 34, 46, 0.04);
}

.output-stderr-text {
    color: #cf222e;
}

.empty-note {
    display: block;
    padding: 8px 0;
    font-style: italic;
    color: rgba(var(--v-theme-on-surface), 0.45);
    font-size: 11px;
}

.hint-note {
    font-style: italic;
    color: rgba(var(--v-theme-on-surface), 0.45);
    font-size: 11px;
}

/* ── State chip ─────────────────────────────────────────────── */
.state-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: auto;
    padding: 1px 6px;
    border-radius: 9px;
    border: 1px solid;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1;
    background: rgba(var(--v-theme-on-surface), 0.02);
    flex-shrink: 0;
}

.state-chip-icon {
    font-size: 11px;
}

.state-chip-label {
    text-transform: lowercase;
    letter-spacing: 0.02em;
}

.state-chip.pulse .state-chip-icon {
    animation: stateChipPulse 1.6s ease-in-out infinite;
}

@keyframes stateChipPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
}

/* ── Session id chip ────────────────────────────────────────── */
.session-id {
    max-width: 140px;
    overflow: hidden;
    flex-shrink: 0;
}

.session-id.compact {
    font-size: 10px;
}

/* ── Exit code badge ────────────────────────────────────────── */
.exit-code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 3px;
}

.exit-code.success {
    background: rgba(70, 200, 70, 0.1);
    color: #2da44e;
}

.exit-code.error {
    background: rgba(255, 100, 100, 0.1);
    color: #cf222e;
}

.exit-code-mini {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10px;
    font-weight: 600;
    padding: 0 5px;
    border-radius: 3px;
    flex-shrink: 0;
}

.exit-code-mini.success {
    background: rgba(70, 200, 70, 0.1);
    color: #2da44e;
}

.exit-code-mini.error {
    background: rgba(255, 100, 100, 0.1);
    color: #cf222e;
}

/* ── Session list ───────────────────────────────────────────── */
.session-list {
    max-height: 320px;
    overflow-y: auto;
}

.session-list-item {
    padding: 6px 8px;
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}

.session-list-item:first-child {
    border-top: none;
}

.session-list-line {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 3px;
}

.session-list-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
}

/* ── 系统通知后缀 ───────────────────────────────────────────── */
.extra-text {
    margin-top: 6px;
    padding: 4px 8px;
    border-radius: 4px;
    background: rgba(var(--v-theme-on-surface), 0.03);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    line-height: 1.55;
    color: rgba(var(--v-theme-on-surface), 0.55);
    white-space: pre-wrap;
    word-break: break-word;
}
</style>
