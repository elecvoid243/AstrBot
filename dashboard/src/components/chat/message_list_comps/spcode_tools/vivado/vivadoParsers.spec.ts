/**
 * vivadoParsers.spec.ts
 *
 * 单元测试 vivado 工具返回值解析器。
 * 这些解析器是纯函数（输入 text，输出 typed data），是最容易测、
 * 收益最大的部分。
 *
 * Author: elecvoid243
 * Date: 2026-07-27
 */
import { describe, expect, it } from "vitest";
import {
    parseStartSessionFromText,
    parseStopSessionFromText,
    parseListSessionsFromText,
    parseFlowResultFromText,
    parseBitstreamBlockFromText,
    parseTclOutputFromText,
    parseXprFromText,
    parseBitHeaderFromText,
    parseCompareXciFromText,
    parseXdcLintFromText,
    parseVerilogCheckFromText,
    parseTimingReportFromText,
    parseUtilizationFromText,
    parseBitstreamReadinessFromText,
    parseRunProgressFromText,
    parseCriticalWarningsFromText,
    parseIoVerificationFromText,
    parseProgramDeviceFromText,
    parseWaveZoomFromText,
    parseWaveAnalogFromText,
} from "./vivadoParsers";
import { getVivadoIcon, isVivadoToolName, VIVADO_TOOL_TITLES } from "./vivadoIcons";
import { normalizeVerdict } from "./vivadoLabels";

// ────────────────────────────────────────────────────────────────
//  vivadoIcons.ts
// ────────────────────────────────────────────────────────────────

describe("vivadoIcons", () => {
    it("返回 30 个工具的合法名称集合", () => {
        expect(VIVADO_TOOL_TITLES).toHaveProperty("mcp_vivado__start_session");
        expect(VIVADO_TOOL_TITLES).toHaveProperty("mcp_vivado__set_wave_analog");
        expect(Object.keys(VIVADO_TOOL_TITLES).length).toBeGreaterThanOrEqual(28);
    });

    it("isVivadoToolName 检测 mcp_vivado__ 前缀", () => {
        expect(isVivadoToolName("mcp_vivado__start_session")).toBe(true);
        expect(isVivadoToolName("mcp_vivado__set_wave_analog")).toBe(true);
        expect(isVivadoToolName("astrbot_execute_shell")).toBe(false);
        expect(isVivadoToolName("code_check")).toBe(false);
        expect(isVivadoToolName("")).toBe(false);
    });

    it("getVivadoIcon 已知工具返回非默认 icon，未知工具返回 wrench", () => {
        expect(getVivadoIcon("mcp_vivado__start_session")).toBe("mdi-play-circle-outline");
        expect(getVivadoIcon("mcp_vivado__run_synthesis")).toBe("mdi-rocket-launch-outline");
        expect(getVivadoIcon("unknown_tool")).toBe("mdi-wrench");
    });
});

// ────────────────────────────────────────────────────────────────
//  A. 会话生命周期
// ────────────────────────────────────────────────────────────────

describe("parseStartSessionFromText", () => {
    it("解析典型 start_session 输出", () => {
        const text = `会话 'default' 已就绪（mode=gui）。
Vivado: D:/Xilinx/Vivado/2024.1/bin/vivado.bat
状态: READY

--- 启动信息 ---
Tcl Console ready
Compilation started
Some banner text
`;
        const r = parseStartSessionFromText(text);
        expect(r).not.toBeNull();
        expect(r?.sessionId).toBe("default");
        expect(r?.mode).toBe("gui");
        expect(r?.vivadoPath).toBe("D:/Xilinx/Vivado/2024.1/bin/vivado.bat");
        expect(r?.state).toBe("READY");
        expect(r?.banner).toContain("Tcl Console ready");
    });

    it("解析带 ascii warning 的输出", () => {
        const text = `会话 'proj' 已就绪（mode=tcl）。
Vivado: D:/中文/路径/vivado.bat
状态: READY

--- 启动信息 ---
Vivado v2024.1
⚠ 警告:检测到路径含非 ASCII 字符:
   vivado_path: D:/中文/路径/vivado.bat
   Vivado 2019.x 在中文路径下可能触发 TclStackFree 崩溃
`;
        const r = parseStartSessionFromText(text);
        expect(r?.asciiWarning).toContain("非 ASCII 字符");
        expect(r?.asciiWarning).toContain("TclStackFree");
        expect(r?.banner).toContain("Vivado v2024.1");
    });

    it("空字符串返回 null", () => {
        expect(parseStartSessionFromText("")).toBeNull();
    });
});

