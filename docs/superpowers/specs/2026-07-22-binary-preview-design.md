# Design: DocumentManager 二进制文件预览（docx / pdf / xlsx / csv / md）

> Author: elecvoid243 · 2026-07-22
> Status: approved (brainstorming session 2026-07-22, 选项 B：完整 5 格式 + 独立新端点 + 前端解析)
> Scope: spcode 后端 + dashboard 前端；DocumentManager 视图限定

## 修订记录

- **2026-07-22 v1 (binary-preview)**：初版。覆盖 docx / pdf / xlsx / csv / md 在
  DocumentManager 中的预览，包括当前工作区与 git 历史 revision 两种来源。
  pptx 明确**不**接，预留扩展点。

## 1. 目标

让 DocumentManager（"docs" tab）能够**直接渲染**以下格式的工作区文件：

| 格式 | 库 | 后端 |
|---|---|---|
| `.pdf`  | `pdfjs-dist`  | `GET /spcode/file-binary?path=&ref=` |
| `.docx` | `mammoth`     | 同上 |
| `.xlsx` | `exceljs`     | 同上 |
| `.csv`  | `papaparse`   | 同上 |
| `.md`   | 现有 `MarkdownView` | 复用现有 `useSpcodeFileBrowser` / `useSpcodeGitFile` |

非目标（YAGNI，**明确放弃**避免范围蔓延）：

- **不做 pptx 渲染**（浏览器端开源方案都差，留扩展点给未来 v2）
- **不做 LibreOffice / unoconv 后端预处理**（与"前端解析"决策冲突）
- **不做服务端文本提取**（v1 不需要 LLM 读取二进制内容）
- **不做 FileBrowser 视图扩展**（仅 DocumentManager）
- **不做 CRUD 扩展**（DocumentManager 顶部"新建"按钮仍只允许 .md）
- **不做重命名 / 删除二进制文件的能力**（与 docs_crud 端点的 .md-only 契约保持一致）
- **不做下载按钮**（错误态只显示失败原因；用户可走 FileBrowser 拿原始文件）
- **不做 PWA 离线缓存**
- **不做行内注释**（v1 二进制不参与文件注释；v2 再讨论）
- **不做 pptx / odt / rtf** 等其他 Office 格式

## 2. 方案（已选）

### 2.1 已选：方案 B（完整 5 格式 + 独立新端点 + 前端解析）

- 后端：新增独立端点 `GET /spcode/file-binary` 流式返回原始 bytes，带 `Content-Type` + `ETag`
- 前端：新增 `useSpcodeFileBinary` composable + `<BinaryPreview>` 容器 + 5 个子组件
- 树显示：DocumentManager 树扩展 `ALLOWED_DOC_EXTENSIONS` 到 5 种
- 只读预览：DocumentManager 顶部"新建"按钮仍只允许 .md；重命名 / 删除不作用于二进制文件

### 2.2 被否方案

- **A（保守渐进：先 docx + pdf）**——用户已明确要 5 格式，分期意义不大；二期重访
  架构成本高。
- **C（抽象 PreviewAdapter 接口 + AdapterRegistry）**——YAGNI。5 个稳定后端格式
  不需要适配器抽象；后续加 pptx 时再抽象不迟。

## 3. 架构总览

### 3.1 数据流

```
DocumentManager (selectedDoc, selectedRevision)
│
├─ useSpcodeFileBrowser(absoluteFromSelectedDoc)         (已有)
│    → /spcode/file-browser?path=<abs>
│    → snapshot.content (text)  | snapshot.isBinary=true
│
├─ useSpcodeGitFile(path, ref)                            (已有)
│    → /spcode/git-file?path=&ref=
│    → 历史 blob (text)  | isBinary=true
│
├─ useSpcodeFileBinary(path, ref?)                        (新)
│    → /spcode/file-binary?path=&ref=
│    → 原始 bytes (ArrayBuffer) + ETag
│
└─ <BinaryPreview :state="binaryState" :filename="...">   (新, 容器)
     ├─ .pdf  → <PdfPreview :bytes />        (pdfjs-dist)
     ├─ .docx → <DocxPreview :bytes />       (mammoth)
     ├─ .xlsx → <XlsxPreview :bytes />       (exceljs)
     ├─ .csv  → <CsvPreview :bytes />        (papaparse)
     └─ .md   → 现有 <MarkdownView>          (已有)
```

