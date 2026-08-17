// Regression spec: CollabBindDialog once used `defineModel`, which the
// project's Vue 3.3 SFC compiler does not transform — at runtime the dialog
// never received the v-model and stayed invisible no matter what the parent
// did. These tests pin the classic modelValue/update:modelValue contract.
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/utils/toast', () => ({
  useToast: () => toastMock,
}));

const createGroupMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/v1', () => ({
  agentCollabApi: { createGroup: createGroupMock },
}));

import CollabBindDialog from './CollabBindDialog.vue';

const stubs = {
  'v-dialog': {
    props: { modelValue: { type: Boolean, default: false } },
    template: '<div v-if="modelValue"><slot /></div>',
  },
  'v-card': { template: '<div><slot /></div>' },
  'v-card-title': { template: '<div class="card-title"><slot /></div>' },
  'v-card-text': { template: '<div><slot /></div>' },
  'v-card-actions': { template: '<div><slot /></div>' },
  'v-text-field': {
    props: ['modelValue', 'label'],
    emits: ['update:modelValue'],
    template: '<div class="tf-stub">{{ label }}</div>',
  },
  'v-select': {
    props: ['modelValue', 'label'],
    emits: ['update:modelValue'],
    template: '<div class="select-stub">{{ label }}</div>',
  },
  'v-btn': {
    props: { disabled: { type: Boolean, default: false }, loading: { type: Boolean, default: false } },
    emits: ['click'],
    template:
      '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  'v-icon': { template: '<i><slot /></i>' },
  'v-spacer': { template: '<div class="v-spacer" />' },
};

const SESSIONS = [
  { session_id: 'sess-aaaaaaaa1', display_name: '会话A' },
  { session_id: 'sess-bbbbbbbb2', display_name: '会话B' },
];

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(CollabBindDialog, {
    props: {
      modelValue: true,
      sessions: SESSIONS,
      initialMembers: ['sess-aaaaaaaa1', 'sess-bbbbbbbb2'],
      ...props,
    },
    global: { stubs },
  });
}

function findButton(wrapper: ReturnType<typeof mountDialog>, text: string) {
  return wrapper.findAll('button').find((b) => b.text() === text);
}

describe('CollabBindDialog', () => {
  it('renders its content when modelValue is true', () => {
    const wrapper = mountDialog();
    expect(wrapper.find('.card-title').text()).toBe('绑定协作会话');
    // prefilled members are visible
    expect(wrapper.text()).toContain('会话A');
    expect(wrapper.text()).toContain('会话B');
  });

  it('renders nothing when modelValue is false', () => {
    const wrapper = mountDialog({ modelValue: false });
    expect(wrapper.find('.card-title').exists()).toBe(false);
  });

  it('emits update:modelValue false on cancel', async () => {
    const wrapper = mountDialog();
    const cancel = findButton(wrapper, '取消');
    expect(cancel).toBeTruthy();
    await cancel!.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
  });

  it('surfaces a toast error and stays open when validation fails', async () => {
    const wrapper = mountDialog();
    const save = findButton(wrapper, '保存');
    expect(save).toBeTruthy();
    await save!.trigger('click');
    // group name is empty by default → validation toast, dialog stays open
    expect(toastMock.error).toHaveBeenCalled();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(createGroupMock).not.toHaveBeenCalled();
  });
});
