<template>
    <div class="todo-list-panel">
        <!-- 列表标题(umo 形式的原始 ID 不展示,由 displayTitle 过滤) -->
        <div v-if="showHeader && displayTitle" class="list-header">
            <v-icon size="14">mdi-format-list-checks</v-icon>
            <span class="list-title">{{ displayTitle }}</span>
        </div>

        <!-- 进度条:细圆角轨道 + 柔和分段色,与 ChatUI 的克制配色一致 -->
        <div class="progress-track">
            <div
                class="progress-segment done"
                :style="{ width: progressWidths.done }"
                :title="`${stats?.done || 0} done`"
            ></div>
            <div
                class="progress-segment in-progress"
                :style="{ width: progressWidths.inProgress }"
                :title="`${stats?.in_progress || 0} in progress`"
            ></div>
            <div
                class="progress-segment pending"
                :style="{ width: progressWidths.pending }"
                :title="`${stats?.pending || 0} pending`"
            ></div>
            <div
                class="progress-segment cancelled"
                :style="{ width: progressWidths.cancelled }"
                :title="`${stats?.cancelled || 0} cancelled`"
            ></div>
        </div>

        <!-- 统计行 + 批量折叠/展开(合并原 stats-footer,减少纵向噪音) -->
        <div class="panel-meta">
            <span class="meta-stats">
                {{ tm("todo.statsLine", {
                    done: stats?.done || 0,
                    total: stats?.effective_total || 0,
                    pct: stats?.progress_pct || 0,
                }) }}
                <template v-if="stats?.in_progress">
                    {{ " " + tm("todo.statsInProgress", { count: stats.in_progress }) }}
                </template>
            </span>
            <div v-if="collapsible" class="bulk-toggles">
                <button
                    type="button"
                    class="bulk-toggle-btn"
                    :disabled="!hasExpandableItems"
                    @click="expandAll"
                >
                    <v-icon size="12">mdi-unfold-more-horizontal</v-icon>
                    <span>{{ tm("todo.expandAll") }}</span>
                </button>
                <button
                    type="button"
                    class="bulk-toggle-btn"
                    :disabled="!hasExpandableItems"
                    @click="collapseAll"
                >
                    <v-icon size="12">mdi-unfold-less-horizontal</v-icon>
                    <span>{{ tm("todo.collapseAll") }}</span>
                </button>
            </div>
        </div>

        <!-- Items -->
        <div class="items-list">
            <div
                v-for="item in list?.items || []"
                :key="item.id"
                class="todo-item"
                :class="[
                    'status-' + item.status,
                    { 'has-notes': item.notes, 'is-clickable': collapsible && hasNotes(item) },
                ]"
                @click="collapsible && hasNotes(item) ? toggle(item.id) : null"
            >
                <v-icon
                    v-if="collapsible"
                    size="12"
                    class="item-chevron"
                    :class="{ 'is-expanded': isExpanded(item.id) }"
                >
                    mdi-chevron-right
                </v-icon>
                <v-icon
                    size="14"
                    class="item-check"
                >
                    {{ statusIcon(item.status) }}
                </v-icon>
                <span class="item-id">{{ item.id }}</span>
                <span class="item-title">{{ item.title }}</span>
                <v-icon
                    v-if="item.attention"
                    size="12"
                    class="attention-icon"
                    title="Needs attention"
                >
                    mdi-alert-circle
                </v-icon>
                <span
                    v-if="item.notes && showNotes(item)"
                    class="item-notes"
                >{{ item.notes }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useModuleI18n } from "@/i18n/composables";

/**
 * TodoListPanel — 复用组件：渲染 todo_list 工具回传的完整列表视图（进度条 + items + 统计）。
 *
 * 原实现在 TodoListResult.vue 中,因侧边栏也需要同一份视图,故抽离为独立组件。
 * 接受的是已经剥离 envelope 后的 {list, stats, attention_items},由调用方保证。
 *
 * collapsible: 侧边栏等"实时监控"场景下,默认折叠每条 item,只露出状态/标题/ID,
 * 点击行(或 chevron)展开 notes。配合统计行右侧的 Expand / Collapse
 * 按钮可批量切换。TodoListResult(工具结果回显)继续走 false,行为不变。
 *
 * showHeader: 是否展示列表标题行。侧边栏自身已有标题,传 false 隐藏;
 * 工具结果回显保留默认 true。标题为 umo 形式(含 "!")时不展示。
 */
const props = withDefaults(
    defineProps<{
        list: any;
        stats: any;
        attentionItems?: number[];
        collapsible?: boolean;
        showHeader?: boolean;
    }>(),
    {
        attentionItems: () => [],
        collapsible: false,
        showHeader: true,
    },
);

const { tm } = useModuleI18n("features/chat");

/** 已展开的 item id 集合。仅在 collapsible=true 时使用。 */
const expandedIds = ref<Set<string | number>>(new Set());

/** 切到新会话/新 list 时清空展开状态,避免过期 id 残留。 */
watch(
    () => props.list,
    () => {
        expandedIds.value = new Set();
    },
);

/**
 * 展示用标题。后端在未显式指定 title 时会用 umo 兜底
 * (如 webchat:FriendMessage:webchat!user!cid),这类原始 ID 噪声大,
 * 直接不展示;只有用户/Agent 显式命名的标题才渲染。
 */
const displayTitle = computed(() => {
    const title: string = props.list?.title || "";
    if (!title) return "";
    if (title.includes("!") || /^[\w-]+:[\w-]+:/.test(title)) return "";
    return title;
});

/** 单条 item 的 notes 是否存在(决定是否可折叠,以及是否显示 chevron)。 */
function hasNotes(item: any): boolean {
    return Boolean(item && item.notes);
}

function isExpanded(id: string | number): boolean {
    return expandedIds.value.has(id);
}

