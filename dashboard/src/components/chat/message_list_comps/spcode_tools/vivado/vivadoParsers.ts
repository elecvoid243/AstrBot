/**
 * vivado-mcp 工具返回值解析器。
 *
 * vivado-mcp 0.3.23 全部 30 个工具统一返回纯文本字符串（人类可读的中文/英文报告）。
 * 本文件把每种工具的输出解析为强类型结构化对象，组件只负责渲染。
 *
 * 解析器命名规则:parse<Shape>FromText(text) -> Shape
 *
 * Author: elecvoid243
 * Date: 2026-07-27
 */

/* ════════════════════════════════════════════════════════════════
 * 共享基础
 * ════════════════════════════════════════════════════════════════ */

/** 解析后必须保证不抛错——任何异常吞掉返回 null。 */
function safe<T>(fn: () => T): T | null {
    try {
        return fn();
    } catch {
        return null;
    }
}

/* ════════════════════════════════════════════════════════════════
 * A. 会话生命周期
 * ════════════════════════════════════════════════════════════════ */

export interface ParsedStartSession {
    sessionId: string;
    mode: "gui" | "tcl" | "attach" | string;
    vivadoPath: string;
    state: string;
    banner: string;
    asciiWarning: string;
    curdirWarning: string;
}

/** 解析 start_session 输出。
 *  形态:
 *    会话 'default' 已就绪（mode=gui）。
 *    Vivado: D:/Xilinx/Vivado/2024.1/bin/vivado.bat
 *    状态: READY
 *
 *    --- 启动信息 ---
 *    {banner}
 *    {ascii warning if any}
 *    {curdir warning if any}
 */
export function parseStartSessionFromText(text: string): ParsedStartSession | null {
    return safe(() => {
        const lines = text.split("\n").map((l) => l.trim());
        let sessionId = "";
        let mode = "";
        let vivadoPath = "";
        let state = "";
        let banner = "";
        let asciiWarning = "";
        let curdirWarning = "";

        const idMatch = text.match(/会话\s+['"]([^'"]+)['"]\s+已就绪/);
        if (idMatch) sessionId = idMatch[1];
        const modeMatch = text.match(/mode=([a-zA-Z]+)/);
        if (modeMatch) mode = modeMatch[1];
        const pathMatch = text.match(/Vivado:\s*(.+)/);
        if (pathMatch) vivadoPath = pathMatch[1].trim();
        const stateMatch = text.match(/状态:\s*(.+)/);
        if (stateMatch) state = stateMatch[1].trim();

        // banner + warnings 在 "--- 启动信息 ---" 之后
        const bannerIdx = lines.findIndex((l) => l.includes("启动信息"));
        if (bannerIdx >= 0) {
            const rest = lines.slice(bannerIdx + 1).join("\n");
            // 找出所有 ⚠ 警告段，每段到下一个 ⚠ 或 末尾为止
            const warnMatches = [...rest.matchAll(/(⚠\s*警告[^\n]*\n(?:.*\n)*?)(?=(?:⚠|$))/gm)];
            for (const w of warnMatches) {
                const body = w[1].trim();
                if (body.includes("非 ASCII 字符")) {
                    asciiWarning = body;
                } else if (body.includes("Windows NoDefaultCurrentDirectoryInExePath")) {
                    curdirWarning = body;
                }
            }
            // banner = 启动信息行之后到第一个警告之前
            const firstWarn = rest.search(/⚠\s*警告/);
            banner = (firstWarn > 0 ? rest.slice(0, firstWarn) : rest).trim();
        }

        // 完全空 / 无法解析时返回 null
        if (!sessionId && !mode && !state && !banner) return null;
        return { sessionId, mode, vivadoPath, state, banner, asciiWarning, curdirWarning };
    });
}

export interface ParsedStopSession {
    sessionId: string;
    state: string;
    message: string;
}

export function parseStopSessionFromText(text: string): ParsedStopSession | null {
    return safe(() => {
        const idMatch = text.match(/会话\s+['"]([^'"]+)['"]/);
        const stateMatch = text.match(/(?:状态|state)[:：]?\s*([A-Za-z_]+)/i);
        return {
            sessionId: idMatch?.[1] ?? "",
            state: stateMatch?.[1] ?? "terminated",
            message: text.trim(),
        };
    });
}

export interface VivadoSessionInfo {
    sessionId: string;
    mode: string;
    state: string;
    pid: number | null;
    vivadoPath: string;
    startedAt: number | null;
}

export interface ParsedListSessions {
    sessions: VivadoSessionInfo[];
    raw: string;
}

