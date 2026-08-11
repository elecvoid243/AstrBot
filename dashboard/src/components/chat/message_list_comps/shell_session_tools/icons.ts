/**
 * astrbot_shell_session 工具的图标常量与会话状态元数据。
 *
 * 镜像 inta_shell_tools/icons.ts 的结构,集中维护 6 个 session action
 * 的 mdi 图标以及托管会话状态(status)的语义映射(标签、颜色、图标)。
 * 状态值与后端 LocalShellComponent (astrbot/core/computer/booters/local.py)
 * 的派生逻辑保持一致:running / completed / failed / timed_out / terminated。
 *
 * Author: elecvoid243 | 2026-08-11
 */

/** shell_session 工具支持的操作。 */
export type ShellSessionAction =
    | "list"
    | "poll"
    | "write"
    | "write_line"
    | "interrupt"
    | "terminate";

export const SHELL_SESSION_TOOL_NAME = "astrbot_shell_session";

/** 每个 action 的 mdi 图标(复用 inta_shell 的图标语义)。 */
export const SHELL_SESSION_ACTION_ICONS: Record<ShellSessionAction, string> = {
    list: "mdi-format-list-bulleted",
    poll: "mdi-eye-outline",
    write: "mdi-keyboard-outline",
    write_line: "mdi-keyboard-return",
    interrupt: "mdi-pause-circle-outline",
    terminate: "mdi-stop-circle-outline",
};

/**
 * 取 action 图标;未知/缺失 action 回退到通用控制台图标。
 * ToolCallCard 用它做 action 感知的工具卡片图标。
 */
export function getShellSessionActionIcon(
    action: string | null | undefined,
): string {
    if (action && action in SHELL_SESSION_ACTION_ICONS) {
        return SHELL_SESSION_ACTION_ICONS[action as ShellSessionAction];
    }
    return "mdi-console";
}

/** 托管会话状态(对应 local.py 中由 exit_code/timed_out/terminated 派生的 status)。 */
export type ShellSessionStatus =
    | "running"
    | "completed"
    | "failed"
    | "timed_out"
    | "terminated";

/** 状态元数据:i18n key 尾段 / mdi 图标 / 主题色(沿用 GitHub 风格色板)。 */
export interface ShellSessionStatusMeta {
    /** i18n key 的尾段,与 shellSession.stateLabels 配合。 */
    i18nKey: string;
    icon: string;
    color: string;
    /** 是否使用 pulse 动画(仅 running)。 */
    pulse?: boolean;
}

export const SHELL_SESSION_STATUS_META: Record<
    ShellSessionStatus,
    ShellSessionStatusMeta
> = {
    running: {
        i18nKey: "running",
        icon: "mdi-circle-medium",
        color: "#2da44e",
        pulse: true,
    },
    completed: {
        i18nKey: "completed",
        icon: "mdi-check-circle-outline",
        color: "#0969da",
    },
    failed: {
        i18nKey: "failed",
        icon: "mdi-alert-circle",
        color: "#cf222e",
    },
    timed_out: {
        i18nKey: "timedOut",
        icon: "mdi-timer-off-outline",
        color: "#bf8700",
    },
    terminated: {
        i18nKey: "terminated",
        icon: "mdi-stop-circle-outline",
        color: "#6e7781",
    },
};

/** 取状态元数据;未知状态回退到 terminated(中性灰)。 */
export function getShellSessionStatusMeta(
    status: string | null | undefined,
): ShellSessionStatusMeta {
    if (status && status in SHELL_SESSION_STATUS_META) {
        return SHELL_SESSION_STATUS_META[status as ShellSessionStatus];
    }
    return SHELL_SESSION_STATUS_META.terminated;
}