describe("parseStopSessionFromText", () => {
    it("解析 stop_session 输出", () => {
        const r = parseStopSessionFromText("会话 'default' 已停止");
        expect(r?.sessionId).toBe("default");
        expect(r?.message).toContain("default");
    });
});

describe("parseListSessionsFromText", () => {
    it("解析 JSON 列表", () => {
        const text = JSON.stringify([
            { id: "default", mode: "gui", state: "busy", pid: 12345, vivado_path: "D:/x/vivado.bat", started_at: 1234567890 },
            { id: "synth_1", mode: "tcl", state: "idle", pid: 12346 },
        ]);
        const r = parseListSessionsFromText(text);
        expect(r?.sessions).toHaveLength(2);
        expect(r?.sessions[0]?.sessionId).toBe("default");
        expect(r?.sessions[0]?.pid).toBe(12345);
        expect(r?.sessions[1]?.state).toBe("idle");
    });

    it("非 JSON 文本返回 raw 但 sessions 为空", () => {
        const r = parseListSessionsFromText("当前没有活跃的 Vivado 会话");
        expect(r?.sessions).toEqual([]);
        expect(r?.raw).toContain("没有活跃");
    });
});

// ────────────────────────────────────────────────────────────────
//  B. 长任务
// ────────────────────────────────────────────────────────────────

describe("parseFlowResultFromText", () => {
    it("解析 run_synthesis 正常输出", () => {
        const text = `!! 发现 2 条 CRITICAL WARNING !!
--- 综合结果 ---
状态: synth_design Complete!
进度: 100
耗时: 00:05:23
applied_generic: (无)
applied_verilog_define: (无)

诊断概览: errors=0, critical_warnings=2, warnings=15
`;
        const r = parseFlowResultFromText(text, "综合");
        expect(r?.status).toBe("synth_design Complete!");
        expect(r?.progress).toBe(100);
        expect(r?.elapsed).toBe("00:05:23");
        expect(r?.diagnostic.errors).toBe(0);
        expect(r?.diagnostic.criticalWarnings).toBe(2);
        expect(r?.diagnostic.warnings).toBe(15);
        expect(r?.overrideLines).toHaveLength(2);
        expect(r?.isError).toBe(false);
    });

    it("解析 generate_bitstream 比特流目录", () => {
        const text = `--- 比特流生成结果 ---
状态: write_bitstream Complete!
进度: 100
耗时: 00:00:30
比特流目录: D:/proj/proj.runs/impl_1

诊断概览: errors=0, critical_warnings=0, warnings=0
`;
        const r = parseFlowResultFromText(text, "比特流");
        expect(r?.bitstreamDir).toBe("D:/proj/proj.runs/impl_1");
        expect(r?.label).toBe("比特流");
    });

    it("解析 [ERROR] 开头", () => {
        const r = parseFlowResultFromText("[ERROR] 综合超时（30 分钟），最后状态: running", "综合");
        expect(r?.isError).toBe(true);
    });
});