### 3.2 模块清单

**后端（spcode 插件）**

| 模块 | 路径 | 操作 |
|---|---|---|
| `file_binary.py` | `data/plugins/astrbot_plugin_spcode_toolkit/tools/webapi/file_binary.py` | 新增：handler |
| `__init__.py`    | `.../tools/webapi/__init__.py` | 修改：注册 `ROUTES` |
| `_helpers.py`    | `.../tools/webapi/_helpers.py` | 修改：加 `MIME_BY_EXT` 常量 |

**前端（dashboard）**

| 模块 | 路径 | 操作 |
|---|---|---|
| `useSpcodeFileBinary.ts` | `dashboard/src/composables/useSpcodeFileBinary.ts` | 新增：状态机 + 错误解析（合二为一） |
| `BinaryPreview.vue` | `dashboard/src/components/chat/message_list_comps/binary_preview/BinaryPreview.vue` | 新增：容器 |
| `PdfPreview.vue` | `.../binary_preview/PdfPreview.vue` | 新增 |
| `DocxPreview.vue` | `.../binary_preview/DocxPreview.vue` | 新增 |
| `XlsxPreview.vue` | `.../binary_preview/XlsxPreview.vue` | 新增 |
| `CsvPreview.vue` | `.../binary_preview/CsvPreview.vue` | 新增 |
| `DocumentTreePanel.vue` | `dashboard/src/components/chat/message_list_comps/DocumentTreePanel.vue` | 修改：扩展白名单 |
| `DocumentManager.vue` | `dashboard/src/components/chat/message_list_comps/DocumentManager.vue` | 修改：接入 BinaryPreview |
| `package.json` | `dashboard/package.json` | 修改：加 4 个依赖 |
| `api/v1.ts` | （无） | 不动（`pluginExtensionApi.get` 已支持任意 responseType） |

## 4. 后端端点契约

### 4.1 路由

```
GET /spcode/file-binary
  Query:
    path   (必填, 工作区相对路径)
    ref    (可选, git ref；ref 缺失时取工作区文件)
  Header:
    If-None-Match: W/"<mtime_ns>-<size>"   (可选, 304 短路)
```

复用现有：
- `webapi/_helpers._git_endpoint_preflight`（5 步）
- `webapi/_helpers._validate_repo_relative_file`（4 步防御）
- `webapi/_helpers._run_git_async`（git show 调子进程）

### 4.2 响应头

| Header | Value | 说明 |
|---|---|---|
| `Content-Type`        | `application/pdf` / `application/vnd.openxmlformats-officedocument.wordprocessingml.document` / `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` / `text/csv; charset=utf-8` / `text/markdown; charset=utf-8` | 由扩展名决定（白名单内） |
| `Content-Disposition` | `inline; filename="<basename>"; filename*=UTF-8''<encoded>` | 浏览器内嵌渲染；中文 filename 兼容 |
| `Content-Length`      | `<bytes>` | 客户端可预知大小 |
| `ETag`                | `W/"<mtime_ns>-<size>"` | 与 file-browser 同 ETag 公式 |
| `Cache-Control`       | `private, must-revalidate` | 不强缓存，工作区文件改动后立即看到 |
| `Vary`                | `Cookie` | 多用户场景 |

### 4.3 状态码

| 状态 | 触发条件 | Body / 错误 reason |
|---|---|---|
| `200` | 成功 | 原始 bytes（流式） |
| `304` | `If-None-Match` 命中 | 空 |
| `400` | path 缺失 / 非法 / 越界 | `path_unsafe` |
| `403` | 权限不足 | `permission_denied` |
| `404` | 文件不存在 | `path_not_found` |
| `404` | git ref 不存在 | `ref_not_found` |
| `413` | 文件 > 50 MB | `file_too_large`（附 `size` / `max_bytes`） |
| `415` | symlink / FIFO / socket / device | `special_file` |
| `415` | 不支持扩展名 | `unsupported_media_type` |
| `422` | ref 解析成功但 path 不在该 ref 下 | `file_missing_at_ref` |
| `500` | 内部错误 | `internal_error` |

### 4.4 错误响应 envelope

```json
{
  "status": "ok",
  "data": {
    "reason": "path_not_found",
    "stderr": "",
    "elapsed_ms": 12,
    "path": "docs/foo.pdf"
  }
}
```