/** list_sessions 返回 JSON 字符串（已经是 JSON）。 */
export function parseListSessionsFromText(text: string): ParsedListSessions | null {
    return safe(() => {
        // vivado-mcp 的 list_sessions 返回 JSON 列表
        const trimmed = text.trim();
        if (!trimmed.startsWith("[")) {
            return { sessions: [], raw: text };
        }
        const arr = JSON.parse(trimmed);
        if (!Array.isArray(arr)) return { sessions: [], raw: text };
        const sessions: VivadoSessionInfo[] = arr.map((s: any) => ({
            sessionId: String(s.id ?? s.session_id ?? ""),
            mode: String(s.mode ?? ""),
            state: String(s.state ?? "idle"),
            pid: typeof s.pid === "number" ? s.pid : null,
            vivadoPath: String(s.vivado_path ?? s.vivadoPath ?? ""),
            startedAt: typeof s.started_at === "number" ? s.started_at : null,
        }));
        return { sessions, raw: text };
    });
}

/* ════════════════════════════════════════════════════════════════
 * B. 长任务 (综合/实现/比特流)
 * ════════════════════════════════════════════════════════════════ */

export interface DiagCounts {
    errors: number;
    criticalWarnings: number;
    warnings: number;
}

export interface ParsedFlowResult {
    label: string; // "综合" / "实现" / "比特流"
    status: string;
    progress: number; // 0-100
    elapsed: string;
    diagnostic: DiagCounts;
    bitstreamDir: string; // 仅 bitstream
    overrideLines: string[];
    openNote: string;
    blocked: boolean;
    blockTitle: string;
    blockSamples: string[];
    isError: boolean;
}

/** 解析 run_synthesis / run_implementation / generate_bitstream 输出。 */
export function parseFlowResultFromText(text: string, label: string): ParsedFlowResult | null {
    return safe(() => {
        const result: ParsedFlowResult = {
            label,
            status: "",
            progress: 0,
            elapsed: "",
            diagnostic: { errors: 0, criticalWarnings: 0, warnings: 0 },
            bitstreamDir: "",
            overrideLines: [],
            openNote: "",
            blocked: false,
            blockTitle: "",
            blockSamples: [],
            isError: text.startsWith("[ERROR]"),
        };

        if (result.isError) {
            const firstLine = text.split("\n")[0] || "";
            result.status = firstLine.replace("[ERROR]", "").trim();
            return result;
        }

        // 1) 状态 / 进度 / 耗时 / 比特流目录
        const statusM = text.match(/^状态:\s*(.+)$/m);
        if (statusM) result.status = statusM[1].trim();
        const progressM = text.match(/^进度:\s*(\d+)/m);
        if (progressM) result.progress = Math.min(100, Math.max(0, parseInt(progressM[1], 10)));
        const elapsedM = text.match(/^耗时:\s*(.+)$/m);
        if (elapsedM) result.elapsed = elapsedM[1].trim();
        const bitdirM = text.match(/^比特流目录:\s*(.+)$/m);
        if (bitdirM) result.bitstreamDir = bitdirM[1].trim();
        const openNoteM = text.match(/^\(open_run[^\n]+/m);
        if (openNoteM) result.openNote = openNoteM[0].trim();

        // 2) Fileset 参数覆盖（applied_* 行）
        for (const m of text.matchAll(/^(applied_\w+:.*)$/gm)) {
            result.overrideLines.push(m[1]);
        }

        // 3) 诊断概览
        const diagM = text.match(/诊断概览:\s*errors=(\d+),\s*critical_warnings=(\d+),\s*warnings=(\d+)/);
        if (diagM) {
            result.diagnostic = {
                errors: parseInt(diagM[1], 10),
                criticalWarnings: parseInt(diagM[2], 10),
                warnings: parseInt(diagM[3], 10),
            };
        }

        return result;
    });
}

/** 解析 generate_bitstream 的 BLOCK 模式（force=false 但有 CW）。
 *  形态:
 *    !! 安全检查未通过: 发现 5 条 CRITICAL WARNING !!
 *    实现状态: route_design Complete!
 *
 *    前 10 条 CRITICAL WARNING 样本:
 *      - {sample1}
 *      - {sample2}
 */
export function parseBitstreamBlockFromText(text: string): { status: string; samples: string[] } | null {
    return safe(() => {
        const lines = text.split("\n");
        let status = "";
        const samples: string[] = [];
        let inSamples = false;
        for (const line of lines) {
            const s = line.trim();
            if (s.startsWith("实现状态:")) {
                status = s.replace("实现状态:", "").trim();
            } else if (s.includes("样本:")) {
                inSamples = true;
            } else if (inSamples && s.startsWith("- ")) {
                samples.push(s.slice(2).trim());
            } else if (inSamples && s && !s.startsWith("-") && !s.startsWith("建议") && !s.startsWith("如确认")) {
                inSamples = false;
            }
        }
        return { status, samples };
    });
}

/* ════════════════════════════════════════════════════════════════
 * C. Tcl 透传 (run_tcl / safe_tcl)
 * ════════════════════════════════════════════════════════════════ */

export interface ParsedTclOutput {
    command: string;
    output: string;
    isError: boolean;
    hasQuirkHints: boolean;
    quirks: string[];
}

/** run_tcl / safe_tcl 输出 = 原始 Vivado 输出 + 尾部 quirk hint 段。
 *  区分二者用启发式：quirk hint 段通常以"提示:"或"⚠"开头，长度 > 100 字符。
 */
export function parseTclOutputFromText(text: string, command: string): ParsedTclOutput {
    const lines = text.split("\n");
    const isError = text.trim().startsWith("[ERROR]");

    // quirk hint 行：以"提示:" / "⚠" 开头
    const quirkStarts = ["提示:", "⚠", "\n提示:", "\n⚠"];
    let firstQuirkIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        const s = lines[i].trim();
        if (s.startsWith("提示:") || s.startsWith("⚠")) {
            firstQuirkIdx = i;
            break;
        }
    }

    let output = text;
    let quirks: string[] = [];
    if (firstQuirkIdx >= 0) {
        output = lines.slice(0, firstQuirkIdx).join("\n").trimEnd();
        quirks = collectQuirks(lines.slice(firstQuirkIdx));
    }

    return {
        command,
        output,
        isError,
        hasQuirkHints: quirks.length > 0,
        quirks,
    };
}

