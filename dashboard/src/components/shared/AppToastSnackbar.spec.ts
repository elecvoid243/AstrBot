// Store-level tests for the global toast queue.
//
// Note on scope: the snackbar remount-on-toast-change behavior (App.vue binds
// :key to current.id so VSnackbar's timeout restarts for every queued toast)
// cannot be exercised here — VOverlay-based components do not render under
// happy-dom. These tests pin the queue contract the :key fix relies on.
import { setActivePinia, createPinia } from 'pinia';
import { describe, expect, it, beforeEach } from 'vitest';
import { useToastStore } from '@/stores/toast';

describe('toast store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // toast.js is untyped (queue inferred as never[]), so read through casts
  const cur = () => useToastStore().current as any;

  it('assigns a unique increasing id to each toast', () => {
    const store = useToastStore();
    store.add({ message: 'a' });
    store.add({ message: 'b' });
    const firstId = cur()?.id as number;
    store.shift();
    const secondId = cur()?.id as number;
    expect(secondId).toBeGreaterThan(firstId);
  });

  it('queues FIFO and shift advances current', () => {
    const store = useToastStore();
    store.add({ message: 'first' });
    store.add({ message: 'second' });
    expect(cur()?.message).toBe('first');
    store.shift();
    expect(cur()?.message).toBe('second');
    // ids differ so the App-level :key forces a snackbar remount
    store.shift();
    expect(cur()).toBeUndefined();
  });

  it('applies default options', () => {
    const store = useToastStore();
    store.add({ message: 'x' });
    expect(cur()).toMatchObject({
      message: 'x',
      color: 'info',
      timeout: 3000,
      closable: true,
      multiLine: false,
      location: 'top center',
    });
  });
});