describe("parseBitstreamBlockFromText", () => {
    it("解析 BLOCK 模式（CW 阻塞）", () => {
        const text = `!! 安全检查未通过: 发现 5 条 CRITICAL WARNING !!
实现状态: route_design Complete!

前 10 条 CRITICAL WARNING 样本:
  - [Vivado 12-1411] 引脚冲突 clk vs rst
  - [Common 17-69] Command failed: set_property
  - [Vivado 12-507] ...

建议: 调 get_critical_warnings impl_1 查看详情
`;
        const r = parseBitstreamBlockFromText(text);
        expect(r?.status).toBe("route_design Complete!");
        expect(r?.samples).toHaveLength(3);
        expect(r?.samples[0]).toContain("[Vivado 12-1411]");
    });
});

// ────────────────────────────────────────────────────────────────
//  C. Tcl 透传
// ────────────────────────────────────────────────────────────────

describe("parseTclOutputFromText", () => {
    it("分离原始输出和 quirk hint", () => {
        const text = `D:/proj/proj.runs/impl_1

提示: 超时≠命令失败:Vivado 仍在执行,本 session 在该命令完成前不可用。
`;
        const r = parseTclOutputFromText(text, "set foo bar");
        expect(r.output).toBe("D:/proj/proj.runs/impl_1");
        expect(r.hasQuirkHints).toBe(true);
        expect(r.quirks[0]).toContain("超时");
    });

    it("无 quirk hint 时 isError 判定", () => {
        const r = parseTclOutputFromText("[ERROR] 命令执行失败: foo not found", "foo");
        expect(r.isError).toBe(true);
        expect(r.hasQuirkHints).toBe(false);
    });
});

// ────────────────────────────────────────────────────────────────
//  D. 离线解析
// ────────────────────────────────────────────────────────────────

describe("parseXprFromText", () => {
    it("解析 .xpr 输出", () => {
        const text = `=== Vivado 工程: my_proj ===
Part: xc7a35tcpg236-1
顶层模块: top_module
目录: D:/proj

synth_1: Vivado Synthesis Defaults
impl_1: Performance_Explore
`;
        const r = parseXprFromText(text);
        expect(r?.projectName).toBe("my_proj");
        expect(r?.part).toBe("xc7a35tcpg236-1");
        expect(r?.top).toBe("top_module");
        expect(r?.synthStrategy).toBe("Vivado Synthesis Defaults");
        expect(r?.implStrategy).toBe("Performance_Explore");
    });
});

describe("parseBitHeaderFromText", () => {
    it("解析 .bit 头部", () => {
        const text = `=== 比特流头部 ===
设计名: top_module
目标 Part (原始): 7k325tffg900
目标 Part (规整): xc7k325t
构建日期: 2024/1/15 10:30:45
SHA256: a1b2c3d4e5f6
`;
        const r = parseBitHeaderFromText(text);
        expect(r?.designName).toBe("top_module");
        expect(r?.partRaw).toBe("7k325tffg900");
        expect(r?.partNorm).toBe("xc7k325t");
        expect(r?.buildDate).toBe("2024/1/15 10:30:45");
    });
});

describe("parseCompareXciFromText", () => {
    it("解析 XCI 差异", () => {
        const text = `=== XCI 对比 ===
A: golden.xci
B: working.xci

--- 差异参数 (2) ---
CONFIG.PF0_DEVICE_ID:
  A = 0x8086
  B = 0x1234
CONFIG.PF0_LINK_WIDTH:
  A = 4
  B = 1

--- 相同参数 (47) ---
`;
        const r = parseCompareXciFromText(text);
        expect(r?.diffParams).toHaveLength(2);
        expect(r?.diffParams[0]?.name).toBe("CONFIG.PF0_DEVICE_ID");
        expect(r?.diffParams[0]?.a).toBe("0x8086");
        expect(r?.diffParams[0]?.b).toBe("0x1234");
        expect(r?.sameCount).toBe(47);
    });
});

