import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Monotonic id for each enqueued toast. App.vue binds :key on the snackbar to
// this id: without it, VSnackbar's timeout only starts on mount or on a
// modelValue false->true transition. When a second toast is queued while the
// first is still showing, shift() swaps current directly and modelValue never
// goes false, so the second toast's timeout would never start and it would
// stay on screen forever. The key forces a remount per toast instead.
let toastSeq = 0

export const useToastStore = defineStore('toast', () => {
  const queue = ref([])
  const current = computed(() => queue.value[0])

  function add({
    message,
    color = 'info',   // Vuetify 颜色
    timeout = 3000,
    closable = true,
    multiLine = false,
    location = 'top center'
  }) {
    queue.value.push({
      id: ++toastSeq,
      message,
      color,
      timeout,
      closable,
      multiLine,
      location
    })
  }

  function shift() {
    queue.value.shift()
  }

  return { current, add, shift }
})