> 5xx 时 `status` 可能为 `"error"`（沿用 framework 惯例）。
> 4xx 错误响应**不带** bytes，带 `Content-Type: application/json; charset=utf-8`。

### 4.5 MIME 映射表（`webapi/_helpers.py` 新增常量）

```python
MIME_BY_EXT: dict[str, str] = {
    ".pdf":  "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv":  "text/csv; charset=utf-8",
    ".md":   "text/markdown; charset=utf-8",
}

FILE_BINARY_MAX_BYTES: int = 50 * 1024 * 1024  # 50 MB
```

**白名单约束**：仅当 `path.suffix.lower()` ∈ `MIME_BY_EXT` 时才接受。**其他扩展名 → 415 `unsupported_media_type`**，避免被误用为通用文件下载器。

### 4.6 ETag 计算

```python
def _compute_binary_etag(path: Path, st: os.stat_result) -> str:
    return f'W/"{st.st_mtime_ns}-{st.st_size}"'
```

> 与 `file-browser._compute_file_etag` 一致（同一文件同一 mtime/size → 同 ETag），
> 让前端两路缓存可共用 ETag 字符串。

### 4.7 Git ref 路径

```python
# 1. _git_endpoint_preflight (5 步): feature flag / umo / worktree / dir / git repo
# 2. git show <ref>:<path> 拿 blob bytes
# 3. lstat 工作区文件 → ETag (git ref 内容固定但工作区可能改同一文件,
#    用工作区 mtime+size 让缓存能感知工作区改动, 见 §4.8 git ref 路径)
# 4. FileResponse(bytes, content_type=..., headers=...)
```

### 4.8 文件读取实现

**工作区路径**（`ref` 缺失）：

```python
target, path_err = _validate_repo_relative_file(path, Path(directory))
if path_err is not None:
    return _make_envelope(success=False, reason=ReasonCode.PATH_UNSAFE, ...)
try:
    file_st = target.lstat()  # 不跟随 symlink
except (PermissionError, OSError) as exc:
    return _classify_oserror(exc)
if stat.S_ISLNK(file_st.st_mode):  # 顶层 symlink
    return _make_envelope(success=False, reason=ReasonCode.SPECIAL_FILE, ...)
if not stat.S_ISREG(file_st.st_mode):  # 目录 / FIFO / device
    return _make_envelope(success=False, reason=ReasonCode.SPECIAL_FILE, ...)
if file_st.st_size > FILE_BINARY_MAX_BYTES:
    return _make_envelope(success=False, reason=ReasonCode.FILE_TOO_LARGE, ...)
# 304 短路
etag = _compute_binary_etag(target, file_st)
if if_none_match == etag:
    return 304 (empty body, ETag/Cache-Control headers)
# 读
with target.open("rb") as f:
    bytes_ = f.read()
return FileResponse(bytes_, content_type=MIME_BY_EXT[suffix], headers=...)
```

**git ref 路径**（`ref` 非空）：

```python
# preflight 5 步
# git show <ref>:<path> → bytes
result = await _run_git_async_bytes(
    [git_bin, "-C", directory, "show", f"{ref}:{path}"], ...
)
if not result["ok"]:
    if "Not a valid ref" in result["stderr"] or "unknown revision" in result["stderr"]:
        return _make_envelope(success=False, reason=ReasonCode.REF_NOT_FOUND, ...)
    if "does not exist" in result["stderr"] or "exists on disk, but not in" in result["stderr"]:
        return _make_envelope(success=False, reason=ReasonCode.FILE_MISSING_AT_REF, ...)
    return _make_envelope(success=False, reason=ReasonCode.GIT_ERROR, ...)
bytes_ = result["stdout"]  # 已是 bytes（_run_git_async_bytes 变体）
# size 校验 / ETag / 304 / FileResponse
```

> ETag：git ref 路径用 `lstat` 工作区文件的 mtime+size（不跟随 symlink）。git
> ref 内容固定，但用户在工作区可能改了同一文件——304 兜底用工作区 mtime 能在工作区
> 改动时让缓存失效。

> **NOTE**：`_run_git_async` 当前返回 stdout 为字符串。对 binary blob 需要扩展为 bytes
> 模式（v1 在 `tools/webapi/_helpers.py` 单独加一个 `_run_git_async_bytes` 变体，
> 返回 stdout bytes 而非 str；与 `_run_git_async` 共享 `subprocess` 调用路径）。

