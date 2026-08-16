// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HPlanProjection } from '@deepseek-ai/dsh-h-model-routing/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { HPlanDock, HPlanPanel } from '../src/client/HPlanPanel.tsx'
import { apply } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const t: Parameters<typeof HPlanPanel>[0]['t'] = makeTranslate(zh, commonZh)
const openSubtask = vi.fn()

function task(
  id: number,
  title: string,
  status: HPlanProjection['subtasks'][number]['status'],
  dependsOn: number[] = [],
): HPlanProjection['subtasks'][number] {
  const route = status === 'completed' || status === 'failed' ? 'expert' : status === 'in_progress' ? 'light' : undefined
  return { id, title, instruction: `完整执行指令：${title}`, dependsOn, status, ...(route === undefined ? {} : { route }) }
}

function makePlan(overrides: Partial<HPlanProjection> = {}): HPlanProjection {
  return {
    planId: 'plan-1' as HPlanProjection['planId'],
    turn: 4,
    task: '发布新的复杂任务计划面板',
    phase: 'executing',
    subtasks: [
      task(1, '生成执行计划', 'completed'),
      task(2, '执行第一个子任务', 'in_progress'),
      task(3, '汇总结果', 'pending', [1, 2]),
    ],
    ...overrides,
  }
}

const panel = () => screen.getByRole('button', { name: '收起复杂任务计划' })

