# Git Squash Commits (压缩提交) — Design Spec

| Field | Value |
| --- | --- |
| Spec author | elecvoid243 |
| Created at | 2026-08-03 14:30 (CST) |
| Status | Draft — pending user review |
| Scope | Full-stack: Astrbot dashboard (frontend) + `astrbot_plugin_spcode_toolkit` (backend webapi). |

> Companion research reports (deleted after spec acceptance):
> `dashboard-squash-research-report.md` (frontend patterns) and
> `astrbot_plugin_spcode_toolkit/docs/backend_researcher_git_squash_webapi_report.md`
> (backend endpoint conventions). This spec is self-contained.

---

## 1. Goal

In the GitDiffSidebar "Git 历史 (History)" view, let the user select **N ≥ 2
contiguous commits starting from HEAD** and squash them into a single commit
with an edited message.

User flow:

1. Checkboxes appear on history rows (only when viewing the current branch
   tip, same visibility rule as the revert button).
2. The user checks N rows. The selection is valid iff it is exactly the top
   N rows of the list (contains HEAD, no gaps).
3. The "压缩提交" toolbar button (with selection count) becomes enabled.
4. Clicking it opens a dialog listing the selected commits (oldest → newest)
   with a textarea pre-filled with the concatenated subjects; the user edits
   and confirms.
5. Backend rewrites history via `git reset --soft <oldest>^` + `git commit`.
6. The history view refreshes (ETag invalidated), the selection clears, and a
   success snackbar shows the new short SHA.

### Non-goals (out of scope)

- Squashing an arbitrary contiguous range **not** containing HEAD, or a
  non-contiguous pick set. Both require non-interactive `git rebase -i`
  (`GIT_SEQUENCE_EDITOR` scripting) plus a third conflict state machine —
  deferred to a future iteration.
- Conflict resolution UI for squash. The reset+commit strategy cannot
  conflict (the tree already existed in history), so no `REBASE_*` reason
  codes or rebase sentinels are introduced.
- Persisting the selection (localStorage / Pinia). Selection is ephemeral
  component state.
- Force-push assistance after history rewrite. The dialog only warns.

---

## 2. Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | **Squash scope** | HEAD-anchored contiguous N commits only | `git reset --soft <oldest>^` + `git commit` is 100% cross-platform, cannot conflict, introduces no in-progress state machine. Approved by user 2026-08-03. |
| 2 | **Commit message** | Dialog with editable textarea, pre-filled with subjects concatenated oldest → newest (one per line) | User controls the final message; pre-fill mirrors `git merge --squash` conventions. Approved by user 2026-08-03. |
| 3 | **Worktree precondition** | Clean worktree required (`git status --porcelain` empty) | Keeps the squashed boundary unambiguous; consistent with other write ops. Backend returns `worktree_dirty` otherwise. Approved by user 2026-08-03. |
| 4 | **Selection UI** | Per-row checkboxes in `GitLogView`, not a numeric "last N" input | Selection is WYSIWYG; validity feedback is immediate. Approved by user 2026-08-03. |
| 5 | **Backend strategy** | `git reset --soft <oldest>^` then `git commit -F -` (message via stdin, env via `_build_git_env()`, hooks NOT disabled) | Reuses the exact `git_commit.py` invocation pattern; hook failures classify through `_classify_commit_error`. |
| 6 | **Contiguity validation** | Server-authoritative: `git rev-list HEAD -n <count>` set must equal the selected sha set | One command proves both "contains HEAD" and "contiguous". Frontend pre-validates for UX only; backend is the gate. |
| 7 | **Frontend write composable** | New `useSpcodeGitSquash.ts`, cloned from `useSpcodeGitRevert` — including its INLINE envelope parse (no dedicated parser file; `parseSpcodeGitRevert` does not exist either) and `umo` passed as a caller param | Keeps the established "single isXxx ref + single AbortController + dispose()" shape and stays consistent with the closest sibling. |
| 8 | **Selection state location** | Local ref inside `GitLogView.vue` (a `Set<string>`); sidebar clears it via a numeric reset-token prop | Do NOT lift to Pinia; do NOT reuse `expanded: Set<string>`. The reset-token mirrors the `focusedCommitSha` prop precedent. |
| 9 | **Dialog** | New `GitSquashDialog.vue`, cloned from `GitCherryPickDialog.vue` | Same v-model + loading + submit pattern; preset list replaces the ref input. |
| 10 | **Post-squash refresh** | Plain `gitLog.refresh()` (revert precedent) — NO `invalidateEtag()` | The git-log ETag is `W/"<head_sha>-<wt_mtime>-<idx_mtime>-<query>"`; squash changes head_sha AND the index mtime, so the conditional request revalidates server-side and never replays a stale 304. |
| 11 | **Button placement** | Filter bar, next to Cherry-Pick; shows `压缩提交 (N)`; disabled with tooltip while selection invalid | The filter bar already hosts the Cherry-Pick entry; row-level placement makes no sense for a multi-row action. |
| 12 | **i18n namespace** | `spcodeProjectLoad.diffSidebar.squash.*` in zh-CN / en-US / ru-RU | Matches `diffSidebar.cherryPick.*` precedent. |