### 4.9 _helpers 新增的 ReasonCode

```python
class ReasonCode:
    # 已有
    PATH_UNSAFE = "path_unsafe"
    PATH_NOT_FOUND = "path_not_found"
    PERMISSION_DENIED = "permission_denied"
    FILE_TOO_LARGE = "file_too_large"
    SPECIAL_FILE = "special_file"
    REF_NOT_FOUND = "ref_not_found"
    FILE_MISSING_AT_REF = "file_missing_at_ref"
    # 新增
    UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type"
    INTERNAL_ERROR = "internal_error"
```

## 5. 前端 Composable

### 5.1 `useSpcodeFileBinary` 状态机

```typescript
type BinaryFetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ok";
      bytes: ArrayBuffer;
      mime: string;        // 来自后端 Content-Type
      filename: string;    // 来自 Content-Disposition
      etag: string;        // W/"..." 供下次 If-None-Match
      size: number;
    }
  | {
      kind: "error";
      reason: string;      // path_not_found / file_too_large / unsupported_media_type / ...
      previousEtag?: string;
    };
```

### 5.2 接口契约

```typescript
interface UseSpcodeFileBinary {
  state: Ref<BinaryFetchState>;
  refresh: () => Promise<void>;
  dispose: () => void;
}

function useSpcodeFileBinary(
  pathRef: MaybeRef<string>,
  refRef?: MaybeRef<string | null>,
): UseSpcodeFileBinary;
```

### 5.3 关键设计点

**(a) 双路**：当 `refRef` 为空时 fetch `/spcode/file-binary?path=<p>`；当 `refRef` 非空时
fetch `/spcode/file-binary?path=<p>&ref=<r>`。一个 composable 覆盖两种场景。

**(b) 与 `useSpcodeFileBrowser` 模式 1:1 对称**：
- `AbortController` + `isMounted` 守门
- `watch(pathRef, ..., { immediate: true })`
- empty path 短路到 `error: "path_not_found"`
- 错误时保留 `previousEtag`

**(c) 304 短路**：
- 上次成功的 etag 在 `state.kind === "ok"` 时持有
- 下次 refresh 时通过 `If-None-Match` 头携带
- 后端 304 → 不更新 state（保留上次 ok bytes）

**(d) `ArrayBuffer` 而非 `Blob`**：
- pdfjs：`new Uint8Array(buffer)` 即可
- mammoth：`mammoth.convertToHtml({ arrayBuffer })` 直接传
- exceljs：`new Uint8Array(buffer)` 即可
- papaparse：转 `Uint8Array` → `TextDecoder` → string
- 50MB 文件吃 50MB 内存——可接受（库都是这样）

**(e) axios `responseType: "arraybuffer"`**：
- 200 → 直接是 `ArrayBuffer`
- 4xx/5xx → axios **仍**把 body 解析为 `ArrayBuffer`（axios 不根据 Content-Type
  自动 JSON.parse；**error path 需手动 JSON.parse**）
- 304 → axios 默认 `validateStatus`（`status >= 200 && status < 300`）会 reject
  promise；需要显式 `validateStatus: (s) => s >= 200 && s < 400` 让 304 也算
  success，由状态机根据 `response.status` 决定是否更新 state

### 5.4 错误响应解析（inline 在 `useSpcodeFileBinary.ts` 内部）

> 不再独立 `parseSpcodeFileBinary.ts` 文件，避免小文件泛滥（保持 inline-first）。

```typescript
function parseSpcodeBinaryError(
  body: ArrayBuffer,
): { reason: string; stderr?: string } | null {
  // 4xx/5xx 时 body 是 ArrayBuffer（axios 不会自动 parse）
  try {
    const text = new TextDecoder("utf-8").decode(body);
    const json = JSON.parse(text);
    return json?.data ?? null;
  } catch {
    return null;
  }
}
```

### 5.5 何时 fetch（DocumentManager 接入）