function collectQuirks(lines: string[]): string[] {
    const quirks: string[] = [];
    let cur = "";
    for (const line of lines) {
        const s = line.trim();
        if (s.startsWith("提示:") || s.startsWith("⚠")) {
            if (cur) quirks.push(cur);
            cur = s;
        } else if (cur) {
            cur += "\n" + line;
        }
    }
    if (cur) quirks.push(cur);
    return quirks;
}

/* ════════════════════════════════════════════════════════════════
 * D. 离线解析
 * ════════════════════════════════════════════════════════════════ */

export interface ParsedXpr {
    projectName: string;
    part: string;
    top: string;
    directory: string;
    sourceFiles: { verilog: string[]; vhdl: string[]; ip: string[]; memory: string[] };
    constraints: string[];
    synthStrategy: string;
    implStrategy: string;
    raw: string;
}

export function parseXprFromText(text: string): ParsedXpr | null {
    return safe(() => {
        const result: ParsedXpr = {
            projectName: "",
            part: "",
            top: "",
            directory: "",
            sourceFiles: { verilog: [], vhdl: [], ip: [], memory: [] },
            constraints: [],
            synthStrategy: "",
            implStrategy: "",
            raw: text,
        };
        // 多种项目名格式兜底（包括 "=== Vivado 工程: xxx ===" header）
        let nameM = text.match(/(?:项目名称|项目|Project Name):\s*(.+)/);
        if (!nameM) nameM = text.match(/=== Vivado 工程:\s*(.+?)\s*===/);
        if (nameM) result.projectName = nameM[1].trim();
        const partM = text.match(/Part:\s*(.+)/);
        if (partM) result.part = partM[1].trim();
        const topM = text.match(/顶层(?:模块)?:\s*(.+)/);
        if (topM) result.top = topM[1].trim();
        const dirM = text.match(/目录:\s*(.+)/);
        if (dirM) result.directory = dirM[1].trim();
        const synthM = text.match(/synth_\d+:\s*(.+)/);
        if (synthM) result.synthStrategy = synthM[1].trim();
        const implM = text.match(/impl_\d+:\s*(.+)/);
        if (implM) result.implStrategy = implM[1].trim();
        return result;
    });
}

export interface ParsedBitHeader {
    designName: string;
    partRaw: string;
    partNorm: string;
    buildDate: string;
    sha256: string;
}

export function parseBitHeaderFromText(text: string): ParsedBitHeader | null {
    return safe(() => {
        const m = (k: string) => {
            const r = text.match(new RegExp(k + ":\\s*(.+)"));
            return r?.[1]?.trim() ?? "";
        };
        return {
            designName: m("设计名"),
            partRaw: m("目标 Part \\(原始\\)"),
            partNorm: m("目标 Part \\(规整\\)"),
            buildDate: m("构建日期"),
            sha256: m("SHA256"),
        };
    });
}

export interface ParsedCompareXci {
    fileA: string;
    fileB: string;
    diffParams: Array<{ name: string; a: string; b: string }>;
    sameCount: number;
    raw: string;
}