describe("parseXdcLintFromText", () => {
    it("解析 XDC 检查结果", () => {
        const text = `=== XDC 静态检查 ===

[CRITICAL] PIN_CONFLICT (1)
  pinout.xdc:14 ...

[CRITICAL] MISSING_IOSTANDARD (2)
  pinout.xdc:8 ...

[WARN] CLOCK_NO_PERIOD (1)
  timing.xdc:3 ...
`;
        const r = parseXdcLintFromText(text);
        expect(r?.errorCount).toBe(3);
        expect(r?.warnCount).toBe(1);
        expect(r?.issues).toHaveLength(3);
        expect(r?.issues[0]?.ruleId).toBe("PIN_CONFLICT");
        expect(r?.issues[0]?.count).toBe(1);
    });
});

describe("parseVerilogCheckFromText", () => {
    it("解析 Verilog 编译结果", () => {
        const text = `=== Verilog 编译检查 (iverilog) ===
文件: 2 个

[OK] top.v (1个文件, 0.12s)
[ERROR] bad.v:5 syntax error near 'endmodule'
[WARN] bad.v:10 unused signal
`;
        const r = parseVerilogCheckFromText(text);
        expect(r?.tool).toBe("iverilog");
        expect(r?.files).toHaveLength(2);
        expect(r?.files[0]?.passed).toBe(true);
        expect(r?.files[0]?.elapsed).toBe(0.12);
        expect(r?.files[1]?.passed).toBe(false);
        expect(r?.files[1]?.errorCount).toBe(1);
        expect(r?.files[1]?.issues[0]).toContain("L5");
    });
});

// ────────────────────────────────────────────────────────────────
//  E. 结构化报告
// ────────────────────────────────────────────────────────────────

describe("parseTimingReportFromText", () => {
    it("解析 PASS 时序报告", () => {
        const text = `=== 时序摘要 ===
WNS: +0.123 ns
WHS: +0.045 ns
失败端点: 0/1234
数据源: post-route

✅ PASS Timing MET
`;
        const r = parseTimingReportFromText(text);
        expect(r?.wns).toBe(0.123);
        expect(r?.whs).toBe(0.045);
        expect(r?.failingEndpoints).toBe(0);
        expect(r?.totalEndpoints).toBe(1234);
        expect(r?.status).toBe("met");
        expect(r?.sourceStage).toBe("post-route");
    });

    it("解析 FAIL 时序报告", () => {
        const text = `WNS: -1.234 ns
WHS: +0.100 ns
失败端点: 5/1234
❌ FAIL Timing NOT MET
`;
        const r = parseTimingReportFromText(text);
        expect(r?.status).toBe("fail");
        expect(r?.wns).toBe(-1.234);
    });

    it("解析 NA 时序报告", () => {
        const text = `WNS: 0 ns
WHS: 0 ns
失败端点: 0/0
⚠ NA 无时序约束
`;
        const r = parseTimingReportFromText(text);
        expect(r?.status).toBe("na");
    });
});

describe("parseUtilizationFromText", () => {
    it("解析资源占用表格", () => {
        const text = `| Resource          | Used | Available | Util% |
| Slice LUTs        | 1234 | 20800     |  5.9% |
| Slice Registers   | 2345 | 41600     |  5.6% |
| Block RAM Tile    |   10 |    50     | 20.0% |
| Bonded IOB        |   42 |   100     | 42.0% |
`;
        const r = parseUtilizationFromText(text);
        expect(r?.resources).toHaveLength(4);
        const luts = r?.resources.find((x) => x.name === "Slice LUTs");
        expect(luts?.used).toBe(1234);
        expect(luts?.percent).toBe(5.9);
        expect(luts?.critical).toBe(false);
    });

    it("高占用 (>=90%) 标记 critical", () => {
        const text = `| DSPs | 85 | 90 | 94.4% |`;
        const r = parseUtilizationFromText(text);
        const dsp = r?.resources.find((x) => x.name === "DSPs");
        expect(dsp?.critical).toBe(true);
    });

    it("中等占用 (70-90%) 标记 warn", () => {
        const text = `| DSPs | 70 | 90 | 77.8% |`;
        const r = parseUtilizationFromText(text);
        const dsp = r?.resources.find((x) => x.name === "DSPs");
        expect(dsp?.warn).toBe(true);
        expect(dsp?.critical).toBe(false);
    });
});

