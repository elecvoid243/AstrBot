<!--
  Author: elecvoid243, 2026-08-16
  Plugin: astrbot_plugin_skill_guide (routes /skill-guide/*, see plugin README)

  SkillGuideMenuItem — "手动加载 Skill" entry inside the chat input's
  "+" menu.

  The skill list is a COMPLETELY SEPARATE v-menu: its activator is the
  "+" menu item, but its content (a plain self-drawn card) is teleported
  to <body> like any other menu — the two menus never share DOM or layout.

  Interaction:
    - The activator is a regular "+" menu item (v-list-item).
    - Hovering it opens the skill menu. Open/close is self-managed via
      v-model: the menu closes whenever the pointer leaves the item or
      the card (with a short delay for a flicker-free hover path) —
      always, whether or not a skill was selected.
    - Un-selecting ONE skill keeps the others (clear + re-queue).
    - The card has hard caps: max-height + scroll for many skills,
      max-width with ellipsis-truncated lines so it never grows with the
      descriptions.

  Queuing semantics (from the plugin README): clicking a skill POSTs
  /skill-guide/load for a ONE-SHOT nudge — the plugin injects a guidance
  prompt into the NEXT LLM request of the session and drains the queue.
  Persona and the skill's global active state are never touched.
-->
<template>
  <v-menu
    v-model="open"
    :close-on-content-click="false"
    location="end"
    offset="6"
    min-width="300"
    max-width="340"
    class="skill-guide-menu"
  >
    <template v-slot:activator="{ props: activatorProps }">
      <v-list-item
        v-bind="activatorProps"
        class="styled-menu-item"
        rounded="md"
        :disabled="disabled || !sessionId"
        data-test="skill-guide-menu-item"
        @mouseenter="handleEnter"
        @mouseleave="scheduleClose"
      >
        <template v-slot:prepend>
          <v-icon icon="mdi-lightbulb-on-outline" size="small"></v-icon>
        </template>
        <v-list-item-title>{{
          tm("input.skillGuide.button")
        }}</v-list-item-title>
      </v-list-item>
    </template>

    <div
      class="skill-guide-menu-card"
      data-test="skill-guide-menu-card"
      @mouseenter="cancelClose"
      @mouseleave="scheduleClose"
    >
      <div class="skill-guide-menu-card__header">
        <v-icon icon="mdi-lightbulb-on-outline" size="14"></v-icon>
        <span class="skill-guide-menu-card__title">{{
          tm("input.skillGuide.menuTitle")
        }}</span>
        <span
          v-if="queued.length > 0"
          class="skill-guide-menu-card__count"
          data-test="skill-guide-pop-count"
          >{{ queued.length }}</span
        >
      </div>

      <div class="skill-guide-menu-card__list">
        <div
          v-if="loading"
          class="skill-guide-menu-card__hint"
          data-test="skill-guide-loading"
        >
          {{ tm("input.skillGuide.loading") }}
        </div>
        <div
          v-else-if="loadFailed"
          class="skill-guide-menu-card__hint"
          data-test="skill-guide-load-failed"
        >
          <v-icon icon="mdi-alert-circle" size="14"></v-icon>
          {{ tm("input.skillGuide.loadFailed") }}
        </div>
        <div
          v-else-if="skills.length === 0"
          class="skill-guide-menu-card__hint"
          data-test="skill-guide-empty"
        >
          {{ tm("input.skillGuide.empty") }}
        </div>

        <button
          v-for="skill in skills"
          v-show="!loading && !loadFailed"
          :key="skill.name"
          type="button"
          class="skill-guide-menu-card__item"
          :class="{
            'skill-guide-menu-card__item--queued': isQueued(skill.name),
          }"
          :data-test="`skill-guide-item-${skill.name}`"
          :title="skill.description || skill.name"
          @click="handleToggle(skill)"
        >
          <v-icon
            :icon="
              isQueued(skill.name)
                ? 'mdi-check-circle'
                : 'mdi-lightbulb-on-outline'
            "
            size="14"
            class="skill-guide-menu-card__item-icon"
          ></v-icon>
          <span class="skill-guide-menu-card__item-body">
            <span class="skill-guide-menu-card__item-name-row">
              <span class="skill-guide-menu-card__item-name">{{
                skill.name
              }}</span>
              <span
                v-if="isQueued(skill.name)"
                class="skill-guide-menu-card__item-queued"
                >{{ tm("input.skillGuide.queued") }}</span
              >
            </span>
            <span
              v-if="skill.description"
              class="skill-guide-menu-card__item-desc"
              >{{ skill.description }}</span
            >
          </span>
        </button>

        <button
          v-if="queued.length > 0"
          type="button"
          class="skill-guide-menu-card__clear"
          data-test="skill-guide-clear-all"
          @click="handleClearAll"
        >
          <v-icon icon="mdi-close-circle" size="14"></v-icon>
          <span>{{ tm("input.skillGuide.clearAll") }}</span>
        </button>
      </div>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { useModuleI18n } from "@/i18n/composables";
import {
  useSkillGuide,
  type SkillGuideSkill,
} from "@/composables/useSkillGuide";

const props = withDefaults(
  defineProps<{
    sessionId?: string | null;
    isGroup?: boolean;
    disabled?: boolean;
  }>(),
  {
    sessionId: null,
    isGroup: false,
    disabled: false,
  },
);

const { tm } = useModuleI18n("features/chat");

// Singleton state shared with ChatInput's pending-badge row — reading the
// same refs means the skill menu's ✓ marks and the badges can never diverge.
const guide = useSkillGuide();
const { skills, queued, loading, loadFailed } = guide;

// Open/close is fully self-managed (v-model on the v-menu): hovering the
// item opens it; the menu closes whenever the pointer leaves the item OR
// the card — with a short delay so moving between them never flickers.
// This is deliberate: Vuetify's open-on-hover stops closing once content
// has been clicked, which would break the "closes on leave" expectation
// after selecting a skill. A delayed leave is the single, consistent rule.
const open = ref(false);
const CLOSE_DELAY_MS = 150;
let closeTimer: number | null = null;

function handleEnter(): void {
  cancelClose();
  open.value = true;
}

function scheduleClose(): void {
  if (closeTimer !== null) return;
  closeTimer = window.setTimeout(() => {
    open.value = false;
    closeTimer = null;
  }, CLOSE_DELAY_MS);
}

function cancelClose(): void {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
}

onBeforeUnmount(cancelClose);

function isQueued(name: string): boolean {
  return queued.value.includes(name);
}

async function handleToggle(skill: SkillGuideSkill): Promise<void> {
  await guide.toggleSkill(skill.name);
}

async function handleClearAll(): Promise<void> {
  await guide.clearAll();
}
</script>

<!--
  NOT scoped on purpose: v-menu teleports its content to <body>, so
  scoped attribute selectors would never match. Class names are
  prefixed (skill-guide-*) to stay collision-free, mirroring the
  global style block of StyledMenu.vue.

  The card is a plain self-drawn div (no v-card): hover close + tests
  bind directly to it. Size caps (spec): the list scrolls beyond
  max-height, and every text line is single-line ellipsis so the menu
  width never grows with the description length.
-->
<style>
.skill-guide-menu-card {
  min-width: 300px;
  max-width: 340px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 10px;
  background: rgba(var(--v-theme-surface), 0.98);
  backdrop-filter: blur(10px);
  box-shadow: var(--astrbot-menu-shadow, 0 12px 28px rgba(0, 0, 0, 0.08));
}

.v-theme--PurpleThemeDark .skill-guide-menu-card {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(45, 45, 45, 0.98);
}

.skill-guide-menu-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: inherit;
}

.skill-guide-menu-card__title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.skill-guide-menu-card__count {
  margin-left: auto;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.9);
  color: rgb(var(--v-theme-on-primary));
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

/* Scroll past max-height when the session exposes many skills. */
.skill-guide-menu-card__list {
  max-height: min(48vh, 320px);
  overflow-y: auto;
  padding: 4px;
}

.skill-guide-menu-card__hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

/* Compact rows; every text line is single-line + ellipsis so the menu
   width never grows with the description length. */
.skill-guide-menu-card__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  text-align: left;
  cursor: pointer;
}

.skill-guide-menu-card__item:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}

.skill-guide-menu-card__item--queued {
  background: rgba(var(--v-theme-primary), 0.12);
}

.skill-guide-menu-card__item-icon {
  flex: none;
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.skill-guide-menu-card__item--queued .skill-guide-menu-card__item-icon {
  color: rgb(var(--v-theme-primary));
}

.skill-guide-menu-card__item-body {
  flex: 1;
  min-width: 0;
}

.skill-guide-menu-card__item-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.skill-guide-menu-card__item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
}

.skill-guide-menu-card__item-queued {
  flex: none;
  font-size: 9.5px;
  font-weight: 500;
  color: rgb(var(--v-theme-primary));
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  border-radius: 5px;
  padding: 0 4px;
  line-height: 14px;
  white-space: nowrap;
}

.skill-guide-menu-card__item-desc {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.skill-guide-menu-card__clear {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin-top: 2px;
  padding: 6px 8px;
  border: none;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 0 0 8px 8px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 11px;
  cursor: pointer;
}

.skill-guide-menu-card__clear:hover {
  background: rgba(var(--v-theme-error), 0.08);
  color: rgb(var(--v-theme-error));
}
</style>
