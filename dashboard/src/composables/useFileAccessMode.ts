// src/composables/useFileAccessMode.ts
//
// Singleton state for the per-session file access mode chip
// (full / readonly / workspace). Mirrors `useSpcodePlanMode.ts`:
// module-level ref + explicit mutation methods; soft-fail refresh.

import { ref } from 'vue'
import { fileAccessApi, type FileAccessModeValue } from '@/api/v1'

export type FileAccessMode = FileAccessModeValue

export interface FileAccessState {
  mode: FileAccessMode | null
  defaultMode: FileAccessMode | null
}

const state = ref<FileAccessState>({ mode: null, defaultMode: null })

export function useFileAccessMode() {
  /**
   * Pull the authoritative mode for a session from the core endpoint.
   * Soft-fails: keeps the last known state on network/auth errors.
   */
  async function refresh(umo: string): Promise<void> {
    try {
      const res = await fileAccessApi.get(umo)
      const data = res.data?.data
      if (!data) return
      state.value = { mode: data.mode, defaultMode: data.default_mode }
    } catch (err) {
      console.warn('[useFileAccessMode] refresh failed:', err)
    }
  }

  /**
   * Authoritatively set the mode via POST. Returns false on failure so
   * the caller can resync or fall back.
   */
  async function setMode(umo: string, mode: FileAccessMode): Promise<boolean> {
    try {
      const res = await fileAccessApi.set(umo, mode)
      const data = res.data?.data
      if (!data) return false
      state.value = { mode: data.mode, defaultMode: data.default_mode }
      return true
    } catch (err) {
      console.warn('[useFileAccessMode] setMode failed:', err)
      return false
    }
  }

  /** Optimistic local flip used right after a chip click. */
  function setOptimistic(mode: FileAccessMode): void {
    state.value = { ...state.value, mode }
  }

  /** Wipe to the unknown state (logout / no active session). */
  function reset(): void {
    state.value = { mode: null, defaultMode: null }
  }

  return { status: state, refresh, setMode, setOptimistic, reset }
}
