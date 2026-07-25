# Project Load Step Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Author: elecvoid243
>
> Timestamp: 2026-07-25 23:46 CST

**Goal:** Add two default-enabled controls to the existing project-load dialog so users can skip AGENTS.md or Codegraph while emitting the v2.21 `/project load` flags correctly.

**Architecture:** Keep the current `ProjectLoadDialog -> submit(string) -> ChatInput` contract unchanged. Store the two positive selections inside `ProjectLoadDialog.vue`, translate unchecked selections into deterministic trailing `no_agentsmd` and `no_codegraph` flags, and hide the controls in the reused Codegraph-only dialog.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Vuetify 3, AstrBot module i18n JSON, Vitest, Vue Test Utils, happy-dom.

## Global Constraints

- Work only in `F:\github\Astrbot\.worktrees\project-load-skip-flags` on branch `feat/project-load-skip-flags`.
- Keep both options selected whenever the project dialog opens; do not persist their values.
- Use positive UI labels but emit exact lowercase backend flags only for unchecked options.
- Keep `/codegraph set`, `/project unload`, path quoting, path history, and the `submit: [text: string]` event contract unchanged.
- Do not consume or display `/spcode/project-status.data.skipped_substeps` in this change.
- Keep `zh-CN`, `en-US`, and `ru-RU` locale keys structurally aligned.
- Follow KISS and the inline-first rule; extend the existing `buildLoadCommand` instead of adding a new helper.
- Use English for code comments and logs.
- Mark authored files with `elecvoid243` and the 2026-07-25 timestamp.
- Commit locally only; do not push or create a PR.
- The unrelated baseline failure in `DocumentManager.spec.ts` is out of scope. Relevant baseline: 2 files and 8 tests passed before implementation.

## File Map

- Create `dashboard/src/components/chat/ProjectLoadDialog.spec.ts`: behavior-level coverage for defaults, all flag combinations, quoting, reset-on-open, and Codegraph isolation.
- Modify `dashboard/src/components/chat/ProjectLoadDialog.vue`: own the two selection refs, reset them on open, render project-only checkboxes, and append deterministic flags.
- Modify `dashboard/src/i18n/locales/zh-CN/features/chat.json`: Chinese load-step labels.
- Modify `dashboard/src/i18n/locales/en-US/features/chat.json`: English load-step labels.
- Modify `dashboard/src/i18n/locales/ru-RU/features/chat.json`: Russian load-step labels.

---

### Task 1: Add project-load substep controls and command mapping

**Files:**
- Create: `dashboard/src/components/chat/ProjectLoadDialog.spec.ts`
- Modify: `dashboard/src/components/chat/ProjectLoadDialog.vue:1-211`
- Modify: `dashboard/src/i18n/locales/zh-CN/features/chat.json:288-303`
- Modify: `dashboard/src/i18n/locales/en-US/features/chat.json:288-303`
- Modify: `dashboard/src/i18n/locales/ru-RU/features/chat.json:278-292`

**Interfaces:**
- Consumes: `wakePrefixes: string[]` and `commandMode?: "project" | "codegraph"` props already accepted by `ProjectLoadDialog.vue`.
- Produces: unchanged `submit: [text: string]` event; project commands may now end in `no_agentsmd`, `no_codegraph`, or both.
- Preserves: exposed `openLoadDialog(): void` and `closeLoadDialog(): void` methods.

- [ ] **Step 1: Write the failing component tests**

Create `dashboard/src/components/chat/ProjectLoadDialog.spec.ts` with this complete content:

```ts
// Author: elecvoid243, 2026-07-25
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { describe, expect, it } from "vitest";
import ProjectLoadDialog from "./ProjectLoadDialog.vue";

const dialogStub = defineComponent({
  props: {
    modelValue: { type: Boolean, default: false },
  },
  template: '<div v-if="modelValue"><slot /></div>',
});

const textFieldStub = defineComponent({
  props: {
    modelValue: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  template: `
    <input
      data-testid="project-path"
      :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
    />
  `,
});

const checkboxStub = defineComponent({
  props: {
    modelValue: { type: Boolean, default: false },
    label: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  template: `
    <label>
      <input
        type="checkbox"
        :checked="modelValue"
        @change="$emit('update:modelValue', $event.target.checked)"
      />
      <span>{{ label }}</span>
    </label>
  `,
});

const buttonStub = defineComponent({
  props: {
    disabled: { type: Boolean, default: false },
  },
  emits: ["click"],
  template: `
    <button :disabled="disabled" @click="$emit('click')">
      <slot />
    </button>
  `,
});

const stubs = {
  "v-dialog": dialogStub,
  "v-card": { template: "<div><slot /></div>" },
  "v-card-title": { template: "<div><slot /></div>" },
  "v-card-text": { template: "<div><slot /></div>" },
  "v-card-actions": { template: "<div><slot /></div>" },
  "v-form": { template: "<form><slot /></form>" },
  "v-text-field": textFieldStub,
  "v-checkbox": checkboxStub,
  "v-btn": buttonStub,
  "v-divider": { template: "<hr />" },
  "v-spacer": { template: "<span />" },
};

function mountDialog(commandMode: "project" | "codegraph" = "project") {
  return mount(ProjectLoadDialog, {
    props: {
      wakePrefixes: ["/"],
      commandMode,
    },
    global: { stubs },
  });
}

async function openDialog(wrapper: VueWrapper): Promise<void> {
  (
    wrapper.vm as unknown as {
      openLoadDialog: () => void;
    }
  ).openLoadDialog();
  await nextTick();
}

async function submitPath(wrapper: VueWrapper, path: string): Promise<string> {
  await wrapper.get('[data-testid="project-path"]').setValue(path);
  const submitButton = wrapper
    .findAll("button")
    .find((button) => button.text() === "加载");
  expect(submitButton).toBeDefined();
  await submitButton!.trigger("click");
  return wrapper.emitted("submit")!.at(-1)![0] as string;
}

describe("ProjectLoadDialog load-step options", () => {
  it("shows both project load steps selected by default", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);

    const checkboxes = wrapper.findAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.map((checkbox) => checkbox.element.checked)).toEqual([
      true,
      true,
    ]);
    expect(wrapper.text()).toContain("加载 AGENTS.md");
    expect(wrapper.text()).toContain("加载 Codegraph");
  });

  it.each([
    [true, true, "/project load C:/projects/demo"],
    [false, true, "/project load C:/projects/demo no_agentsmd"],
    [true, false, "/project load C:/projects/demo no_codegraph"],
    [
      false,
      false,
      "/project load C:/projects/demo no_agentsmd no_codegraph",
    ],
  ])(
    "maps AGENTS.md=%s and Codegraph=%s to the expected command",
    async (loadAgentsMd, loadCodegraph, expected) => {
      const wrapper = mountDialog();
      await openDialog(wrapper);
      const checkboxes = wrapper.findAll<HTMLInputElement>(
        'input[type="checkbox"]',
      );

      if (!loadAgentsMd) await checkboxes[0].setValue(false);
      if (!loadCodegraph) await checkboxes[1].setValue(false);

      expect(await submitPath(wrapper, "C:/projects/demo")).toBe(expected);
    },
  );

  it("quotes a whitespace path before appending flags", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);
    const checkboxes = wrapper.findAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    await checkboxes[1].setValue(false);

    expect(await submitPath(wrapper, "C:/projects/my app")).toBe(
      '/project load "C:/projects/my app" no_codegraph',
    );
  });

  it("restores both selections every time the dialog opens", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);
    let checkboxes = wrapper.findAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    await checkboxes[0].setValue(false);
    await checkboxes[1].setValue(false);

    (
      wrapper.vm as unknown as {
        closeLoadDialog: () => void;
      }
    ).closeLoadDialog();
    await nextTick();
    await openDialog(wrapper);

    checkboxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes.map((checkbox) => checkbox.element.checked)).toEqual([
      true,
      true,
    ]);
  });

  it("keeps the Codegraph-only dialog free of project load flags", async () => {
    const wrapper = mountDialog("codegraph");
    await openDialog(wrapper);

    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);
    expect(await submitPath(wrapper, "C:/projects/demo")).toBe(
      "/codegraph set C:/projects/demo",
    );
  });
});
```