export function parseCompareXciFromText(text: string): ParsedCompareXci | null {
    return safe(() => {
        const result: ParsedCompareXci = { fileA: "", fileB: "", diffParams: [], sameCount: 0, raw: text };
        const lines = text.split("\n");
        let i = 0;
        for (; i < lines.length; i++) {
            const s = lines[i].trim();
            if (s.startsWith("--- 差异参数")) break;
        }
        i++;
        while (i < lines.length) {
            const s = lines[i].trim();
            if (s.startsWith("---")) break;
            if (s.endsWith(":")) {
                const name = s.slice(0, -1).trim();
                const aLine = lines[i + 1]?.trim() ?? "";
                const bLine = lines[i + 2]?.trim() ?? "";
                const a = aLine.replace(/^A\s*=\s*/, "").trim();
                const b = bLine.replace(/^B\s*=\s*/, "").trim();
                result.diffParams.push({ name, a, b });
                i += 3;
            } else {
                i++;
            }
        }
        const sameM = text.match(/相同参数[^(]*\((\d+)/);
        if (sameM) result.sameCount = parseInt(sameM[1], 10);
        return result;
    });
}

export interface LintIssue {
    severity: "CRITICAL" | "WARN";
    ruleId: string; // PIN_CONFLICT / MISSING_IOSTANDARD / CLOCK_NO_PERIOD / ...
    file: string;
    line: number;
    description: string;
    count: number;
}

export interface ParsedXdcLint {
    issues: LintIssue[];
    errorCount: number;
    warnCount: number;
}

export function parseXdcLintFromText(text: string): ParsedXdcLint | null {
    return safe(() => {
        const result: ParsedXdcLint = { issues: [], errorCount: 0, warnCount: 0 };
        for (const m of text.matchAll(/\[(CRITICAL|WARN)\]\s+(\w+)\s+\((\d+)\s*处?\)?/g)) {
            const sev = m[1] as "CRITICAL" | "WARN";
            const rule = m[2];
            const count = parseInt(m[3], 10);
            result.issues.push({
                severity: sev, ruleId: rule, file: "", line: 0,
                description: `${rule} (${count} 处)`, count,
            });
            if (sev === "CRITICAL") result.errorCount += count;
            else result.warnCount += count;
        }
        return result;
    });
}

export interface VerilogFileCheck {
    file: string;
    passed: boolean;
    errorCount: number;
    issues: string[];
    elapsed: number; // seconds
}

export interface ParsedVerilogCheck {
    files: VerilogFileCheck[];
    tool: string;
}

export function parseVerilogCheckFromText(text: string): ParsedVerilogCheck | null {
    return safe(() => {
        const files: VerilogFileCheck[] = [];
        let tool = "auto";
        const toolM = text.match(/^=== Verilog 编译检查 \(([^)]+)\)/m);
        if (toolM) tool = toolM[1];
        const fileM = text.match(/文件:\s*(\d+)\s*个/);
        if (!fileM) return { files, tool };

        const lines = text.split("\n");
        let inFile = false;
        let cur: VerilogFileCheck | null = null;
        for (const line of lines) {
            const s = line.trim();
            const okM = s.match(/^\[OK\]\s+(.+?)\s+\((\d+)\s*个文件,\s*([\d.]+)s\)/);
            if (okM) {
                files.push({ file: okM[1], passed: true, errorCount: 0, issues: [], elapsed: parseFloat(okM[3]) });
                continue;
            }
            const errM = s.match(/^\[ERROR\]\s+(.+?):(\d+)\s+(.+)/);
            if (errM) {
                if (!cur || cur.file !== errM[1]) {
                    cur = { file: errM[1], passed: false, errorCount: 0, issues: [], elapsed: 0 };
                    files.push(cur);
                }
                cur.errorCount++;
                cur.issues.push(`L${errM[2]}: ${errM[3]}`);
            }
            const warnM = s.match(/^\[WARN\]\s+(.+)/);
            if (warnM && cur) {
                cur.issues.push(warnM[1]);
            }
        }
        return { files, tool };
    });
}

/* ════════════════════════════════════════════════════════════════
 * E. 结构化报告
 * ════════════════════════════════════════════════════════════════ */

export interface ParsedTimingReport {
    status: "met" | "fail" | "na" | "unknown";
    wns: number;
    whs: number;
    failingEndpoints: number;
    totalEndpoints: number;
    sourceStage: string; // "post-synth" | "post-route" | "unknown"
    raw: string;
}

export function parseTimingReportFromText(text: string): ParsedTimingReport | null {
    return safe(() => {
        const result: ParsedTimingReport = {
            status: "unknown",
            wns: 0,
            whs: 0,
            failingEndpoints: 0,
            totalEndpoints: 0,
            sourceStage: "unknown",
            raw: text,
        };
        const wnsM = text.match(/WNS:\s*([+\-]?[\d.]+)\s*ns/);
        if (wnsM) result.wns = parseFloat(wnsM[1]);
        const whsM = text.match(/WHS:\s*([+\-]?[\d.]+)\s*ns/);
        if (whsM) result.whs = parseFloat(whsM[1]);
        const epM = text.match(/失败端点:\s*(\d+)\/(\d+)/);
        if (epM) {
            result.failingEndpoints = parseInt(epM[1], 10);
            result.totalEndpoints = parseInt(epM[2], 10);
        }
        const stageM = text.match(/数据源:\s*(\S+)/);
        if (stageM) result.sourceStage = stageM[1];
        if (text.includes("✅ PASS") || text.includes("时序满足") || text.includes("Timing MET")) {
            result.status = "met";
        } else if (text.includes("❌ FAIL") || text.includes("时序违例") || text.includes("Timing NOT MET")) {
            result.status = "fail";
        } else if (text.includes("⚠ NA") || text.includes("N/A")) {
            result.status = "na";
        }
        return result;
    });
}

export interface ResourceRow {
    name: string;
    used: number;
    available: number;
    percent: number;
    critical: boolean;
    warn: boolean;
}

export interface ParsedUtilization {
    resources: ResourceRow[];
    parseError: string;
    raw: string;
}

export function parseUtilizationFromText(text: string): ParsedUtilization | null {
    return safe(() => {
        const result: ParsedUtilization = { resources: [], parseError: "", raw: text };
        const lines = text.split("\n");
        for (const line of lines) {
            const m = line.match(/^\|\s*(\S[\w\s]*?)\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|\s*([\d.]+)%\s*\|/);
            if (m) {
                const used = parseInt(m[2].replace(/,/g, ""), 10);
                const avail = parseInt(m[3].replace(/,/g, ""), 10);
                const pct = parseFloat(m[4]);
                result.resources.push({
                    name: m[1].trim(),
                    used,
                    available: avail,
                    percent: pct,
                    critical: pct >= 90,
                    warn: pct >= 70 && pct < 90,
                });
            }
        }
        return result;
    });
}

export interface ParsedBitstreamReadiness {
    verdict:
        | "READY"
        | "WARN"
        | "WARN [DEGRADED]"
        | "BLOCK"
        | "BLOCK [DEGRADED]"
        | "UNKNOWN";
    status: string;
    cwCount: number;
    timingMet: boolean | null;
    wns: number | null;
    whs: number | null;
    failingEndpoints: number | null;
    totalEndpoints: number | null;
    blockers: string[];
    warnings: string[];
    samples: string[];
    raw: string;
}

export function parseBitstreamReadinessFromText(text: string): ParsedBitstreamReadiness | null {
    return safe(() => {
        const result: ParsedBitstreamReadiness = {
            verdict: "UNKNOWN",
            status: "",
            cwCount: 0,
            timingMet: null,
            wns: null,
            whs: null,
            failingEndpoints: null,
            totalEndpoints: null,
            blockers: [],
            warnings: [],
            samples: [],
            raw: text,
        };
        const verdictM = text.match(/=== 烧板前检查:\s*(.+?)\s*===/);
        if (verdictM) {
            const raw = verdictM[1].trim();
            // 提取核心 verdict（READY / WARN / BLOCK + [DEGRADED]）
            if (raw.includes("BLOCK")) {
                result.verdict = raw.includes("DEGRADED") ? "BLOCK [DEGRADED]" : "BLOCK";
            } else if (raw.includes("DEGRADED")) {
                result.verdict = "WARN [DEGRADED]";
            } else if (raw.includes("WARN")) {
                result.verdict = "WARN";
            } else if (raw.includes("READY")) {
                result.verdict = "READY";
            } else {
                result.verdict = raw as any;
            }
        }
        const statusM = text.match(/实现状态:\s*(.+)/);
        if (statusM) result.status = statusM[1].trim();
        const cwM = text.match(/CRITICAL WARNING:\s*(\d+)/);
        if (cwM) result.cwCount = parseInt(cwM[1], 10);
        const timingM = text.match(/WNS\s*=\s*([+\-]?[\d.]+)\s*ns\s+WHS\s*=\s*([+\-]?[\d.]+)\s*ns\s+失败端点\s*=\s*(\d+)\/(\d+)/);
        if (timingM) {
            result.wns = parseFloat(timingM[1]);
            result.whs = parseFloat(timingM[2]);
            result.failingEndpoints = parseInt(timingM[3], 10);
            result.totalEndpoints = parseInt(timingM[4], 10);
            result.timingMet = result.failingEndpoints === 0;
        }
        // 阻塞 / 风险 / 样本
        const blockSec = text.match(/阻塞问题:([\s\S]*?)(?=\n风险提示|\n建议|$)/);
        if (blockSec) {
            for (const m of blockSec[1].matchAll(/\[X\]\s*(.+)/g)) result.blockers.push(m[1].trim());
        }
        const warnSec = text.match(/风险提示:([\s\S]*?)(?=\n建议|$)/);
        if (warnSec) {
            // 先试 [!] 标记
            for (const m of warnSec[1].matchAll(/\[!\]\s+(.+)/g)) {
                const trimmed = m[1].trim();
                if (trimmed) result.warnings.push(trimmed);
            }
            // 兜底：风险提示块内没有 [!] 标记时，取所有非空非 [X] 行
            if (result.warnings.length === 0) {
                for (const line of warnSec[1].split("\n")) {
                    const s = line.trim();
                    if (s && !s.startsWith("[X]") && s !== "风险提示:") {
                        result.warnings.push(s);
                    }
                }
            }
        }
        const sampleSec = text.match(/CRITICAL WARNING 样本\([\s\S]*?\):([\s\S]*?)(?=\n建议|$)/);
        if (sampleSec) {
            for (const m of sampleSec[1].matchAll(/-\s*(.+)/g)) result.samples.push(m[1].trim());
        }
        return result;
    });
}

export interface ParsedRunProgress {
    runName: string;
    status: string;
    progress: number;
    elapsed: string;
    phases: string[];
    logTail: string[];
    raw: string;
}

export function parseRunProgressFromText(text: string): ParsedRunProgress | null {
    return safe(() => {
        const result: ParsedRunProgress = {
            runName: "",
            status: "",
            progress: 0,
            elapsed: "",
            phases: [],
            logTail: [],
            raw: text,
        };
        const nameM = text.match(/=== run 进度:\s*(.+?)\s*===/);
        if (nameM) result.runName = nameM[1].trim();
        const statusM = text.match(/状态:\s*(.+)/);
        if (statusM) result.status = statusM[1].trim();
        const progressM = text.match(/进度:\s*(\d+)/);
        if (progressM) result.progress = parseInt(progressM[1], 10);
        const elapsedM = text.match(/运行时长:\s*(.+)/);
        if (elapsedM) result.elapsed = elapsedM[1].trim();
        const phasesSec = text.match(/最近 Phase:([\s\S]*?)(?=\n日志|$)/);
        if (phasesSec) {
            for (const m of phasesSec[1].matchAll(/Phase\s+[\d.]+:\s*(.+)/g)) {
                result.phases.push(m[1].trim());
            }
        }
        const tailSec = text.match(/日志尾部[\s\S]*?\):([\s\S]*?)$/);
        if (tailSec) {
            for (const line of tailSec[1].split("\n")) {
                if (line.trim()) result.logTail.push(line);
            }
        }
        return result;
    });
}

