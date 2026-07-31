# 工作区（GitDiffSidebar Files 面板）图片预览 — 设计文档

| 项目 | 内容 |
|------|------|
| 作者 | elecvoid243 |
| 日期 | 2026-07-31 |
| 状态 | 已批准（用户确认） |
| 范围 | spcode 插件后端 + dashboard 前端 |
| 关联 | `docs/superpowers/specs/2026-07-22-binary-preview-design.md`（BinaryPreview 管线） |

## 1. 背景与目标

GitDiffSidebar 有两个可浏览文件的面板：

- **工作区**（`FileBrowserView` + `FileBrowserFilePreview`）：显示项目所有文件，但目前图片等二进制文件无法预览。
- **文档管理**（`DocumentManager`）：文件树有白名单（pdf/docx/xlsx/csv/md），图片文件根本不会出现在列表里，因此图片预览放在这里没有意义（用户决策 2026-07-31）。

**目标**：在工作区面板点击图片文件时，直接内联显示图片；历史版本（git ref）中的图片同样可查看。

**非目标（YAGNI）**：

- 不做缩放/平移/旋转等完整查看器交互（基础查看即可，用户已确认）。
- 不把图片加入文档管理的树白名单。
- 不改动 file-browser 文本端点的契约（不返回 base64）。
- Markdown 正文内 `![](...)` 引用图片的解析不在本期范围。

## 2. 用户决策记录

| 决策点 | 结论 |
|--------|------|
| 图片格式范围 | `.png .jpg .jpeg .gif .webp` + `.svg .bmp .ico`（共 8 种） |
| 查看器交互 | 基础查看：适配面板宽度、居中、超高可滚动、显示分辨率 |
| 历史版本 | 支持（`selectedRevision` 透传给 `?ref=`，后端零改动） |
| 方案 | 复用 BinaryPreview 管线（方案 A） |

SVG 安全性说明：SVG 经 `<img>` 标签加载时浏览器不执行其中脚本，与直接导航到 SVG URL 不同，因此允许 `.svg` 是安全的。

## 3. 架构

```
FileBrowserFilePreview（工作区预览面板）
  └─ isImageFile（按扩展名判定）
       └─ <BinaryPreview :path="fileRelativePath" :git-ref="selectedRevision ?? ''" :worktree>
            ├─ useSpcodeFileBinary ── GET /spcode/file-binary?path=&ref=&worktree=
            └─ dispatch by data.kind
                 └─ "image" → <ImagePreview :blob :filename>   ← 新增
```

复用要点（零改动）：加载/错误状态机（idle/loading/ok/error）、ETag + 304 缓存、AbortController/dispose 生命周期、50MB 上限、路径安全校验、i18n 错误文案（`binary.errors.*`）。

## 4. 改动清单

### 4.1 后端（`data/plugins/astrbot_plugin_spcode_toolkit`）

| 文件 | 改动 |
|------|------|
| `tools/webapi/_helpers.py` | `MIME_BY_EXT` 增加 8 项：`.png→image/png`、`.jpg/.jpeg→image/jpeg`、`.gif→image/gif`、`.webp→image/webp`、`.svg→image/svg+xml`、`.bmp→image/bmp`、`.ico→image/x-icon` |
| `tests/test_file_binary.py` | 新增用例：png 返回 200 + `Content-Type: image/png`；svg 返回 200 + `image/svg+xml`；图片 ref 路径正常返回 |

其余后端逻辑（白名单校验、路径安全、大小上限、ETag、ref 路径）对任意扩展名通用，无需改动。

### 4.2 前端 composable

| 文件 | 改动 |
|------|------|
| `dashboard/src/composables/useSpcodeFileBinary.ts` | `FileBinaryKind` 联合类型加 `"image"`；`detectKind` 识别 8 个图片扩展名 |

### 4.3 新增组件 `dashboard/src/components/chat/message_list_comps/binary_preview/ImagePreview.vue`