describe("parseBitstreamReadinessFromText", () => {
    it("解析 READY verdict", () => {
        const text = `=== 烧板前检查: READY (可以安全生成比特流) ===
实现状态: route_design Complete!
CRITICAL WARNING: 0
时序摘要:
  WNS = +0.123 ns  WHS = +0.045 ns  失败端点 = 0/1234
`;
        const r = parseBitstreamReadinessFromText(text);
        expect(r?.verdict).toBe("READY");
        expect(r?.status).toBe("route_design Complete!");
        expect(r?.cwCount).toBe(0);
        expect(r?.timingMet).toBe(true);
        expect(r?.wns).toBe(0.123);
    });

    it("解析 BLOCK verdict + 阻塞问题", () => {
        const text = `=== 烧板前检查: BLOCK (阻塞,不建议生成比特流) ===
实现状态: route_design ERROR
CRITICAL WARNING: 5

阻塞问题:
  [X] impl_1 执行错误: route_design ERROR
  [X] CRITICAL WARNING 数量过多: 5 条

CRITICAL WARNING 样本(前 5 条):
  - [Vivado 12-1411] 引脚冲突
  - [Common 17-69] ...

建议: 运行 get_critical_warnings 查看详情,修复后再烧板。
`;
        const r = parseBitstreamReadinessFromText(text);
        expect(r?.verdict).toBe("BLOCK");
        expect(r?.cwCount).toBe(5);
        expect(r?.blockers).toHaveLength(2);
        expect(r?.samples).toHaveLength(2);
    });

    it("解析 DEGRADED verdict", () => {
        const text = `=== 烧板前检查: WARN [DEGRADED] ===
实现状态: route_design Complete!
CRITICAL WARNING: 0

风险提示:
  [!] 未能读取时序摘要: 设计无时序约束
`;
        const r = parseBitstreamReadinessFromText(text);
        expect(r?.verdict).toBe("WARN [DEGRADED]");
        expect(r?.warnings).toHaveLength(1);
    });
});

describe("parseRunProgressFromText", () => {
    it("解析 run 进度", () => {
        const text = `=== run 进度: impl_1 ===
状态: route_design Complete!
进度: 100
启动时间: 14:00:00
运行时长: 00:15:30

最近 Phase:
  Phase 1: Synthesis
  Phase 2.1: Place Design
  Phase 3: Route Design

日志尾部 (tail 5 行):
  line1
  line2
`;
        const r = parseRunProgressFromText(text);
        expect(r?.runName).toBe("impl_1");
        expect(r?.progress).toBe(100);
        expect(r?.elapsed).toBe("00:15:30");
        expect(r?.phases).toHaveLength(3);
        expect(r?.phases[0]).toBe("Synthesis");
        expect(r?.logTail).toHaveLength(2);
    });
});

// ────────────────────────────────────────────────────────────────
//  F. 诊断 / 烧板 / 波形
// ────────────────────────────────────────────────────────────────