```typescript
const BINARY_EXTS = new Set([".pdf", ".docx", ".xlsx", ".csv", ".md"]);

const binaryActive = computed<boolean>(() => {
  const ext = extname(selectedDoc.value ?? "").toLowerCase();
  if (!BINARY_EXTS.has(ext)) return false;
  if (!selectedRevision.value) {
    return fileState.value.kind === "file"
      && fileState.value.snapshot.isBinary === true;
  }
  const gitState = gitFile.getState(gitLogPath.value, selectedRevision.value);
  return gitState.kind === "ok" && gitState.data.isBinary === true;
});

const binaryFile = useSpcodeFileBinary(
  computed(() => gitLogPath.value),
  computed(() => selectedRevision.value),
);

// 切文件 / 切 ref / 切 worktree → 自动重新 fetch
// (useSpcodeFileBinary 内部 watch 已覆盖)
```

> `.md` 文件在 `isBinary === false` 时仍走现有 `useSpcodeFileBrowser` 路径（返回
> `snapshot.content` 字符串）；只有当 `isBinary === true`（理论上 .md 不会
> 触发）才走 binary 路径。实际场景：`.md` 几乎不会进入 binary 路径。

## 6. 组件分层

### 6.1 组件树

```
<BinaryPreview :state :filename :isHistorical>
├─ idle/loading → <v-progress-circular />
├─ error        → 现有 binary 占位 (mdi-file-question-outline) + 错误 reason
├─ .pdf  → <PdfPreview :bytes />
├─ .docx → <DocxPreview :bytes />
├─ .xlsx → <XlsxPreview :bytes />
└─ .csv  → <CsvPreview :bytes />
```

> **`.md` 不进 BinaryPreview**：`.md` 文本文件 `isBinary === false`，由现有
> `useSpcodeFileBrowser` 路径返回 `snapshot.content` 字符串并由 `MarkdownView`
> 渲染。BinaryPreview 仅在 `isBinary === true` 时激活（pdf/docx/xlsx/csv 都是 binary）。

### 6.2 `<BinaryPreview>` 容器职责

```typescript
interface Props {
  state: Ref<BinaryFetchState>;
  filename: string;
  isHistorical?: boolean;
}
```

- 状态分发：见 §6.1
- 提供统一的错误 reason i18n 映射
- 历史模式下加角标（mirror 现有历史模式 UI）

### 6.3 5 个子组件关键逻辑

| 组件 | 库 | 渲染产物 | 性能 | 错误处理 |
|---|---|---|---|---|
| `<PdfPreview>` | `pdfjs-dist` | 渲染到 `<canvas>`，分页 + 缩放 + 当前页码 | 50MB PDF 需 canvas lazy render；v1 一次性渲 | pdfjs 解析失败 → "PDF 损坏或不兼容" |
| `<DocxPreview>` | `mammoth` | `convertToHtml({ arrayBuffer })` → 注入 v-html | 50MB docx ~500ms 解析 | 转换失败 → "DOCX 转换失败" |
| `<XlsxPreview>` | `exceljs` | 读 workbook，按 sheet tab 切换 → 渲染 HTML table | 50MB 慢；v1 不做 lazy | 解析失败 → "XLSX 解析失败" |
| `<CsvPreview>` | `papaparse` | 解析为行数组 → 渲染 HTML table | 100MB 头几行预读 | 解析失败 → fallback raw 文本 |

> **`<MdPreview>` 不存在**：`.md` 走 text 路径，**不**进 BinaryPreview。复用现有
> `MarkdownView`，无需新增组件。

> 性能优化（M1+）：pdfjs canvas virtualized、xlsx sheet lazy load。
> v1 不做（YAGNI），但保留分页/tab 切换的"插槽"。

### 6.4 DocumentTreePanel 改动

```typescript
// before
const ALLOWED_DOC_EXTENSIONS: string[] = [".md", ".txt"];

// after — 树显示用
const ALLOWED_DOC_EXTENSIONS: string[] = [
  ".md", ".txt",
  ".pdf", ".docx", ".xlsx", ".csv",
];

// 新建按钮仍只允许 .md（与后端 docs_crud 契约一致）
const ALLOWED_CREATE_EXTENSIONS: string[] = [".md"];
```

- FileBrowserEntryList 已有 `allowedExtensions` prop，过滤自动生效
- "新建"按钮的正则从 `ALLOWED_CREATE_EXTENSIONS` 生成（与树过滤解耦）

### 6.5 DocumentManager 接入点