- [ ] **Step 2: Run the new spec and verify RED**

Run:

```cmd
cd /d F:\github\Astrbot\.worktrees\project-load-skip-flags\dashboard
pnpm exec vitest run src/components/chat/ProjectLoadDialog.spec.ts
```

Expected: FAIL in the project-mode tests because no `v-checkbox` controls exist and no `no_agentsmd` / `no_codegraph` flags are generated. The Codegraph-only regression case may already pass because it verifies preserved behavior.

If the test errors before assertions due to a stub issue, fix only the test harness and rerun until the failure is specifically caused by the missing feature.

- [ ] **Step 3: Add the minimal component state and command mapping**

In `dashboard/src/components/chat/ProjectLoadDialog.vue`, replace the existing `buildLoadCommand` function with:

```ts
/**
 * Compose the final chat input text for the load/set command.
 *
 * Args:
 *   wakePrefix: Wake prefix configured for chat commands.
 *   path: User-entered project path.
 *   cmdMode: Project-load or Codegraph-set command mode.
 *   loadAgentsMd: Whether the project load should run AGENTS.md steps.
 *   loadCodegraph: Whether the project load should run Codegraph steps.
 *
 * Returns:
 *   The complete command string to submit through ChatInput.
 */
function buildLoadCommand(
  wakePrefix: string,
  path: string,
  cmdMode: "project" | "codegraph",
  loadAgentsMd: boolean,
  loadCodegraph: boolean,
): string {
  const prefix = wakePrefix || "/";
  const trimmed = path.trim();
  const alreadyQuoted =
    trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2;
  const needsQuoting = !alreadyQuoted && /\s/.test(trimmed);
  const finalPath = needsQuoting ? `"${trimmed}"` : trimmed;
  const verb = cmdMode === "codegraph" ? "codegraph set" : "project load";
  const flags =
    cmdMode === "project"
      ? [
          loadAgentsMd ? "" : "no_agentsmd",
          loadCodegraph ? "" : "no_codegraph",
        ].filter(Boolean)
      : [];
  return `${prefix}${verb} ${[finalPath, ...flags].join(" ")}`;
}
```

Immediately after the existing `const path = ref("");`, add:

```ts
const loadAgentsMd = ref(true);
const loadCodegraph = ref(true);
```

Replace the existing `watch(dialogOpen, ...)` block with:

```ts
watch(dialogOpen, (open) => {
  if (open) {
    path.value = "";
    loadAgentsMd.value = true;
    loadCodegraph.value = true;
  }
});
```

Replace the existing `buildLoadCommand(...)` call inside `onConfirm()` with:

```ts
  const text = buildLoadCommand(
    props.wakePrefixes[0] || "/",
    trimmed,
    props.commandMode,
    loadAgentsMd.value,
    loadCodegraph.value,
  );
```

In the template, insert this block immediately after the closing `/>` of the project path `<v-text-field>` and before the recent-path history block:

```vue
          <div
            v-if="props.commandMode === 'project'"
            class="load-steps mb-2"
          >
            <div class="text-caption text-medium-emphasis mb-1">
              {{ tm("spcodeProjectLoad.dialog.loadStepsLabel") }}
            </div>
            <v-checkbox
              v-model="loadAgentsMd"
              :label="tm('spcodeProjectLoad.dialog.loadAgentsMd')"
              density="compact"
              hide-details
            />
            <v-checkbox
              v-model="loadCodegraph"
              :label="tm('spcodeProjectLoad.dialog.loadCodegraph')"
              density="compact"
              hide-details
            />
          </div>
```

Do not add a new helper or change the `submit` payload type.

- [ ] **Step 4: Add all three locale entries**

In `dashboard/src/i18n/locales/zh-CN/features/chat.json`, add these keys inside `spcodeProjectLoad.dialog`, immediately after `pathPlaceholder`:

```json
      "loadStepsLabel": "加载步骤",
      "loadAgentsMd": "加载 AGENTS.md",
      "loadCodegraph": "加载 Codegraph",
```

In `dashboard/src/i18n/locales/en-US/features/chat.json`, add:

```json
      "loadStepsLabel": "Load steps",
      "loadAgentsMd": "Load AGENTS.md",
      "loadCodegraph": "Load Codegraph",
```

In `dashboard/src/i18n/locales/ru-RU/features/chat.json`, add:

```json
      "loadStepsLabel": "Этапы загрузки",
      "loadAgentsMd": "Загрузить AGENTS.md",
      "loadCodegraph": "Загрузить Codegraph",
```

- [ ] **Step 5: Run the new spec and verify GREEN**

Run:

```cmd
cd /d F:\github\Astrbot\.worktrees\project-load-skip-flags\dashboard
pnpm exec vitest run src/components/chat/ProjectLoadDialog.spec.ts
```

Expected: PASS, 1 test file with 8 test cases (the `it.each` table contributes four cases).

If a test fails, change production code rather than weakening the expected command strings.

- [ ] **Step 6: Run focused regression, i18n, lint, and type checks**

Run:

```cmd
cd /d F:\github\Astrbot\.worktrees\project-load-skip-flags\dashboard
pnpm exec vitest run src/components/chat/ProjectLoadDialog.spec.ts src/components/chat/SpcodeProjectIndicator.spec.ts src/components/chat/SpcodeCodegraphChip.spec.ts src/i18n/i18n.completeness.spec.ts
pnpm exec eslint src/components/chat/ProjectLoadDialog.vue src/components/chat/ProjectLoadDialog.spec.ts
pnpm typecheck
cd ..
git diff --check
git status --short
```

Expected:

- Four Vitest files pass with no failed tests.
- ESLint exits with code 0 for the modified Vue and test files.
- `vue-tsc --noEmit` exits with code 0.
- `git diff --check` prints nothing.
- `git status --short` lists only the intended component, test, and three locale files.

Do not run `pnpm test -- <paths>` because this repository's script forwards the extra `--` in a way that runs the full suite. Use `pnpm exec vitest run <paths>` exactly as shown.

- [ ] **Step 7: Review the diff against the approved design**

Run:

```cmd
cd /d F:\github\Astrbot\.worktrees\project-load-skip-flags
git diff -- dashboard/src/components/chat/ProjectLoadDialog.vue dashboard/src/components/chat/ProjectLoadDialog.spec.ts dashboard/src/i18n/locales/zh-CN/features/chat.json dashboard/src/i18n/locales/en-US/features/chat.json dashboard/src/i18n/locales/ru-RU/features/chat.json
```

Confirm all of the following before committing:

- Both positive options default to selected on every open.
- Unchecked options map to exact lowercase flags in deterministic order.
- Project paths with spaces remain quoted before flags.
- Codegraph mode renders no project-step controls and emits no project flags.
- No `ChatInput.vue`, status composable, generated API client, or backend file changed.

- [ ] **Step 8: Commit the implementation locally**

Run:

```cmd
cd /d F:\github\Astrbot\.worktrees\project-load-skip-flags
git add dashboard/src/components/chat/ProjectLoadDialog.vue dashboard/src/components/chat/ProjectLoadDialog.spec.ts dashboard/src/i18n/locales/zh-CN/features/chat.json dashboard/src/i18n/locales/en-US/features/chat.json dashboard/src/i18n/locales/ru-RU/features/chat.json
git commit -m "feat(chat): add project load step options"
git status --short --branch
```

Expected: local commit succeeds and the worktree is clean. Do not push.

## Final Verification Record

Capture the exact command outputs used for the completion report:

```cmd
cd /d F:\github\Astrbot\.worktrees\project-load-skip-flags\dashboard
pnpm exec vitest run src/components/chat/ProjectLoadDialog.spec.ts src/components/chat/SpcodeProjectIndicator.spec.ts src/components/chat/SpcodeCodegraphChip.spec.ts src/i18n/i18n.completeness.spec.ts
pnpm exec eslint src/components/chat/ProjectLoadDialog.vue src/components/chat/ProjectLoadDialog.spec.ts
pnpm typecheck
cd ..
git show --check --stat --oneline HEAD
git status --short --branch
```

The final response must distinguish focused passing evidence from the known unrelated full-suite `DocumentManager.spec.ts` baseline failure.