describe("parseCriticalWarningsFromText", () => {
    it("解析有 CW + 差分", () => {
        const text = `errors=2, critical_warnings=5, warnings=23

!! 发现 5 条 CRITICAL WARNING !!

--- CRITICAL WARNING 分组 ---
[Vivado 12-1411] 引脚冲突 (1 处)
  样本: [Coretcl 2-1411] clk vs rst
  修复: 删除冲突的 PACKAGE_PIN
[Common 17-69] Command failed (4 处)
  样本: [Common 17-69] set_property failed
  修复: 检查 XDC 语法

--- ERROR 分组 ---
[Common 17-69] syntax error (2 处)

=== CW 差分报告 ===
✅ 已消除 (3 条):
  - [Vivado 12-1411] 引脚冲突
  - [Common 17-69] set_property
  - [Vivado 12-507] ...
❌ 新增 (1 条):
  - [Vivado 12-1411] 引脚冲突
⚠ 仍存在 (2 条):
  - [Common 17-69] set_property
  - [Vivado 12-1411] 引脚冲突
`;
        const r = parseCriticalWarningsFromText(text);
        expect(r?.diagnostic.errors).toBe(2);
        expect(r?.diagnostic.criticalWarnings).toBe(5);
        expect(r?.cwGroups).toHaveLength(2);
        expect(r?.cwGroups[0]?.warningId).toBe("[Vivado 12-1411]");
        expect(r?.cwGroups[0]?.count).toBe(1);
        expect(r?.cwGroups[0]?.sample).toContain("clk vs rst");
        expect(r?.errorGroups).toHaveLength(1);
        expect(r?.diff?.resolved).toHaveLength(3);
        expect(r?.diff?.added).toHaveLength(1);
        expect(r?.diff?.stillPresent).toHaveLength(2);
    });

    it("解析干净诊断（无 CW）", () => {
        const text = `errors=0, critical_warnings=0, warnings=23
未发现 ERROR 或 CRITICAL WARNING。
`;
        const r = parseCriticalWarningsFromText(text);
        expect(r?.diagnostic.errors).toBe(0);
        expect(r?.cwGroups).toHaveLength(0);
        expect(r?.diff).toBeNull();
    });

    it("解析 [ERROR] 开头", () => {
        const r = parseCriticalWarningsFromText("[ERROR] 未找到 runme.log");
        expect(r?.isError).toBe(true);
    });

    it("解析非标错误兜底段", () => {
        const text = `errors=0, critical_warnings=0, warnings=23
!! Vivado messageDb 显示无 ERROR/CW,但日志末尾发现非标错误 !!

=== 非标错误 (runme.log tail) ===
[TclStackFree] 第 1234 行: incorrect freePtr
[segfault] 第 5678 行: ...
`;
        const r = parseCriticalWarningsFromText(text);
        expect(r?.nonstandardSection).toContain("TclStackFree");
        expect(r?.nonstandardSection).toContain("segfault");
    });
});

describe("parseIoVerificationFromText", () => {
    it("解析 GT CRITICAL + GPIO WARNING 不匹配", () => {
        const text = `=== IO 引脚分配验证 ===

❌ CRITICAL 不匹配 (GT 端口, 2 个):
  - gt_rx_p[0] Y5 → E5
  - gt_tx_p[0] Y6 → E6

⚠ WARNING 不匹配 (GPIO 端口, 1 个):
  - sw[0] V17 → U17

✅ 一致 (37 个):
  - clk
  - led[0]
`;
        const r = parseIoVerificationFromText(text);
        expect(r?.matches).toBe(37);
        const crit = r?.mismatches.filter((m) => m.severity === "CRITICAL");
        const warn = r?.mismatches.filter((m) => m.severity === "WARNING");
        expect(crit).toHaveLength(2);
        expect(crit?.[0]?.port).toBe("gt_rx_p[0]");
        expect(crit?.[0]?.xdc).toBe("Y5");
        expect(crit?.[0]?.actual).toBe("E5");
        expect(crit?.[0]?.type).toBe("GT");
        expect(warn).toHaveLength(1);
        expect(warn?.[0]?.type).toBe("GPIO");
    });
});