---

## 3. Backend Spec (`astrbot_plugin_spcode_toolkit`)

### 3.1 Endpoint

`POST /spcode/git-squash` — registered in `tools/webapi/__init__.py`
(`ROUTES`, `HANDLERS`, `__all__` each gain one line). `_wrap()` is NOT
modified; the handler reads extra fields from `body`.

New module: `tools/webapi/git_squash.py` (same file layout as
`git_revert.py`).

Handler signature:

```python
async def handle(
    plugin,
    *,
    umo: str | None = None,
    worktree: str | None = None,
    body: dict | None = None,
) -> dict
```

### 3.2 Request body

```json
{
  "umo": "webchat:...",
  "worktree": "F:/repo/.worktrees/feat-x",   // optional
  "commits": ["<sha1>", "<sha2>", "..."],     // ≥ 2, any order, full or short sha
  "message": "feat: combined subject\n\nbody" // non-empty after strip
}
```

Validation (in order; first failure wins):

| Step | Check | Failure reason |
| --- | --- | --- |
| 1 | `body` is a dict | `invalid_body` |
| 2 | `commits` is a list of ≥ 2 non-empty strings | `invalid_param` |
| 3 | `message` is a non-empty string after strip | `invalid_message` |
| 4 | `_git_endpoint_preflight` (feature flags → umo → worktree 6-step defense → dir exists → is-inside-work-tree) | (preflight's own reasons) |
| 5 | `_detect_conflict_operation` — no merge/cherry-pick/revert in progress | `operation_in_progress` |
| 6 | `git status --porcelain` is empty | `worktree_dirty` |
| 7 | every sha resolves via `rev-parse <sha>^{commit}` | `commit_not_found` |
| 8 | `git rev-list HEAD -n <len(commits)>` set == resolved selected set | `head_not_selected` if HEAD ∉ set, else `not_contiguous` |
| 9 | `git rev-parse --verify <oldest>^` succeeds | `root_commit` |
| 10 | `git reset --soft <oldest>^` | `git_error` (stderr attached) |
| 11 | `git commit -F -` (stdin = message, env = `_build_git_env()`) | via `_classify_commit_error` (`pre_commit_hook_failed`, `identity_not_set`, `nothing_to_commit`, `git_error`) |

Step 8 details: `<oldest>` is the LAST line of the step-8 `rev-list` output
(rev-list prints newest first). The resolved full SHAs from step 7 are used
for set comparison, so short-SHA input is fine.

Note on step 6: `reset --soft` moves only HEAD/index, but we still require a
clean tree so uncommitted changes can never be mistaken for squashed content
(decision #3).

### 3.3 Response

Standard envelope (`_make_envelope`, HTTP always 200, error via
`data.reason`, `stderr` ≤ 4096 bytes, `elapsed_ms` always present).

Success `data` (mirrors `git_revert.py`'s success shape; branch-state
fields are intentionally NOT included — squash does not alter refs, and
`_read_post_mutation_branch_state` is reserved for branch-mutation
endpoints):

```json
{
  "squashed": true,
  "new_sha": "<full sha>",
  "message": "<first line of committed message>",
  "squashed_count": 3,
  "old_head_sha": "<full sha before reset>",
  "files_touched": ["a.py", "b.py"],
  "directory": "<repo root>",
  "umo": "<effective umo>",
  "worktree": "<repo root>"
}
```

Failure `data`: `{ "squashed": false, "reason": "<code>", "stderr": "..." }`.

### 3.4 New reason codes (`tools/webapi/_helpers.py`)

```python
HEAD_NOT_SELECTED = "head_not_selected"  # HEAD not among selected commits
NOT_CONTIGUOUS = "not_contiguous"        # selected set != top-N rev-list set
ROOT_COMMIT = "root_commit"              # oldest commit has no parent
```

`REBASE_IN_PROGRESS` / `REBASE_CONFLICT` from the research report are NOT
added (no rebase path in this spec).

### 3.5 Implementation notes

- All git invocations via `_run_git_async(..., cwd=directory, timeout=30.0)`,
  list-form args, never `shell=True`.
- `-c color.ui=never` on every git call (repo convention).
- Record `old_head_sha` via `rev-parse HEAD` BEFORE the reset.
- Success log: `logger.info("git-squash: %s → %s (%d commits, umo=%s)", ...)`.
- No write locks introduced (repo convention: git's own locks + frontend
  serialization + conflict sentinels).

---

## 4. Frontend Spec (`dashboard`)

### 4.1 New composable `src/composables/useSpcodeGitSquash.ts`

Clone of `useSpcodeGitRevert.ts`:

```ts
export interface UseSpcodeGitSquash {
  isSquashing: Readonly<Ref<boolean>>;
  squash(params: {
    shas: string[];
    message: string;
    worktree: string | null;
  }) => Promise<
    | { ok: true; snapshot: SpcodeGitSquashSnapshot }
    | { ok: false; reason: string; stderr?: string }
  >;
  dispose(): void;
}
```

- POSTs `spcode/git-squash` via `pluginExtensionApi.post` with
  `{ umo, worktree?, commits, message }`; `umo` is a caller param
  (GitDiffSidebar passes `spcodeStatus.status.value.umo`, exactly like
  the revert flow), `worktree` too.
- Inline envelope parse in the composable (mirrors
  `useSpcodeGitRevert.ts` — no dedicated parser file).
- Error tiers: `"aborted" | "network" | <backend reason> | "unknown"`,
  stderr passed through.
- Single in-flight request; `dispose()` aborts (called from
  `GitDiffSidebar.onBeforeUnmount` alongside the other composables).

New parser: NONE — the envelope is shallow, so the composable parses
inline (mirrors `useSpcodeGitRevert.ts`).

### 4.2 `GitLogView.vue` — selection UI

New local state:

```ts
const squashSelecting = ref(false);               // selection mode armed?
const selectedCommits = ref<Set<string>>(new Set());
```

Interaction model (revised 2026-08-03 per user feedback):

1. The toolbar button is **always clickable** while `viewingCurrent`.
2. The **first click arms selection mode** — checkboxes appear at the
   left of every row (rows grow a 32px left gutter via a
   `squash-selecting` class on the list container, so the absolutely
   positioned checkbox never overlaps the commit icon).
3. While armed, the button stays **grey (disabled)** until the
   selection is valid (≥ 2 HEAD-anchored contiguous rows); the
   **second click with a valid selection submits**. A separate small
   "取消" button exits the mode (the main button can't double as the
   exit because it is disabled exactly when the user may want out).

- **Checkbox per row**, rendered OUTSIDE the row header `<button>`
  (nested buttons are invalid HTML) and only while
  `viewingCurrent && squashSelecting` — no hover reveal; always
  visible in selection mode.
- **Validity computed** (unchanged): the selection is valid iff it is
  exactly the first N rows (N ≥ 2) of the displayed list. Because
  checkboxes only exist when `viewingCurrent`, the displayed list is
  the unfiltered HEAD-first list, so "first N rows" ⇔ "HEAD-anchored
  contiguous".
- **Toolbar button** in the filter bar next to Cherry-Pick:
  `mdi-arrow-collapse-vertical` + `压缩提交 (N)`; title shows
  `squash.selectionHint` while armed-and-invalid. Emits (commits
  ordered oldest → newest; the server re-validates anyway):

  ```ts
  (e: "squash", payload: { commits: { sha: string; subject: string }[] }): void
  ```

- **Reset**: new OPTIONAL prop `squashResetToken?: number` (optional so
  the `GitDiffSidebar` mount compiles before the wiring task lands);
  watcher clears the selection AND exits selection mode when it
  changes. A second watcher does the same when `viewingCurrent` flips
  false.

### 4.3 New `GitSquashDialog.vue`

Clone of `GitCherryPickDialog.vue` structure (`v-model`, `:loading`,
`@submit`):

- Lists the selected commits (short sha + subject), oldest → newest.
- Textarea `message`, pre-filled on open with the subjects joined by `\n`
  (oldest → newest). Submit disabled when `message.trim()` is empty or
  `loading`.
- **AI-generate (added 2026-08-03)**: 中文/EN toggle + "AI 生成" button
  cloned from `GitCommitDialog.vue`, reusing the generic one-shot LLM
  endpoint `POST /spcode/btw` via `useSpcodeBtw` — NO backend change.
  Unlike the commit dialog (which embeds the staged diff), the prompt
  context is **only the historical commit messages** (subject + body of
  each selected commit; no file content whatsoever — explicit user
  requirement). The prompt is built by `buildSquashMessagePrompt` in
  `commitMessagePrompt.ts` (4000-char budget, same JSON reply contract
  + few-shot examples; reply parsed by the existing
  `parseCommitMessageReply`). The btw call is deliberately umo-free
  (same rationale as the commit dialog: self-contained prompts follow
  the JSON contract more reliably). The language toggle shares the
  commit dialog's localStorage key; all UI strings reuse the existing
  `gitWorkflow.commit.dialog.*` i18n keys (zero new keys).
- Warning line: 压缩会改写历史，已推送的提交需要 force push
  (`squash.historyRewriteWarning`).
- Emits `(e: "submit", { shas: string[], message: string })`.

### 4.4 `GitDiffSidebar.vue` — orchestration

Mirrors the revert flow (`onLogRevertRequest`/`onConfirmRevert`):

```ts
const gitSquash = useSpcodeGitSquash();          // + dispose in onBeforeUnmount
const squashDialogOpen = ref(false);
const pendingSquash = ref<{ sha: string; subject: string }[] | null>(null);
const squashResetToken = ref(0);

function onLogSquashRequest(p: { commits: { sha: string; subject: string }[] }) {
  pendingSquash.value = p.commits;
  squashDialogOpen.value = true;
}

async function onSquashSubmit({ shas, message }) {
  const result = await gitSquash.squash({ shas, message, worktree: selectedWorktree.value });
  if (result.ok) {
    squashDialogOpen.value = false;
    pendingSquash.value = null;
    squashResetToken.value++;                     // clear GitLogView selection
    // Plain refreshes (revert precedent): the git-log ETag embeds
    // head_sha + index mtime, both changed by reset+commit, so the
    // conditional request revalidates server-side — no invalidateEtag
    // needed.
    void Promise.all([gitLog.refresh(), gitStatus.refresh(), composable.refresh()]);
    showSnackbar(tm("...squash.success", { sha: result.snapshot.newSha.slice(0, 7) }), "success");
    return;
  }
  if (result.reason === "aborted") return;
  const meta = SQUASH_REASON_I18N_KEYS[result.reason] ?? SQUASH_REASON_I18N_KEYS.unknown;
  squashDialogOpen.value = false;
  pendingSquash.value = null;
  showSnackbar(tm(meta.key), meta.color, meta.withStderr ? result.stderr : undefined);
}
```

`SQUASH_REASON_I18N_KEYS` palette mirrors `REVERT_REASON_I18N_KEYS`, covering
`head_not_selected`, `not_contiguous`, `root_commit`, `worktree_dirty`,
`operation_in_progress`, `commit_not_found`, `invalid_param`,
`invalid_message`, `pre_commit_hook_failed`, `identity_not_set`, `network`,
`unknown`.

`GitLogView` mount gains `@squash="onLogSquashRequest"` and
`:squash-reset-token="squashResetToken"`.

### 4.5 i18n keys (all three locales)

```
spcodeProjectLoad.diffSidebar.squash:
  toolbar              压缩提交 / Squash / Сжать
  selectionHint        仅支持从最新提交起连续选择 / Select a contiguous range from HEAD / ...
  dialogTitle          压缩提交 / Squash commits / ...
  messageLabel         Commit message (shared key if one exists)
  historyRewriteWarning 压缩会改写历史，已推送的提交需要 force push / ...
  success              已压缩为 {{sha}} / Squashed into {{sha}} / ...
  error.reason.{head_not_selected,not_contiguous,root_commit,worktree_dirty,
                operation_in_progress,commit_not_found,invalid_param,
                invalid_message,pre_commit_hook_failed,identity_not_set,
                network,unknown}
```

### 4.6 Icons

`mdi-arrow-collapse-vertical` (toolbar button), plus the existing
`mdi-checkbox-blank-outline` / `mdi-checkbox-marked`. No manual icon-list
maintenance — `scripts/subset-mdi-font.mjs` rescans `src/` at dev/build
time.

---

## 5. Edge Cases

| Case | Behavior |
| --- | --- |
| Selection loses HEAD-anchored contiguity (gap or missing top row) | Button disabled + hint; backend double-checks with `not_contiguous` / `head_not_selected` |
| User switches worktree / branch / applies a log filter while selecting | `viewingCurrent` flips false → checkboxes unmount and `selectedCommits` resets (watcher on `viewingCurrent`) |
| Oldest selected commit is the repo root | Backend `root_commit`; snackbar explains squashing the root commit is unsupported |
| pre-commit hook rejects | `pre_commit_hook_failed` + stderr in snackbar. Note: the `reset --soft` step has already run, so HEAD now sits at `<oldest>^` with the N commits' changes still staged — nothing is lost, and committing manually (or via the Git 变更 tab) completes the squash. The `squash.error.reason.pre_commit_hook_failed` text mentions the changes remain staged |
| Double-submit | `isSquashing` disables dialog submit; composable single-in-flight guards |
| Another op (merge/cherry-pick/revert) in progress | `operation_in_progress` |

---

## 6. Testing

### Backend (`astrbot_plugin_spcode_toolkit/tests/`)

`test_git_squash.py` (mock-subprocess unit tests, repo pattern A):

- happy path: 3 shas → reset+commit sequence asserted, envelope fields present
- `invalid_body` / `invalid_param` (1 commit) / `invalid_message`
- `worktree_dirty`, `operation_in_progress`
- `head_not_selected` (set mismatch containing no HEAD), `not_contiguous`
  (gap), `root_commit`
- `pre_commit_hook_failed` classification on commit step failure
- short-SHA input resolves before set comparison

Optional `test_git_squash_e2e.py` (repo pattern B, temp real repo): init repo,
3 commits, squash top 2, assert log count 2 and combined tree unchanged.

### Frontend (`dashboard`)

- `src/composables/__tests__/useSpcodeGitSquash.spec.ts` — mock
  `useSpcodeProjectStatus` + `@/api/v1` (template:
  `useSpcodeGitMerge.spec.ts`); success / reason passthrough /
  aborted / dispose.
- `src/components/chat/message_list_comps/GitLogView.squash.spec.ts` — heavy
  stub pattern (per `GitLogView.branchPicker.spec.ts`): checkbox visibility
  under `viewingCurrent` true/false, validity transitions
  none → invalid → valid, squash payload ordering (oldest first), reset-token
  watcher clears selection.

---

## 7. File Checklist

### Backend

| File | Change |
| --- | --- |
| `tools/webapi/git_squash.py` | NEW — handler |
| `tools/webapi/__init__.py` | ROUTES / HANDLERS / `__all__` +1 each; docstring endpoint list |
| `tools/webapi/_helpers.py` | +3 reason constants |
| `tests/test_git_squash.py` | NEW |
| `tests/test_git_squash_e2e.py` | NEW (optional) |

### Frontend

| File | Change |
| --- | --- |
| `dashboard/src/composables/useSpcodeGitSquash.ts` | NEW (inline parse — no parser file) |
| `dashboard/src/components/chat/GitSquashDialog.vue` | NEW |
| `dashboard/src/components/chat/message_list_comps/GitLogView.vue` | checkboxes + validity + toolbar button + reset-token prop + `squash` emit |
| `dashboard/src/components/chat/GitDiffSidebar.vue` | composable instance, dialog mount, orchestration, dispose |
| `dashboard/src/i18n/locales/{zh-CN,en-US,ru-RU}/features/chat.json` | `diffSidebar.squash.*` |
| test files ×2 | NEW (see §6) |

---

## 8. Future Iterations (explicitly NOT in this spec)

- Arbitrary-range / non-contiguous squash via non-interactive rebase
  (`GIT_SEQUENCE_EDITOR` with absolute `sys.executable` path, rebase
  sentinels `.git/rebase-{apply,merge}/`, third conflict UI state,
  `REBASE_IN_PROGRESS` / `REBASE_CONFLICT` reason codes).
- Squash-root support (`--root` rebase).
- Force-push follow-up action after history rewrite.