function toggle(id: string | number): void {
    // 复制后再 set,避免直接 mutate ref 内部值
    const next = new Set(expandedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds.value = next;
}

/** collapsible 模式下 notes 才会显示;否则维持旧行为(总显示)。 */
function showNotes(item: any): boolean {
    return !props.collapsible || isExpanded(item.id);
}

const expandableItems = computed(() =>
    (props.list?.items || []).filter((it: any) => hasNotes(it)),
);
const hasExpandableItems = computed(() => expandableItems.value.length > 0);

function expandAll(): void {
    expandedIds.value = new Set(expandableItems.value.map((it: any) => it.id));
}

function collapseAll(): void {
    expandedIds.value = new Set();
}

function statusIcon(s: string): string {
    if (s === "done") return "mdi-check-circle";
    if (s === "in_progress") return "mdi-progress-clock";
    if (s === "cancelled") return "mdi-close-circle";
    return "mdi-circle-outline";
}

/** 把状态计数换算成进度条 segment 的宽度百分比（0%–100%）。 */
function pctWidth(count: number | undefined, total: number | undefined): string {
    if (!count || count <= 0 || !total || total <= 0) return "0%";
    const pct = (count / total) * 100;
    // 浮点累加可能让 4 段总和略超 100%,clamp 一下避免溢出
    return `${Math.min(pct, 100)}%`;
}

const progressWidths = computed(() => {
    const stats = props.stats;
    if (!stats) {
        return { done: "0%", inProgress: "0%", pending: "0%", cancelled: "0%" };
    }
    const total = stats.total ?? 0;
    return {
        done: pctWidth(stats.done, total),
        inProgress: pctWidth(stats.in_progress, total),
        pending: pctWidth(stats.pending, total),
        cancelled: pctWidth(stats.cancelled, total),
    };
});
</script>

<style scoped>
.todo-list-panel {
    font-size: 12.5px;
    width: 100%;
    box-sizing: border-box;
}

/* 列表标题 */
.list-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 10px;
    font-size: 12px;
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.75);
}

/* 进度条:细圆角轨道,分段色取自 Vuetify 主题,自动适配明暗 */
.progress-track {
    display: flex;
    height: 5px;
    border-radius: 999px;
    background: rgba(var(--v-theme-on-surface), 0.07);
    overflow: hidden;
    width: 100%;
    box-sizing: border-box;
}
.progress-segment {
    transition: width 0.3s ease;
    min-width: 0;
    flex-shrink: 1;
}
.progress-segment.done { background: rgba(var(--v-theme-success), 0.85); }
.progress-segment.in-progress { background: rgba(var(--v-theme-warning), 0.95); }
.progress-segment.pending { background: rgba(var(--v-theme-on-surface), 0.14); }
.progress-segment.cancelled { background: rgba(var(--v-theme-on-surface), 0.08); }

/* 统计行 + 批量操作 */
.panel-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 8px 0 8px;
}
.meta-stats {
    font-size: 11.5px;
    color: rgba(var(--v-theme-on-surface), 0.55);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.bulk-toggles {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
}
.bulk-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    font-size: 11px;
    line-height: 1.5;
    color: rgba(var(--v-theme-on-surface), 0.5);
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
}
.bulk-toggle-btn:hover:not(:disabled) {
    background: rgba(var(--v-theme-on-surface), 0.06);
    color: rgba(var(--v-theme-on-surface), 0.85);
}
.bulk-toggle-btn:disabled {
    opacity: 0.35;
    cursor: default;
}

/* Items:无底色净行,hover 才浮现背景,贴近 ChatUI 的留白风格 */
.items-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.todo-item {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 12.5px;
    line-height: 1.55;
    user-select: none;
}
.todo-item.is-clickable {
    cursor: pointer;
    transition: background 0.12s ease;
}
.todo-item.is-clickable:hover {
    background: rgba(var(--v-theme-on-surface), 0.045);
}

/* Chevron 旋转 */
.item-chevron {
    color: rgba(var(--v-theme-on-surface), 0.35);
    transition: transform 0.18s ease;
    flex-shrink: 0;
    align-self: center;
}
.item-chevron.is-expanded {
    transform: rotate(90deg);
    color: rgba(var(--v-theme-on-surface), 0.65);
}

/* 状态图标配色:与进度条分段同源 */
.status-done .item-check { color: rgb(var(--v-theme-success)); }
.status-in_progress .item-check { color: rgb(var(--v-theme-warning)); }
.status-cancelled .item-check { color: rgba(var(--v-theme-on-surface), 0.3); }
.status-pending .item-check { color: rgba(var(--v-theme-on-surface), 0.3); }

/* 已完成条目降透明度,让未完成项成为视觉焦点 */
.status-done .item-title,
.status-done .item-id {
    opacity: 0.5;
}
.status-cancelled .item-title {
    text-decoration: line-through;
    opacity: 0.45;
}

.item-id {
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    color: rgba(var(--v-theme-on-surface), 0.45);
    min-width: 12px;
    text-align: right;
}
.item-id::after {
    content: ".";
}
.item-title {
    flex: 1;
    min-width: 0;
    color: rgba(var(--v-theme-on-surface), 0.87);
}
.attention-icon { color: rgb(var(--v-theme-warning)); }

/* notes:左侧竖线引用块,替代原来的斜体灰字 */
.item-notes {
    flex-basis: 100%;
    margin: 1px 0 2px;
    padding: 2px 0 2px 10px;
    border-left: 2px solid rgba(var(--v-theme-on-surface), 0.12);
    font-size: 11.5px;
    line-height: 1.5;
    color: rgba(var(--v-theme-on-surface), 0.55);
    white-space: pre-wrap;
    word-break: break-word;
}
</style>