describe("parseProgramDeviceFromText", () => {
    it("解析烧板结果", () => {
        const text = `--- Vivado 烧板 ---
比特流 D:/proj/proj.runs/impl_1/top.bit
HW Server localhost:3121
目标 localhost:3121/xilinx_tcf/Xilinx/1234/0
设备 xc7a35t_0

烧板过程:
open_hw_manager ✓
connect_hw_server ✓
open_hw_target ✓
program_hw_devices ✓
编程完成: xc7a35t_0
`;
        const r = parseProgramDeviceFromText(text);
        expect(r?.bitstreamPath).toBe("D:/proj/proj.runs/impl_1/top.bit");
        expect(r?.device).toBe("xc7a35t_0");
        expect(r?.steps.length).toBeGreaterThanOrEqual(4);
        expect(r?.steps.every((s) => s.ok)).toBe(true);
        expect(r?.isError).toBe(false);
    });

    it("解析 [ERROR] 开头", () => {
        const r = parseProgramDeviceFromText("[ERROR] 比特流文件不存在: foo");
        expect(r?.isError).toBe(true);
    });
});

describe("parseWaveZoomFromText", () => {
    it("解析成功", () => {
        const text = `[OK] 已设缩放窗 0~1000 ns 并重载: D:/proj/.../wave.wcfg`;
        const r = parseWaveZoomFromText(text);
        expect(r?.startNs).toBe(0);
        expect(r?.endNs).toBe(1000);
        expect(r?.wcfgPath).toBe("D:/proj/.../wave.wcfg");
        expect(r?.isError).toBe(false);
    });

    it("解析 [ERROR]", () => {
        const r = parseWaveZoomFromText("[ERROR] start_ns 须小于 end_ns");
        expect(r?.isError).toBe(true);
    });
});

describe("parseWaveAnalogFromText", () => {
    it("解析成功 + 部分失败", () => {
        const text = `Analog 设置(min=-2048, max=2047, interp=LINEAR, height=120):
  ✓ y0[15:0] (命中 /tb/u_dut/y0[15:0]) → STYLE_ANALOG
  ✓ y1[15:0] (命中 /tb/u_dut/y1[15:0]) → STYLE_ANALOG
  ✗ missing_sig → 波形里找不到该信号(请先 add_wave)
`;
        const r = parseWaveAnalogFromText(text);
        expect(r?.min).toBe(-2048);
        expect(r?.max).toBe(2047);
        expect(r?.interp).toBe("LINEAR");
        expect(r?.height).toBe(120);
        expect(r?.signals).toHaveLength(3);
        expect(r?.signals[0]?.ok).toBe(true);
        expect(r?.signals[0]?.matched).toBe("/tb/u_dut/y0[15:0]");
        expect(r?.signals[2]?.ok).toBe(false);
        expect(r?.signals[2]?.reason).toContain("找不到");
    });

    it("解析 [ERROR]", () => {
        const r = parseWaveAnalogFromText("[ERROR] signals 为空");
        expect(r?.isError).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────────
//  normalizeVerdict (vivadoLabels)
// ────────────────────────────────────────────────────────────────

describe("normalizeVerdict", () => {
    it("归一化已知 verdict", () => {
        expect(normalizeVerdict("READY")).toBe("ready");
        expect(normalizeVerdict("BLOCK")).toBe("block");
        expect(normalizeVerdict("BLOCK [DEGRADED]")).toBe("block");
        expect(normalizeVerdict("WARN")).toBe("warn");
        expect(normalizeVerdict("DEGRADED")).toBe("degraded");
        expect(normalizeVerdict("FAIL")).toBe("fail");
        expect(normalizeVerdict("OK")).toBe("ok");
        expect(normalizeVerdict("ERROR")).toBe("error");
        expect(normalizeVerdict("RUNNING")).toBe("running");
        expect(normalizeVerdict("COMPLETE")).toBe("complete");
        expect(normalizeVerdict("NA")).toBe("na");
    });

    it("未知 verdict 归一化为 unknown", () => {
        expect(normalizeVerdict("???")).toBe("unknown");
        expect(normalizeVerdict("")).toBe("unknown");
        expect(normalizeVerdict(null)).toBe("unknown");
        expect(normalizeVerdict(undefined)).toBe("unknown");
    });
});