- **Props**：`blob: Blob`、`filename: string`
- **行为**：
  - 挂载 / blob 变化时 `URL.createObjectURL(blob)`；卸载或换图前 `revokeObjectURL`（防内存泄漏）
  - `<img>` `max-width: 100%; display: block; margin: 0 auto`，容器纵向可滚动（超高图片）
  - `@load` 读取 `naturalWidth × naturalHeight`，图片下方 caption 显示 `800 × 600` 格式分辨率
  - 透明图片（png/svg）垫 CSS 棋盘格背景（`background-image` 渐变实现，无额外资源），避免深色主题下看不清
  - 加载失败（`@error`）显示现有错误占位样式
- 约 80 行，无第三方依赖（与 PdfPreview 等相比最简）

### 4.4 `binary_preview/BinaryPreview.vue`

- import `ImagePreview`，模板分发表新增 `"image"` 分支。
- header 自动显示 `IMAGE · 大小`（现有 `data.kind.toUpperCase()` 逻辑覆盖）。

### 4.5 `FileBrowserFilePreview.vue`（工作区面板）

- 新增 `isImageFile` computed：当 `state.kind === "file"` 时按 `state.snapshot.meta.path` 的扩展名判定（同一 8 种集合，模块级 `IMAGE_EXTS` 常量）。
- 模板新增图片分支：`v-if="isImageFile && !editMode"` 时主体渲染 `<BinaryPreview>`，替代代码视图；该分支下隐藏编辑/复制/行批注/inline-ask 等文本专属工具栏按钮（`canEdit` 已对 `meta.isBinary` 生效，顺延即可）。
- 历史版本：`:git-ref="selectedRevision ?? ''"` 透传；切换 revision 时 BinaryPreview 内部 watcher 自动重取。
- 工作区文件列表（`FileBrowserEntryList`）不做过滤改动——它本来就显示全部文件。

### 4.6 i18n

- `dashboard/src/i18n/locales/zh-CN/features/chat.json` 与 `en-US` 对应文件：复用现有 `spcodeProjectLoad.documentManager.binary.errors.*`；无需新增文案（分辨率为纯数字格式）。

## 5. 错误处理

| 场景 | 表现 |
|------|------|
| 图片 > 50MB | 后端 413 → 前端 `binary.errors.too_large` 占位 |
| 图片在 ref 中不存在 | 后端 422 → `binary.errors.file_missing_at_ref` |
| 非图片扩展名伪装 | 后端 415 → `binary.errors.unsupported_type` |
| 网络/解码失败 | `binary.errors.network` / `@error` 占位 |
| 未加载项目 | `no_project_loaded` 错误态（现有逻辑） |

## 6. 测试

### 6.1 后端（`tests/test_file_binary.py`）

- png 工作区路径：200 + `Content-Type: image/png` + 字节一致
- svg：200 + `image/svg+xml`
- png ref 路径（mock `git show`）：200 + 字节一致

### 6.2 前端

| 文件 | 用例 |
|------|------|
| `composables/__tests__/useSpcodeFileBinary.spec.ts` | `detectKind("a.PNG")` → `"image"`（大小写不敏感）；8 个扩展名全量 |
| `binary_preview/BinaryPreview.spec.ts` | kind=image 时渲染 ImagePreview 子组件 |
| `binary_preview/ImagePreview.spec.ts`（新） | objectURL 创建/revoke 生命周期；`@load` 后显示分辨率 caption |

`FileBrowserFilePreview.vue` 当前无覆盖测试（仓库现状），本期不为该巨型组件新建测试框架，图片分支逻辑（`isImageFile`）保持 5 行以内的极简实现。

## 7. 验收标准

1. 工作区面板点击 `.png/.jpg/.svg` 等 8 种图片 → 内联显示图片 + header（`IMAGE · 大小`）+ 分辨率 caption
2. 历史版本面板选择某 revision 后点击该版本的图片 → 显示历史内容
3. 切到非图片文件 → 恢复原代码视图；切回图片 → ETag 命中时无重复下载（304）
4. 文档管理面板行为不变（树仍不显示图片）
5. 后端 `uv run pytest tests/test_file_binary.py` 全绿；前端 `pnpm vitest run` 相关 spec 全绿
6. `ruff format` / `ruff check` 通过（后端改动）