**顶部 toolbar**：
- 二进制模式下隐藏"复制""编辑"按钮（mirror 现有 binary 占位 UI）
- 不加"下载"按钮（v1 决策）

**viewMode（raw / rendered / diff）**：
- `.md / .txt` ：保持 raw / rendered
- `.pdf / .docx / .xlsx / .csv`：viewMode 强制 `rendered`（无可用 raw 视图）
- `diff`：保持现有逻辑（用 git show `<ref>:<path>` 拿 patch，二进制 patch 走现有占位）

**全屏模式**：与现有 binary 占位完全一致（点击空白处切换）

**注释（行内 comments）**：v1 不加；与现有 binary 占位一致

### 6.6 i18n key（节选）

```yaml
spcodeProjectLoad:
  documentManager:
    binaryPreview:
      loadFailed: "加载失败"
      unsupported: "暂不支持预览此格式"
      pdf:
        pageLabel: "第 {current} / {total} 页"
        prev: "上一页"
        next: "下一页"
        zoomIn: "放大"
        zoomOut: "缩小"
      xlsx:
        sheetLabel: "工作表 {current} / {total}"
        emptySheet: "空工作表"
      csv:
        rowCount: "{n} 行"
```

## 7. 错误处理

### 7.1 错误处理矩阵

| 来源 | reason | 用户可见 | 恢复路径 |
|---|---|---|---|
| path 缺失 | `path_not_found` | "路径未找到" | 自动重试（切文件再切回） |
| path 越界 | `path_unsafe` | "路径不安全" | 无（应不存在） |
| 文件不存在 | `path_not_found` | "文件不存在" | 无 |
| 权限不足 | `permission_denied` | "无权限访问" | 无 |
| 文件过大 (>50MB) | `file_too_large` | "文件过大，无法预览" | 无（v1 无下载） |
| 不支持的扩展名 | `unsupported_media_type` | "暂不支持此格式" | 无 |
| symlink / 特殊 | `special_file` | "此文件类型无法预览" | 无 |
| ref 不存在 | `ref_not_found` | "版本不存在" | 切回当前 |
| ref 解析成功但无 path | `file_missing_at_ref` | "该版本下无此文件" | 切回当前 |
| PDF 损坏 | （前端）| "PDF 文件损坏或不兼容" | 重试 |
| DOCX 转换失败 | （前端） | "DOCX 转换失败" | 重试 |
| XLSX 解析失败 | （前端） | "XLSX 解析失败" | 重试 |
| 网络中断 | `network` | "网络异常" | 重试 |

> **不实现重试按钮**：与现有 `useSpcodeFileBrowser` 行为一致（error 状态停留，路径变化时自动重置）。

## 8. 测试

### 8.1 后端（`tests/test_file_binary.py`）

1. 工作区路径成功 → 200 + 正确 Content-Type + Content-Disposition
2. ref 路径成功 → 同上
3. ETag 一致性（两次请求同 ETag → 304）
4. path 越界 → 400
5. 不支持扩展名 → 415
6. 文件不存在 → 404
7. 文件过大 → 413
8. 权限不足 → 403
9. symlink / FIFO → 415
10. ref 解析成功但无 path → 422
11. preflight 5 步（feature flag / umo / worktree / dir / git repo）失败时返回对应 reason
12. ETag 公式正确性（`mtime_ns + size`）
13. 中文文件名 → Content-Disposition 正确编码

### 8.2 前端 composable（`tests/useSpcodeFileBinary.test.mjs`）

1. 空 path → 立即 error: "path_not_found"
2. fetch 200 + body → state.kind === "ok"
3. fetch 304 → state 不变
4. fetch 4xx → state.kind === "error" + reason
5. dispose 后 fetch 不写 state
6. watch 立即触发
7. 切换 ref 从 null → "abc123" → 重新 fetch
8. abort 中断 → 不写 state

### 8.3 前端组件

- `BinaryPreview.spec.ts`：
  1. 扩展名分派正确
  2. 错误态显示 reason
  3. loading 态显示旋转图标
  4. 切换 filename 触发 state 切换
- `PdfPreview / DocxPreview / XlsxPreview / CsvPreview` 各一个 spec：
  1. 接收 bytes → 渲染对应内容
  2. 库报错 → 显示错误占位

### 8.4 E2E（可选 / 人工）

- 选中 .pdf → 渲染第一页
- 切换 ref → 重新渲染