export interface ParsedProjectInfo {
    name: string;
    part: string;
    top: string;
    directory: string;
    sourceFiles: string[];
    xdcFiles: string[];
    ipInstances: string[];
    synthStatus: string;
    implStatus: string;
    raw: string;
}

export function parseProjectInfoFromText(text: string): ParsedProjectInfo | null {
    return safe(() => {
        const result: ParsedProjectInfo = {
            name: "", part: "", top: "", directory: "",
            sourceFiles: [], xdcFiles: [], ipInstances: [],
            synthStatus: "", implStatus: "", raw: text,
        };
        const get = (k: string) => {
            const m = text.match(new RegExp(k + ":\\s*(.+)"));
            return m?.[1]?.trim() ?? "";
        };
        result.name = get("项目");
        result.part = get("Part");
        result.top = get("顶层");
        result.directory = get("目录");

        const ipM = text.match(/IP 实例 \((\d+)/);
        if (ipM) {
            const sec = text.match(/IP 实例[\s\S]*?(?=\n---|\n===|$)/);
            if (sec) {
                for (const m of sec[0].matchAll(/-\s*(\S+)/g)) result.ipInstances.push(m[1]);
            }
        }
        return result;
    });
}

export interface ParsedPreCommit {
    verdict: "READY" | "WARN" | "BLOCK" | "DEGRADED" | "UNKNOWN";
    raw: string;
}

export function parsePreCommitFromText(text: string): ParsedPreCommit | null {
    return safe(() => {
        const m = text.match(/## 工程摘要 \[(\w+)\]/);
        return {
            verdict: (m?.[1] as any) ?? "UNKNOWN",
            raw: text,
        };
    });
}

export interface ParsedIoReport {
    ports: Array<{ name: string; pin: string; direction: string; type: string }>;
    raw: string;
}

/** get_io_report 返回 JSON。 */
export function parseIoReportFromText(text: string): ParsedIoReport | null {
    return safe(() => {
        const trimmed = text.trim();
        if (!trimmed.startsWith("{")) return { ports: [], raw: text };
        const obj = JSON.parse(trimmed);
        const ports: ParsedIoReport["ports"] = [];
        if (Array.isArray(obj?.ports)) {
            for (const p of obj.ports) {
                ports.push({
                    name: String(p.name ?? ""),
                    pin: String(p.pin ?? p.package_pin ?? ""),
                    direction: String(p.direction ?? ""),
                    type: String(p.type ?? "GPIO"),
                });
            }
        }
        return { ports, raw: text };
    });
}

/* ════════════════════════════════════════════════════════════════
 * F. 诊断 / 烧板 / 波形
 * ════════════════════════════════════════════════════════════════ */

export interface CwGroup {
    warningId: string; // "[Vivado 12-1411]"
    category: string; // "引脚冲突"
    count: number;
    sample: string;
    fixTip: string;
}

export interface CwDiff {
    resolved: string[];
    added: string[];
    stillPresent: string[];
}

export interface ParsedCriticalWarnings {
    diagnostic: DiagCounts;
    cwGroups: CwGroup[];
    errorGroups: CwGroup[];
    nonstandardSection: string;
    diff: CwDiff | null;
    isError: boolean;
    raw: string;
}

export function parseCriticalWarningsFromText(text: string): ParsedCriticalWarnings | null {
    return safe(() => {
        const result: ParsedCriticalWarnings = {
            diagnostic: { errors: 0, criticalWarnings: 0, warnings: 0 },
            cwGroups: [],
            errorGroups: [],
            nonstandardSection: "",
            diff: null,
            isError: text.startsWith("[ERROR]"),
            raw: text,
        };
        if (result.isError) return result;

        // 诊断概览
        const m = text.match(/errors=(\d+),\s*critical_warnings=(\d+),\s*warnings=(\d+)/);
        if (m) {
            result.diagnostic = {
                errors: parseInt(m[1], 10),
                criticalWarnings: parseInt(m[2], 10),
                warnings: parseInt(m[3], 10),
            };
        }

        // CW 分组: 形如 "[Vivado 12-1411] 引脚冲突 (1 处)"
        // 解析流程：先按 "--- ... ---" 找到 CW / ERROR 区块，再在每块里抓分组行
        const cwBlockMatch = text.match(/--- CRITICAL WARNING 分组 ---([\s\S]*?)(?=---|===|$)/);
        const errBlockMatch = text.match(/--- ERROR 分组 ---([\s\S]*?)(?=---|===|$)/);

        function parseBlock(block: string): CwGroup[] {
            const groups: CwGroup[] = [];
            // 警告 ID 含 "Vivado"/"Common" + 空格 + 数字 - 数字，整体用 [\w\s\-]+?
            const groupRe = /\[([\w\s\-]+?)\]\s*(.+?)\s*\((\d+)\s*处?\)/g;
            // 先匹配所有分组行
            const allMatches: Array<{ id: string; cat: string; cnt: number; idx: number }> = [];
            let m: RegExpExecArray | null;
            while ((m = groupRe.exec(block)) !== null) {
                allMatches.push({
                    id: `[${m[1]}]`,
                    cat: m[2].trim(),
                    cnt: parseInt(m[3], 10),
                    idx: m.index,
                });
            }
            // 二次扫描：找每个分组后的 "样本:" / "修复:" 行
            for (let i = 0; i < allMatches.length; i++) {
                const cur = allMatches[i];
                const nextStart = i + 1 < allMatches.length ? allMatches[i + 1]!.idx : block.length;
                const sub = block.slice(cur.idx, nextStart);
                const sampleM = sub.match(/样本:\s*(.+?)(?:\n|$)/);
                const fixM = sub.match(/修复:\s*(.+?)(?:\n|$)/);
                groups.push({
                    warningId: cur.id,
                    category: cur.cat,
                    count: cur.cnt,
                    sample: sampleM?.[1]?.trim() ?? "",
                    fixTip: fixM?.[1]?.trim() ?? "",
                });
            }
            return groups;
        }

        if (cwBlockMatch) result.cwGroups = parseBlock(cwBlockMatch[1]);
        if (errBlockMatch) result.errorGroups = parseBlock(errBlockMatch[1]);

        // 非标错误兜底 — banner 之后到下一个 === 之间的内容
        const nonstdBanner = text.match(/!! Vivado messageDb 显示无 ERROR\/CW[\s\S]*?(?=\n===|$)/);
        if (nonstdBanner) {
            const after = text.slice(text.indexOf(nonstdBanner[0]) + nonstdBanner[0].length);
            const parts = after.split(/\n===/);
            // parts[0] 是 banner 后到第一个 === 之间的空段，parts[1] 是 === 标题 + 内容
            const block = parts[0] || parts[1] || "";
            // 移除 === 标题行（保留内容）
            const noHeader = block.replace(/^===.*===\n?/, "");
            result.nonstandardSection = noHeader.replace(/^\s*\n/, "").trim();
        }

        // 差分
        const diffSec = text.match(/=== CW 差分报告 ===\n([\s\S]*?)$/);
        if (diffSec) {
            const diff: CwDiff = { resolved: [], added: [], stillPresent: [] };
            // 用 split 切段（更鲁棒），每段找第一个表情符号
            const segments = diffSec[1].split(/\n(?=[✅❌⚠])/);
            for (const seg of segments) {
                if (seg.startsWith("✅")) {
                    for (const line of seg.split("\n").slice(1)) {
                        const x = line.trim().replace(/^-\s*/, "");
                        if (x) diff.resolved.push(x);
                    }
                } else if (seg.startsWith("❌")) {
                    for (const line of seg.split("\n").slice(1)) {
                        const x = line.trim().replace(/^-\s*/, "");
                        if (x) diff.added.push(x);
                    }
                } else if (seg.startsWith("⚠")) {
                    for (const line of seg.split("\n").slice(1)) {
                        const x = line.trim().replace(/^-\s*/, "");
                        if (x) diff.stillPresent.push(x);
                    }
                }
            }
            result.diff = diff;
        }
        return result;
    });
}

export interface IoMismatch {
    port: string;
    xdc: string;
    actual: string;
    type: "GT" | "GPIO";
    severity: "CRITICAL" | "WARNING";
}

export interface ParsedIoVerification {
    matches: number;
    mismatches: IoMismatch[];
    raw: string;
}

export function parseIoVerificationFromText(text: string): ParsedIoVerification | null {
    return safe(() => {
        const result: ParsedIoVerification = { matches: 0, mismatches: [], raw: text };
        const lines = text.split("\n");

        // CRITICAL
        const critSec = text.match(/❌\s*CRITICAL\s*不匹配[^(]*\(([^)]+)\):([\s\S]*?)(?=\n⚠|\n✅|$)/);
        if (critSec) {
            for (const m of critSec[2].matchAll(/-\s*(\S+)\s+(\S+)\s+→\s+(\S+)/g)) {
                result.mismatches.push({
                    port: m[1], xdc: m[2], actual: m[3], type: "GT", severity: "CRITICAL",
                });
            }
        }
        // WARNING
        const warnSec = text.match(/⚠\s*WARNING\s*不匹配[^(]*\(([^)]+)\):([\s\S]*?)(?=\n✅|$)/);
        if (warnSec) {
            for (const m of warnSec[2].matchAll(/-\s*(\S+)\s+(\S+)\s+→\s+(\S+)/g)) {
                result.mismatches.push({
                    port: m[1], xdc: m[2], actual: m[3], type: "GPIO", severity: "WARNING",
                });
            }
        }
        // ✅ 一致
        const matchM = text.match(/✅\s*一致[^(]*\((\d+)/);
        if (matchM) result.matches = parseInt(matchM[1], 10);
        return result;
    });
}

export interface ParsedProgramDevice {
    bitstreamPath: string;
    target: string;
    hwServerUrl: string;
    steps: Array<{ name: string; ok: boolean; detail: string }>;
    device: string;
    isError: boolean;
    raw: string;
}

export function parseProgramDeviceFromText(text: string): ParsedProgramDevice | null {
    return safe(() => {
        const result: ParsedProgramDevice = {
            bitstreamPath: "", target: "", hwServerUrl: "",
            steps: [], device: "", isError: text.startsWith("[ERROR]"),
            raw: text,
        };
        if (result.isError) return result;
        const bsM = text.match(/比特流\s+(.+)/);
        if (bsM) result.bitstreamPath = bsM[1].trim();
        const tgM = text.match(/目标\s+(.+)/);
        if (tgM) result.target = tgM[1].trim();
        const hwM = text.match(/(?:设备|HW)\s+(.+)/);
        if (hwM) result.hwServerUrl = hwM[1].trim();
        const devM = text.match(/设备\s+(\S+)/);
        if (devM) result.device = devM[1];
        // 烧板过程步骤: 名字 + ✓/✗ + 详情（行首可能有缩进也可能没有）
        // 用 [^\S\n] 替代 \s，避免吞换行
        for (const m of text.matchAll(/^[ \t]*([a-z_][a-z0-9_]*)[ \t]+(✓|✗|OK|FAIL)(?:[ \t]+(.*))?$/gim)) {
            result.steps.push({ name: m[1]!, ok: m[2] === "✓" || m[2] === "OK", detail: (m[3] ?? "").trim() });
        }
        return result;
    });
}

export interface ParsedWaveZoom {
    startNs: number;
    endNs: number;
    wcfgPath: string;
    isError: boolean;
    raw: string;
}

export function parseWaveZoomFromText(text: string): ParsedWaveZoom | null {
    return safe(() => {
        const isError = text.startsWith("[ERROR]");
        const rangeM = text.match(/(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)\s*ns/);
        const pathM = text.match(/(?:已设缩放窗.+并重载:|路径:)\s*(.+)/);
        return {
            startNs: rangeM ? parseFloat(rangeM[1]) : 0,
            endNs: rangeM ? parseFloat(rangeM[2]) : 0,
            wcfgPath: pathM?.[1]?.trim() ?? "",
            isError,
            raw: text,
        };
    });
}

export interface ParsedWaveAnalog {
    min: number;
    max: number;
    interp: string;
    height: number;
    signals: Array<{ name: string; ok: boolean; matched: string; reason: string }>;
    isError: boolean;
    raw: string;
}

export function parseWaveAnalogFromText(text: string): ParsedWaveAnalog | null {
    return safe(() => {
        const result: ParsedWaveAnalog = {
            min: 0, max: 0, interp: "LINEAR", height: 0,
            signals: [], isError: text.startsWith("[ERROR]"),
            raw: text,
        };
        if (result.isError) return result;
        const minM = text.match(/min=([+\-]?[\d.]+)/);
        if (minM) result.min = parseFloat(minM[1]);
        const maxM = text.match(/max=([+\-]?[\d.]+)/);
        if (maxM) result.max = parseFloat(maxM[1]);
        const interpM = text.match(/interp=(\w+)/);
        if (interpM) result.interp = interpM[1];
        const heightM = text.match(/height=(\d+)/);
        if (heightM) result.height = parseInt(heightM[1], 10);
        // 信号行: "  ✓ y0[15:0] (命中 /tb/u_dut/y0[15:0]) → STYLE_ANALOG"
        //         "  ✗ missing_sig → 波形里找不到该信号..."
        for (const m of text.matchAll(/^\s*(✓|✗)\s+(\S+)\s*(?:\(([^)]+)\))?\s*→\s*(.+)$/gm)) {
            const rawMatched = m[3] ?? "";
            // 剥离 "命中 " 前缀，保留完整路径
            const matched = rawMatched.replace(/^命中\s*/, "").trim();
            result.signals.push({
                name: m[2],
                ok: m[1] === "✓",
                matched,
                reason: m[4]?.trim() ?? "",
            });
        }
        return result;
    });
}
