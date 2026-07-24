# ChatUI 侧边栏会话分支关系展示 — 设计文档

日期：2026-07-24
状态：已批准（用户确认方案 C）

## 背景

WebChat 会话分支功能（见 `2026-07-24-chatui-session-branch-design.md`）上线后，侧边栏会话列表无法体现分支关系：

- 分支会话仅以 `分支 · {源会话标题}` 命名前缀区分，用户无法直观看到「哪些会话有分支、分支有哪些」；
- 分支关系当前只记录在分支会话消息历史的第一条 `branch_info` 记录中（`content.source_session_id` / `source_message_id` / `inherited_count`），`platform_sessions` 表无分支字段；
- 会话列表接口 `ChatService.get_sessions()` 不返回任何分支元数据。

## 目标

在侧边栏会话列表中直观呈现分支关系，并提供双向跳转：

1. 父会话：显示分支徽标（图标 + 数量），点击弹出下拉菜单列出所有直接子分支，点击跳转；
2. 分支会话：显示「回源」图标，点击跳回源会话。

## 非目标（YAGNI）

- 不做树形缩进分组、不改动列表按 `updated_at` 排序的逻辑；
- 只展示**直接**父子关系；多级分支通过逐层跳转到达；
- 删除会话不级联（分支历史是独立副本，互不影响）；
- 保持 `分支 · ` 命名前缀不变。

## 方案选型（数据获取）

| | 方案 ①（采纳）：从 `branch_info` 记录派生 | 方案 ②：会话表加 `source_session_id` 列 |
|---|---|---|
| DB 迁移 | 无需 | 需要 |
| 存量分支 | 自动生效 | 关系丢失 |
| 查询 | 一次粗筛 SQL + Python 精确解析 | 直接列查询 |

采纳方案 ①：无迁移、对存量分支生效、逻辑集中在 service 层。

## 详细设计

### 后端

**DB 层**（`astrbot/core/db/`）

- `BaseDatabase` 新增抽象方法，`SQLiteDatabase` 实现：

```python
async def get_webchat_branch_infos(self) -> list[PlatformMessageHistory]:
```

- SQL：`CAST(content AS TEXT) LIKE '%"branch_info"%'` 粗筛，按记录 ID 升序；
- **性能注意**：`platform_message_history` 无 content 索引，该查询是全表扫描（实测 1.8 万行 / 311MB 内容约 1~3s），**只用于一次性缓存预热，禁止每请求调用**；
- 调用方需二次校验 `content["type"] == "branch_info"`（粗筛为文本匹配）。

**Service 层**（`ChatService`）

- 新增内存缓存 `_branch_relations: dict[child_session_id, {source_session_id, source_message_id}] | None`；
- `get_branch_relations()`：首次调用时全量扫描一次（懒加载），之后命中缓存；`branch_session` 创建分支后增量更新缓存；
- `get_sessions()`：基于缓存构建双向关系，**过滤掉当前列表中不存在的会话**（源会话/子分支已删除时的陈旧条目），每个会话 dict 新增字段：

```jsonc
{
  // 我是分支 → 指向源会话；非分支为 null
  "branch_source": { "session_id": "...", "message_id": 123 } | null,
  // 我的直接子分支（按分支创建时间升序）
  "branches": [{ "session_id": "...", "display_name": "..." }]
}
```

- `display_name` 取当前列表内会话名；子分支不在当前页时可能为 `null`，前端兜底显示；
- 源会话已删除时 `branch_source.session_id` 可能悬空，前端跳转走既有错误处理（toast）。

**API 层**

- `/api/v1/chat/sessions` 响应为 `ok(list[dict])`，无 pydantic response model，OpenAPI schema 无变化，**无需**重新生成前端客户端；
- 前端类型通过 `useSessions.ts` 的本地 `Session` 接口扩展。

### 前端

**`useSessions.ts`**

- `Session` 接口新增：

```ts
branch_source: { session_id: string; message_id: number } | null;
branches: Array<{ session_id: string; display_name: string | null }>;
```

**`Chat.vue` 侧边栏会话行**

- 父会话（`branches.length > 0`）：行尾显示 `mdi-source-branch` + 数量的徽标按钮，点击弹出 `v-menu`，列出子分支标题（空名兜底为「新的聊天」类 i18n 文案），点击 `selectSession(branch.session_id)` 跳转；
- 分支会话（`branch_source` 非空）：行内显示「回源」图标按钮（tooltip：`branch.jumpToSource`），点击 `selectSession(branch_source.session_id)`；
- 与现有 hover 操作（重命名、删除）布局协调，不挤压标题；
- 复用现有 `StyledMenu`/菜单样式与 `selectSession` 导航逻辑。

**i18n**（`features/chat.json` × 3 语言）

- `branch.branches`：分支菜单标题/徽标 tooltip（zh: 分支 / en: Branches / ru: Ветки）
- `branch.jumpToSource`：zh: 跳转到源会话 / en: Jump to source session / ru: Перейти к исходной сессии

## 错误处理

- DB 查询失败：沿用 `get_sessions` 既有异常路径（`ChatServiceError` → `error(...)`）；
- `branch_info` 记录解析异常（content 非 dict / 缺字段）：跳过该记录，不影响列表主流程；
- 前端跳转到已删除源会话：走 `selectSession` 既有 404 错误提示。

## 测试

- 后端：service 层单测——创建会话 → 分支 → 断言 `get_sessions()` 返回的 `branch_source` / `branches` 双向关系正确（含空列表/无分支场景）；
- 前端：沿用既有 vitest 习惯；i18n completeness spec 自动覆盖新 key 的三语言一致性；
- 构建验证：`vue-tsc --noEmit && vite build` 通过；HTTP 实测 `/api/v1/chat/sessions` 响应包含新字段。

## 影响面

- 修改：`astrbot/core/db/__init__.py`、`astrbot/core/db/sqlite.py`、`astrbot/dashboard/services/chat_service.py`、`dashboard/src/composables/useSessions.ts`、`dashboard/src/components/chat/Chat.vue`、`dashboard/src/i18n/locales/*/features/chat.json`
- 无 schema 迁移、无 OpenAPI 变更、无新依赖。
