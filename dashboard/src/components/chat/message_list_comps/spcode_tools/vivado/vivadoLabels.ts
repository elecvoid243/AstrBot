/**
 * vivado 工具的语义化标签 + 颜色映射。
 *
 * 把"verdict / CW severity / session state"等分散在各组件里的
 * 硬编码逻辑统一抽出来，便于测试和主题切换。
 *
 * Author: elecvoid243
 * Date: 2026-07-27
 */

import type { SessionStateMeta } from "../../inta_shell_tools/icons";

/* ─── Verdict 分类 ──────────────────────────────────────────── */

export type VivadoVerdict =
    | "ready"
    | "warn"
    | "block"
    | "degraded"
    | "met"
    | "fail"
    | "ok"
    | "error"
    | "na"
    | "running"
    | "complete"
    | "unknown";

export interface VerdictMeta {
    i18nKey: string; // 对应 features/chat.json -> vivadoTool.verdicts.{key}
    icon: string; // mdi 图标
    color: string; // 主色
    bgClass: string; // 背景色 CSS class（沿用 .status-row.success/.error/.warn）
    textClass: string;
}

/** 统一 verdict 配色表（GitHub 风格硬编码，与现有 spcode 组件一致）。 */
export const VERDICT_META: Record<VivadoVerdict, VerdictMeta> = {
    ready: {
        i18nKey: "ready",
        icon: "mdi-check-decagram",
        color: "#2da44e",
        bgClass: "status-row success",
        textClass: "verdict-text success",
    },
    warn: {
        i18nKey: "warn",
        icon: "mdi-alert",
        color: "#b58400",
        bgClass: "status-row warn",
        textClass: "verdict-text warn",
    },
    block: {
        i18nKey: "block",
        icon: "mdi-block-helper",
        color: "#cf222e",
        bgClass: "status-row error",
        textClass: "verdict-text error",
    },
    degraded: {
        i18nKey: "degraded",
        icon: "mdi-alert-circle-outline",
        color: "#cf222e",
        bgClass: "status-row degraded",
        textClass: "verdict-text error",
    },
    met: {
        i18nKey: "met",
        icon: "mdi-check-circle",
        color: "#2da44e",
        bgClass: "status-row success",
        textClass: "verdict-text success",
    },
    fail: {
        i18nKey: "fail",
        icon: "mdi-alert-circle",
        color: "#cf222e",
        bgClass: "status-row error",
        textClass: "verdict-text error",
    },
    ok: {
        i18nKey: "ok",
        icon: "mdi-check-circle",
        color: "#2da44e",
        bgClass: "status-row success",
        textClass: "verdict-text success",
    },
    error: {
        i18nKey: "fail",
        icon: "mdi-alert-circle",
        color: "#cf222e",
        bgClass: "status-row error",
        textClass: "verdict-text error",
    },
    na: {
        i18nKey: "na",
        icon: "mdi-help-circle-outline",
        color: "#8b949e",
        bgClass: "status-row neutral",
        textClass: "verdict-text neutral",
    },
    running: {
        i18nKey: "ok",
        icon: "mdi-progress-clock",
        color: "rgb(var(--v-theme-primary))",
        bgClass: "status-row running",
        textClass: "verdict-text running",
    },
    complete: {
        i18nKey: "ok",
        icon: "mdi-check-circle",
        color: "#2da44e",
        bgClass: "status-row success",
        textClass: "verdict-text success",
    },
    unknown: {
        i18nKey: "na",
        icon: "mdi-help-circle-outline",
        color: "#8b949e",
        bgClass: "status-row neutral",
        textClass: "verdict-text neutral",
    },
};

/** 把 vivado 原始 verdict 字符串（"READY" / "WARN" / "BLOCK" 等）归一化。 */
export function normalizeVerdict(raw: string | null | undefined): VivadoVerdict {
    if (!raw) return "unknown";
    const s = String(raw).toUpperCase();
    if (s.includes("READY") && !s.includes("DEGRADED")) return "ready";
    if (s.includes("BLOCK")) return "block";
    if (s.includes("DEGRADED")) return "degraded";
    if (s.includes("WARN")) return "warn";
    if (s.includes("MET") && !s.includes("UNMET") && !s.includes("FAIL")) return "met";
    if (s.includes("FAIL") || s.includes("VIOLAT")) return "fail";
    if (s.includes("ERROR") || s.includes("ABORT")) return "error";
    if (s.includes("RUNNING")) return "running";
    if (s.includes("COMPLETE")) return "complete";
    if (s.includes("NA") || s.includes("N/A")) return "na";
    if (s.includes("OK") || s.includes("PASS")) return "ok";
    return "unknown";
}

/* ─── Session 状态 ──────────────────────────────────────────── */

export const SESSION_STATE_META: Record<string, SessionStateMeta> = {
    idle: { i18nKey: "idle", icon: "mdi-circle-outline", color: "#8b949e", pulse: false },
    busy: { i18nKey: "busy", icon: "mdi-progress-clock", color: "rgb(var(--v-theme-primary))", pulse: true },
    error: { i18nKey: "error", icon: "mdi-alert-circle", color: "#cf222e", pulse: false },
    running: { i18nKey: "busy", icon: "mdi-progress-clock", color: "rgb(var(--v-theme-primary))", pulse: true },
    ready: { i18nKey: "idle", icon: "mdi-check-circle-outline", color: "#2da44e", pulse: false },
    terminated: { i18nKey: "terminated", icon: "mdi-stop-circle-outline", color: "#8b949e", pulse: false },
};

export function getVivadoSessionStateMeta(state: string): SessionStateMeta {
    return SESSION_STATE_META[state?.toLowerCase() ?? ""] ?? {
        i18nKey: "idle",
        icon: "mdi-help-circle-outline",
        color: "#8b949e",
        pulse: false,
    };
}

/* ─── 诊断计数 (ERROR / CW / WARN) ─────────────────────────── */

export const DIAG_TYPE_META = {
    errors: {
        i18nKey: "errors",
        color: "#cf222e",
        icon: "mdi-alert-circle",
        bgClass: "num-cell error",
    },
    criticalWarnings: {
        i18nKey: "criticalWarnings",
        color: "#b58400",
        icon: "mdi-alert",
        bgClass: "num-cell warn",
    },
    warnings: {
        i18nKey: "warnings",
        color: "#8b949e",
        icon: "mdi-alert-outline",
        bgClass: "num-cell neutral",
    },
} as const;

export type DiagType = keyof typeof DIAG_TYPE_META;
