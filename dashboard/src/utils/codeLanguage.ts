/**
 * codeLanguage — file-extension → Shiki language mapping.
 *
 * Extracted from ToolResultView.vue (2026-08-11) so the FileChangeCard
 * write-content preview can share the same detection logic instead of
 * duplicating the map.
 *
 * Author: elecvoid243 | 2026-08-11
 */

export const EXT_TO_LANG: Record<string, string> = {
  ".py": "python",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".jsx": "jsx",
  ".vue": "vue",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".css": "css",
  ".html": "html",
  ".htm": "html",
  ".xml": "xml",
  ".svg": "xml",
  ".md": "markdown",
  ".sql": "sql",
  ".java": "java",
  ".ini": "ini",
  ".diff": "diff",
  ".patch": "diff",
  ".ps1": "powershell",
  ".dockerfile": "dockerfile",
  ".txt": "text",
  // C / C++ / Go / Rust
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".c++": "cpp",
  ".go": "go",
  ".rs": "rust",
  // Verilog / SystemVerilog
  ".v": "verilog",
  ".vh": "verilog",
  ".sv": "system-verilog",
  ".svh": "system-verilog",
  // MATLAB. `.m` is also the Objective-C extension, but
  // objective-c is not in the shiki whitelist, so claiming it
  // here does not collide with anything currently supported.
  // `.matlab` is the explicit form for the rare cases where a
  // file is named without the canonical `.m` (e.g. for clarity
  // when the project mixes OC-style and matlab tooling).
  ".m": "matlab",
  ".matlab": "matlab",
};

/** Detect the Shiki language for a file path; "text" when unknown. */
export function detectLanguage(filePath: string): string {
  const m = filePath.match(/\.([\w]+)$/i);
  if (!m) return "text";
  const key = "." + m[1].toLowerCase();
  return EXT_TO_LANG[key] || "text";
}
