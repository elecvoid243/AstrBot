/**
 * vivado-mcp 工具的 mdi 图标 + 工具名集合。
 *
 * Author: elecvoid243
 * Date: 2026-07-27
 *
 * 30 个 mcp_vivado__* 工具（vivado-mcp 0.3.23 实际数量）。
 * 图标按"用户感知的功能"分配，不机械映射到 Vivado 域：
 *   - 启动 / 停止 / 列表 → 圆形 play / stop / list 图标
 *   - 综合 / 实现 / 烧板 → rocket / cog / upload 图标
 *   - 报告类 → chart / clock / chip / 文档 图标
 *   - 诊断类 → shield-alert / bug 图标
 *   - 波形 → waveform / chart-line 图标
 */
export const VIVADO_ICONS: Record<string, string> = {
    // ── A. 会话生命周期 ──
    mcp_vivado__start_session: "mdi-play-circle-outline",
    mcp_vivado__stop_session: "mdi-stop-circle-outline",
    mcp_vivado__list_sessions: "mdi-format-list-bulleted",

    // ── B. 长任务 + 进度 ──
    mcp_vivado__run_synthesis: "mdi-rocket-launch-outline",
    mcp_vivado__run_implementation: "mdi-cog-outline",
    mcp_vivado__generate_bitstream: "mdi-chip",
    mcp_vivado__program_device: "mdi-upload-outline",

    // ── C. Tcl 透传 ──
    mcp_vivado__run_tcl: "mdi-console-line",
    mcp_vivado__safe_tcl: "mdi-shield-check-outline",

    // ── D. 离线解析 ──
    mcp_vivado__parse_xpr: "mdi-xml",
    mcp_vivado__parse_bit_header: "mdi-file-document-outline",
    mcp_vivado__parse_ltx: "mdi-waveform",
    mcp_vivado__compare_xci: "mdi-vector-difference",
    mcp_vivado__verilog_compile_check: "mdi-language-typescript",
    mcp_vivado__xdc_lint: "mdi-shield-search",
    mcp_vivado__xdc_auto_fix: "mdi-auto-fix",

    // ── E. 结构化报告 ──
    mcp_vivado__get_io_report: "mdi-map-marker-outline",
    mcp_vivado__get_timing_report: "mdi-clock-fast",
    mcp_vivado__get_utilization_report: "mdi-chart-box-outline",
    mcp_vivado__get_project_info: "mdi-information-outline",
    mcp_vivado__get_run_progress: "mdi-progress-clock",
    mcp_vivado__get_ip_status: "mdi-chip",
    mcp_vivado__get_next_suggestion: "mdi-lightbulb-on-outline",
    mcp_vivado__get_pre_commit_summary: "mdi-source-commit",
    mcp_vivado__check_bitstream_readiness: "mdi-check-decagram-outline",
    mcp_vivado__inspect_ip_params: "mdi-tune-variant",

    // ── F. 诊断 + 烧板 + 波形 ──
    mcp_vivado__get_critical_warnings: "mdi-alert-octagon-outline",
    mcp_vivado__verify_io_placement_tool: "mdi-vector-link",
    mcp_vivado__set_wave_zoom: "mdi-magnify-scan",
    mcp_vivado__set_wave_analog: "mdi-chart-bell-curve",
};

/** 返回工具名对应的 mdi 图标；未知工具返回 mdi-wrench。 */
export function getVivadoIcon(toolName: string): string {
    return VIVADO_ICONS[toolName] ?? "mdi-wrench";
}

/** vivado-mcp 工具的合法名称集合（30 个）。 */
export const VIVADO_TOOL_NAMES: ReadonlySet<string> = new Set(
    Object.keys(VIVADO_ICONS),
);

/** 快速判断是否 vivado 工具（按 mcp_vivado__ 前缀，避免每次 Set.has）。 */
export function isVivadoToolName(name: string): boolean {
    return name?.startsWith("mcp_vivado__") ?? false;
}

/** 工具中文标题（用于 ToolCallCard / VivadoToolResultView 头部）。 */
export const VIVADO_TOOL_TITLES: Record<string, string> = {
    mcp_vivado__start_session: "Vivado 启动会话",
    mcp_vivado__stop_session: "Vivado 停止会话",
    mcp_vivado__list_sessions: "Vivado 列出会话",
    mcp_vivado__run_synthesis: "Vivado 综合",
    mcp_vivado__run_implementation: "Vivado 实现",
    mcp_vivado__generate_bitstream: "Vivado 生成比特流",
    mcp_vivado__program_device: "Vivado 烧板",
    mcp_vivado__run_tcl: "Vivado 执行 Tcl",
    mcp_vivado__safe_tcl: "Vivado 安全 Tcl",
    mcp_vivado__parse_xpr: "Vivado 解析工程",
    mcp_vivado__parse_bit_header: "Vivado 解析比特流",
    mcp_vivado__parse_ltx: "Vivado 解析 ILA 探针",
    mcp_vivado__compare_xci: "Vivado 对比 IP",
    mcp_vivado__verilog_compile_check: "Vivado Verilog 检查",
    mcp_vivado__xdc_lint: "Vivado 约束检查",
    mcp_vivado__xdc_auto_fix: "Vivado 约束自动修复",
    mcp_vivado__get_io_report: "Vivado IO 报告",
    mcp_vivado__get_timing_report: "Vivado 时序报告",
    mcp_vivado__get_utilization_report: "Vivado 资源占用",
    mcp_vivado__get_project_info: "Vivado 工程信息",
    mcp_vivado__get_run_progress: "Vivado 运行进度",
    mcp_vivado__get_ip_status: "Vivado IP 状态",
    mcp_vivado__get_next_suggestion: "Vivado 下一步建议",
    mcp_vivado__get_pre_commit_summary: "Vivado 工程摘要",
    mcp_vivado__check_bitstream_readiness: "Vivado 烧板前检查",
    mcp_vivado__inspect_ip_params: "Vivado IP 参数",
    mcp_vivado__get_critical_warnings: "Vivado 关键警告",
    mcp_vivado__verify_io_placement_tool: "Vivado IO 布局验证",
    mcp_vivado__set_wave_zoom: "Vivado 波形缩放",
    mcp_vivado__set_wave_analog: "Vivado 波形模拟显示",
};
