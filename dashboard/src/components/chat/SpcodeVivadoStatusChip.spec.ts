// Author: elecvoid243, 2026-07-23
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'

import type { VivadoStatus } from '@/composables/useSpcodeVivadoStatus'

// Reusable mock factory
function mockStatuses(vivado: Partial<VivadoStatus>) {
  const defaults: VivadoStatus = {
    overall: 'disabled',
    enabled: false,
    mcpRunning: false,
    vivadoPath: '',
    installMissing: false,
    degraded: false,
    sessions: [],
    fetchedAt: null,
    message: '',
  }
  vi.doMock('@/composables/useSpcodeVivadoStatus', () => ({
    useSpcodeVivadoStatus: () => ({
      status: ref<VivadoStatus>({ ...defaults, ...vivado }),
      refresh: vi.fn(),
    }),
  }))
}

describe('SpcodeVivadoStatusChip (status badge, 5 states)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('renders success dot + meta for ok state with sessions', async () => {
    mockStatuses({
      overall: 'ok',
      enabled: true,
      mcpRunning: true,
      sessions: [
        { id: 'default', state: 'idle' },
        { id: 'build-1', state: 'busy' },
      ],
      message: 'Vivado 运行中 · 2 会话 (1 活跃)',
    })
    const { default: Cmp } = await import('./SpcodeVivadoStatusChip.vue')
    const wrapper = mount(Cmp, { global: { mocks: { $t: (k: string) => k } } })
    expect(wrapper.find('.sp-status-badge').exists()).toBe(true)
    expect(wrapper.find('.sp-status-badge__dot--success').exists()).toBe(true)
    expect(wrapper.text()).toContain('Vivado 已就绪')
    expect(wrapper.text()).toContain('2s')
    expect(wrapper.text()).toContain('1busy')
  })

  it('renders success dot without meta for ok state with 0 sessions', async () => {
    mockStatuses({
      overall: 'ok',
      enabled: true,
      mcpRunning: true,
      sessions: [],
      message: 'Vivado 运行中 · 0 会话',
    })
    const { default: Cmp } = await import('./SpcodeVivadoStatusChip.vue')
    const wrapper = mount(Cmp, { global: { mocks: { $t: (k: string) => k } } })
    expect(wrapper.find('.sp-status-badge__dot--success').exists()).toBe(true)
    expect(wrapper.text()).toContain('Vivado 已就绪')
    expect(wrapper.find('.sp-status-badge__meta').exists()).toBe(false)
  })

  it('renders warning dot + degraded label', async () => {
    mockStatuses({
      overall: 'degraded',
      enabled: true,
      mcpRunning: true,
      degraded: true,
      message: 'vivado 会话数据暂时不可用',
    })
    const { default: Cmp } = await import('./SpcodeVivadoStatusChip.vue')
    const wrapper = mount(Cmp, { global: { mocks: { $t: (k: string) => k } } })
    expect(wrapper.find('.sp-status-badge__dot--warning').exists()).toBe(true)
    expect(wrapper.text()).toContain('会话数据暂不可用')
    expect(wrapper.find('.sp-status-badge__dot--error').exists()).toBe(false)
  })

  it('renders neutral empty dot (NOT red) for not_running state', async () => {
    mockStatuses({
      overall: 'not_running',
      enabled: true,
      mcpRunning: false,
      message: 'vivado MCP 服务未运行（启动中或启动失败）',
    })
    const { default: Cmp } = await import('./SpcodeVivadoStatusChip.vue')
    const wrapper = mount(Cmp, { global: { mocks: { $t: (k: string) => k } } })
    expect(wrapper.find('.sp-status-badge--empty').exists()).toBe(true)
    expect(wrapper.find('.sp-status-badge__dot--neutral').exists()).toBe(true)
    expect(wrapper.find('.sp-status-badge__dot--error').exists()).toBe(false)
    expect(wrapper.text()).toContain('Vivado 未启动')
  })

  it('renders error dot for not_installed state', async () => {
    mockStatuses({
      overall: 'not_installed',
      enabled: true,
      installMissing: true,
      message: 'vivado-mcp 包未安装，请执行 pip install vivado-mcp',
    })
    const { default: Cmp } = await import('./SpcodeVivadoStatusChip.vue')
    const wrapper = mount(Cmp, { global: { mocks: { $t: (k: string) => k } } })
    expect(wrapper.find('.sp-status-badge__dot--error').exists()).toBe(true)
    expect(wrapper.text()).toContain('vivado-mcp 未安装')
  })

  it('renders neutral empty dot for disabled state', async () => {
    mockStatuses({
      overall: 'disabled',
      enabled: false,
      message: 'vivado-mcp 集成未启用',
    })
    const { default: Cmp } = await import('./SpcodeVivadoStatusChip.vue')
    const wrapper = mount(Cmp, { global: { mocks: { $t: (k: string) => k } } })
    expect(wrapper.find('.sp-status-badge--empty').exists()).toBe(true)
    expect(wrapper.find('.sp-status-badge__dot--neutral').exists()).toBe(true)
    expect(wrapper.find('.sp-status-badge__dot--error').exists()).toBe(false)
    expect(wrapper.text()).toContain('Vivado 未启用')
  })

  it('emits open-vivado-dialog on click', async () => {
    mockStatuses({
      overall: 'ok',
      enabled: true,
      mcpRunning: true,
      sessions: [],
      message: 'Vivado 运行中 · 0 会话',
    })
    const { default: Cmp } = await import('./SpcodeVivadoStatusChip.vue')
    const wrapper = mount(Cmp, { global: { mocks: { $t: (k: string) => k } } })
    await wrapper.find('.sp-status-badge').trigger('click')
    expect(wrapper.emitted('open-vivado-dialog')).toBeTruthy()
  })
})