describe('HPlanPanel', () => {
  it('renders nothing before the projection arrives or after its clear tombstone', () => {
    const loading = render(<HPlanPanel plan={undefined} openSubtask={openSubtask} t={t} />)
    expect(loading.container.firstChild).toBeNull()
    cleanup()
    const cleared = render(<HPlanPanel plan={null} openSubtask={openSubtask} t={t} />)
    expect(cleared.container.firstChild).toBeNull()
  })

  it('starts each new plan expanded and retains a manual collapse across progress updates', () => {
    const { rerender } = render(<HPlanPanel plan={makePlan()} openSubtask={openSubtask} t={t} />)
    fireEvent.click(panel())
    rerender(<HPlanPanel plan={makePlan({ subtasks: [
      task(1, '生成执行计划', 'completed'),
      task(2, '执行第一个子任务', 'completed'),
      task(3, '汇总结果', 'in_progress', [1, 2]),
    ] })} openSubtask={openSubtask} t={t} />)
    expect(screen.getByRole('button', { name: '展开复杂任务计划' })).toHaveProperty('ariaExpanded', 'false')
    rerender(<HPlanPanel plan={makePlan({ planId: 'plan-2' as HPlanProjection['planId'] })} openSubtask={openSubtask} t={t} />)
    expect(panel()).toHaveProperty('ariaExpanded', 'true')
  })

  it('collapses an interrupted plan and keeps it collapsed while the plan remains visible', () => {
    const interrupted = makePlan({ phase: 'interrupted' })
    const { rerender } = render(<HPlanPanel plan={interrupted} openSubtask={openSubtask} t={t} />)

    fireEvent.click(panel())
    expect(screen.queryByText('发布新的复杂任务计划面板')).toBeNull()
    expect(screen.getByRole('button', { name: '展开复杂任务计划' })).toHaveProperty('ariaExpanded', 'false')

    rerender(<HPlanPanel plan={{ ...interrupted }} openSubtask={openSubtask} t={t} />)
    expect(screen.queryByText('发布新的复杂任务计划面板')).toBeNull()
    expect(screen.getByRole('button', { name: '展开复杂任务计划' })).toHaveProperty('ariaExpanded', 'false')
  })

  it('defaults to the list and preserves a graph selection for plan updates', () => {
    const { rerender, container } = render(<HPlanPanel plan={makePlan()} openSubtask={openSubtask} t={t} />)
    expect(screen.getByText('执行第一个子任务')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '任务图模式' }))
    expect(screen.queryByText('执行第一个子任务')).toBeNull()
    expect(screen.queryByText('发布新的复杂任务计划面板')).toBeNull()
    expect(screen.getByRole('group', { name: '复杂任务任务图' })).toBeTruthy()
    expect(container.querySelectorAll('line')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '任务 3，状态：待处理，模型：待路由，策略：未选择策略，依赖：1, 2' }).getAttribute('aria-disabled')).toBe('true')

    rerender(<HPlanPanel plan={makePlan({ subtasks: [
      task(1, '生成执行计划', 'completed'),
      task(2, '执行第一个子任务', 'failed'),
      task(3, '汇总结果', 'blocked', [1, 2]),
    ] })} openSubtask={openSubtask} t={t} />)
    expect(screen.queryByText('执行第一个子任务')).toBeNull()
    expect(screen.getByRole('button', { name: '任务 2，状态：失败，模型：Expert，策略：未选择策略，依赖：无' })).toBeTruthy()

    rerender(<HPlanPanel plan={makePlan({ planId: 'plan-2' as HPlanProjection['planId'] })} openSubtask={openSubtask} t={t} />)
    expect(screen.getByText('执行第一个子任务')).toBeTruthy()
  })

  it('renders failed and blocked list states with aggregate progress', () => {
    render(<HPlanPanel plan={makePlan({ subtasks: [
      task(1, '生成执行计划', 'completed'),
      task(2, '执行第一个子任务', 'failed'),
      task(3, '汇总结果', 'blocked', [1, 2]),
    ] })} openSubtask={openSubtask} t={t} />)
    expect(screen.getByText('1/3 已完成')).toBeTruthy()
    expect(screen.getByText('失败')).toBeTruthy()
    expect(screen.getByText('已阻塞')).toBeTruthy()
    expect(screen.getAllByText('Expert')).toHaveLength(2)
    expect(screen.getByText('未调用')).toBeTruthy()
  })

  it('labels terminal nodes from older snapshots with no persisted route as unknown', () => {
    const { route: _route, ...legacyCompleted } = task(1, '旧任务', 'completed')
    render(<HPlanPanel plan={makePlan({ subtasks: [legacyCompleted, task(2, '后续任务', 'completed')] })} openSubtask={openSubtask} t={t} />)
    expect(screen.getByText('未知')).toBeTruthy()
  })

  it('renders a selected worker strategy in the list and task-graph tooltip', () => {
    render(<HPlanPanel plan={makePlan({ subtasks: [
      { ...task(1, '检查现有实现', 'in_progress'), behavior: 'spec' },
      task(2, '完成后续工作', 'pending', [1]),
    ] })} openSubtask={openSubtask} t={t} />)
    expect(screen.getByText('审查优先')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '任务图模式' }))
    const node = screen.getByRole('button', { name: '任务 1，状态：进行中，模型：Light，策略：审查优先，依赖：无' })
    fireEvent.focus(node)
    expect(screen.getByRole('tooltip').textContent).toBe('模型：Light；策略：审查优先')
  })

  it('opens a published subagent from its graph node and leaves pending nodes inert', () => {
    const child = 'child-2' as NonNullable<HPlanProjection['subtasks'][number]['sessionId']>
    render(<HPlanPanel plan={makePlan({ subtasks: [
      task(1, '生成执行计划', 'completed'),
      { ...task(2, '执行第一个子任务', 'in_progress'), sessionId: child },
      task(3, '汇总结果', 'pending', [1, 2]),
    ] })} openSubtask={openSubtask} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '任务图模式' }))

    const active = screen.getByRole('button', { name: '任务 2，状态：进行中，模型：Light，策略：未选择策略，依赖：无' })
    fireEvent.focus(active)
    expect(screen.getByRole('tooltip').textContent).toBe('模型：Light；策略：未选择策略')
    fireEvent.click(active)
    expect(openSubtask).toHaveBeenCalledWith(child)
    const pending = screen.getByRole('button', { name: '任务 3，状态：待处理，模型：待路由，策略：未选择策略，依赖：1, 2' })
    fireEvent.click(pending)
    expect(openSubtask).toHaveBeenCalledTimes(1)
  })

  it('keeps terminal plans visible until the next task clears the projection', () => {
    const { container, rerender } = render(<HPlanPanel plan={makePlan()} openSubtask={openSubtask} t={t} />)
    rerender(<HPlanPanel plan={makePlan({ phase: 'completed', subtasks: [
      task(1, '生成执行计划', 'completed'),
      task(2, '执行第一个子任务', 'failed'),
      task(3, '汇总结果', 'blocked', [1, 2]),
    ] })} openSubtask={openSubtask} t={t} />)
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0)
    rerender(<HPlanPanel plan={null} openSubtask={openSubtask} t={t} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('HPlanDock', () => {
  it('reads the hModelRouting projection and leaves absent or cleared values empty', () => {
    const useProjection = vi.fn(() => makePlan())
    const props = (read: () => HPlanProjection | null | undefined) =>
      ({ useProjection: read, openSubtask, t }) as unknown as Parameters<typeof HPlanDock>[0]
    const shown = render(<HPlanDock {...props(useProjection)} />)
    expect(useProjection).toHaveBeenCalledWith('hModelRouting')
    expect(shown.getByText('发布新的复杂任务计划面板')).toBeTruthy()
    cleanup()
    const cleared = render(<HPlanDock {...props(() => null)} />)
    expect(cleared.container.firstChild).toBeNull()
  })

  it('maps the session-scoped navigation action to openSubagent', () => {
    const open = vi.fn()
    let inject: ((parentSessionId: string) => { openSubtask(childSessionId: string): void }) | undefined
    const ctx = {
      get: () => ({ openSubagent: open }),
      effect: (install: () => unknown) => install(),
      locale: { register: () => () => {} },
      conversationEvents: { register: () => () => {} },
      slots: {
        inject: (_name: string, install: () => unknown) => install(),
        register: (descriptor: { inject?: typeof inject }) => {
          inject = descriptor.inject
          return () => {}
        },
      },
    } as unknown as Parameters<typeof apply>[0]
    apply(ctx)

    inject?.('parent-session').openSubtask('child-session')
    expect(open).toHaveBeenCalledWith({
      parentSessionId: 'parent-session',
      childSessionId: 'child-session',
      mode: 'one-shot',
    })
  })
})