## 9. 验收 / 退出标准

✅ DocumentManager 选中 .pdf / .docx / .xlsx / .csv / .md 文件能正常预览
✅ git 历史 revision 下的二进制文件能正常预览
✅ ETag 缓存命中时第二次访问无新请求
✅ 5MB 范围内的文件 < 2s 渲染
✅ 不支持类型显示 graceful 错误，不崩溃
✅ ruff format / ruff check 通过
✅ 后端 + 前端测试全绿
✅ 大于 50MB 的文件返回 413 + UI 错误占位
✅ DocumentManager 顶部"新建"按钮仍只允许 .md（CRUD 行为不变）

## 10. 性能验收

- 5MB PDF 首屏 < 2s（含 fetch + 解析 + 渲染第一页）
- 5MB DOCX < 1s
- 5MB XLSX < 2s
- 5MB CSV < 500ms
- 切文件 → 自动取消旧 fetch，新 fetch < 200ms 启动

## 11. 风险与权衡

### 11.1 bundle 体积

- pdfjs-dist: ~1.5 MB
- mammoth: ~250 KB
- exceljs: ~1 MB
- papaparse: ~50 KB
- 合计：~2.8 MB

**权衡**：dashboard 当前 bundle ~4 MB，+2.8 MB 是 70% 增长。
**缓解**：code-split，`binary_preview/*` 走 dynamic import，仅在选中二进制文件时才加载。
但 v1 简单起见，先全量打包，code-split 列为 v2 优化。

### 11.2 内存压力

- 50MB PDF → 50MB ArrayBuffer + pdfjs 内部 canvas
- 50MB XLSX → exceljs 全量解析为 JS 对象（内存放大数倍）

**权衡**：v1 不做流式 / 懒渲染。
**缓解**：50MB 硬上限；超限直接 413。

### 11.3 git ref 路径的 stdout 编码

- `_run_git_async` 当前返回 stdout 为字符串（utf-8 decode）
- binary blob 包含非 utf-8 字节会丢失

**缓解**：v1 加一个 `_run_git_async_bytes` 变体（见 §4.8 NOTE）。

### 11.4 DocumentManager 树的"显示 vs 创建"差异

- 树显示 5 种扩展名（用户能看到）
- 新建按钮只允许 .md（用户创建不了）

**权衡**：略反直觉（看到但不能创建）。
**缓解**：UI 提示"该文件类型暂不支持创建，请通过 git 拉入或 FileBrowser 拖拽上传"。
v2 评估是否扩展 `docs_crud` 端点接受 `.pdf/.docx/.xlsx` + multipart 上传。

### 11.5 行内注释 v1 不做

- 二进制文件无"行号"概念
- v1 与现有 binary 占位行为一致

**v2 路径**：pdfjs 支持点击位置 → 转回 ref + offset，exceljs 有 sheet/cell 概念。
**缓解**：v1 注释仅对 .md / .txt 等文本文件生效。

## 12. 后续工作（不在 v1 范围）

- **M1**：bundle code-split（binary_preview 走 dynamic import）
- **M1**：pdfjs canvas virtualized、xlsx sheet lazy load
- **M2**：CRUD 扩展到二进制（multipart upload + docs_crud 端点扩展）
- **M2**：LibreOffice 后端预处理（适用于 pptx、rtf、odt 等浏览器端无成熟方案的格式）
- **M2**：行内注释（pdfjs page/offset + exceljs sheet/cell）
- **M3**：服务端文本提取（用于 LLM 读取二进制内容）
- **M3**：FileBrowser 视图同样支持（独立 spec）

## 13. 关联 spec / 文档

- 前置：`docs/superpowers/specs/2026-06-20-git-diff-sidebar-file-browser-design.md`（FileBrowser 架构）
- 前置：`docs/superpowers/specs/2026-07-11-document-manager-backend-design.md`（docs CRUD 端点）
- 前置：`docs/superpowers/specs/2026-07-11-document-manager-design.md`（DocumentManager 前端）
- 关联：`data/plugins/astrbot_plugin_spcode_toolkit/docs/superpowers/specs/2026-06-20-file-browser-endpoint-design.md`（file-browser 端点）
- 关联：`data/plugins/astrbot_plugin_spcode_toolkit/docs/superpowers/specs/2026-07-11-document-manager-backend-design.md`
