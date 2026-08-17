// src/composables/useSkillGuide.ts
//
// Singleton state for the Skill Guide plugin
// (`astrbot_plugin_skill_guide`, routes under `/skill-guide/*`).
//
// Mirrors the pattern of `useSpcodePlanMode.ts`:
//
//   - one module-level ref set so every consumer (the hover menu
//     button, the pending badges row in ChatInput) reads the same
//     state without coordinating fetches;
//   - explicit mutation methods (`setSession` / `toggleSkill` /
//     `clearAll` / `consumeQueued` / `reset`) as the only writers;
//   - a soft-fail `refresh` that never throws to callers.
//
// Semantics (from the plugin README, v1):
//
//   - The plugin exposes a per-session (umo) queue of one-shot skill
//     "nudges". When the next LLM request for that session fires, the
//     plugin injects a guidance prompt into `extra_user_content_parts`
//     and drains the queue — persona and the skill's global active
//     state are NOT touched.
//   - The frontend only *queues* (POST /skill-guide/load). The actual
//     injection happens server-side on the next request, so the
//     pending badges are cleared optimistically when the message is
//     sent (see `consumeQueued`).
//
// Author: elecvoid243
// Last-Modified: 2026-08-16

import { ref } from 'vue'
import { pluginExtensionApi } from '@/api/v1'

/** One entry of GET /skill-guide/active -> data.skills[]. */
export interface SkillGuideSkill {
  name: string
  description: string
  path: string
  source_type: string
}

/** GET /skill-guide/active -> data. */
export interface SkillGuideActivePayload {
  persona: { id: string; name: string } | null
  skills: SkillGuideSkill[]
}

/** POST /skill-guide/load -> data. */
export interface SkillGuideLoadPayload {
  skill_name: string
  queued: boolean
}

/** POST /skill-guide/clear -> data. */
export interface SkillGuideClearPayload {
  cleared: string[]
}

const ACTIVE_PATH = 'skill-guide/active'
const LOAD_PATH = 'skill-guide/load'
const CLEAR_PATH = 'skill-guide/clear'

// --- module-level singleton state -------------------------------------------

/** Current session's unified_msg_origin (null = no session). */
const sessionUmo = ref<string | null>(null)

/** True once the plugin answered /skill-guide/active successfully. Used as
 *  the visibility gate for the whole UI (plugin not installed/disabled
 *  -> the button simply never appears). */
const available = ref(false)

const loading = ref(false)
const loadFailed = ref(false)

/** Resolved persona (if any) for the current session. */
const persona = ref<{ id: string; name: string } | null>(null)

/** Skills effective for the current session (plugin/persona filtered). */
const skills = ref<SkillGuideSkill[]>([])

/** Skill names queued for the NEXT LLM request of this session. */
const queued = ref<string[]>([])

/**
 * Composable returning the Skill Guide singleton.
 *
 * The dashboard only writes to the refs through the explicit methods
 * below. `ChatInput.vue` is the single owner of `setSession` (driven
 * by the sessionId watcher); the button and the badges row only read.
 */
export function useSkillGuide() {
  /**
   * Point the singleton at a session and (re)fetch its active skills.
   * Passing `null` detaches (queue + list are wiped).
   */
  async function setSession(umo: string | null): Promise<void> {
    if (umo === sessionUmo.value && umo !== null) {
      return // same session — nothing to reload
    }
    sessionUmo.value = umo
    queued.value = []
    persona.value = null
    skills.value = []
    loadFailed.value = false
    if (umo) {
      await refresh(umo)
    } else {
      available.value = false
    }
  }

  /**
   * Soft-fail fetch of the session's active skills. On success the
   * plugin is deemed available (the UI gate flips on). On failure we
   * keep the last known list and set `loadFailed` so the menu can
   * render an inline retry affordance.
   */
  async function refresh(umo: string | null = sessionUmo.value): Promise<void> {
    if (!umo) return
    loading.value = true
    loadFailed.value = false
    try {
      const res = await pluginExtensionApi.get<SkillGuideActivePayload>(
        ACTIVE_PATH,
        { params: { umo } },
      )
      const data = res.data?.data
      if (!data || !Array.isArray(data.skills)) {
        throw new Error('malformed /skill-guide/active payload')
      }
      persona.value = data.persona ?? null
      skills.value = data.skills
      available.value = true
    } catch {
      // Soft-fail: plugin missing/disabled or transient network error.
      loadFailed.value = true
    } finally {
      loading.value = false
    }
  }

  /**
   * Toggle a skill on/off the one-shot queue.
   *
   * Queuing POSTs /skill-guide/load. Un-queuing a SINGLE skill works
   * around the plugin's v1 API (POST /skill-guide/clear only drops the
   * WHOLE session queue): we clear first, then re-queue the remaining
   * selection so only the clicked skill is removed.
   */
  async function toggleSkill(name: string): Promise<boolean> {
    const umo = sessionUmo.value
    if (!umo || !skills.value.some((s) => s.name === name)) return false
    if (queued.value.includes(name)) {
      const remaining = queued.value.filter((n) => n !== name)
      await clearAll()
      for (const n of remaining) {
        await queueSkill(n)
      }
      return false
    }
    return queueSkill(name)
  }

  /**
   * Queue one skill via POST /skill-guide/load and mirror it locally.
   * Shared by the select path and the re-queue step of single un-select.
   */
  async function queueSkill(name: string): Promise<boolean> {
    const umo = sessionUmo.value
    if (!umo) return false
    try {
      const res = await pluginExtensionApi.post<SkillGuideLoadPayload>(
        LOAD_PATH,
        { umo, skill_name: name },
      )
      if (res.data?.status !== "ok" || !res.data?.data?.queued) {
        throw new Error(res.data?.message ?? 'load failed')
      }
      if (!queued.value.includes(name)) {
        queued.value.push(name)
      }
      return true
    } catch {
      return false
    }
  }

  /** Drop every pending nudge for the session. */
  async function clearAll(): Promise<void> {
    const umo = sessionUmo.value
    queued.value = []
    if (!umo) return
    try {
      await pluginExtensionApi.post<SkillGuideClearPayload>(CLEAR_PATH, { umo })
    } catch {
      // Soft-fail: the queue is in-memory on the plugin side and will
      // be drained (or vanish on restart) anyway; local state wins.
    }
  }

  /**
   * Optimistically clear the local queue when a message is sent.
   * The plugin drains the session queue on the next LLM request, so
   * the badges have served their purpose by the time the request
   * fires. (One-shot semantics — the nudge does NOT apply twice.)
   */
  function consumeQueued(): void {
    queued.value = []
  }

  /** Wipe everything (e.g. logout / ChatInput unmount). */
  function reset(): void {
    sessionUmo.value = null
    available.value = false
    loading.value = false
    loadFailed.value = false
    persona.value = null
    skills.value = []
    queued.value = []
  }

  return {
    // state
    sessionUmo,
    available,
    loading,
    loadFailed,
    persona,
    skills,
    queued,
    // methods
    setSession,
    refresh,
    toggleSkill,
    clearAll,
    consumeQueued,
    reset,
  }
}
