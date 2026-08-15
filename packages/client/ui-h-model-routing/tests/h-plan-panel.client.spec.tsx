// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HPlanProjection } from '@deepseek-ai/dsh-h-model-routing/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { HPlanDock, HPlanPanel } from '../src/client/HPlanPanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: Parameters<typeof HPlanPanel>[0]['t'] = makeTranslate(zh, commonZh)

function makePlan(overrides: Partial<HPlanProjection> = {}): HPlanProjection {
  return {
    planId: 'plan-1' as HPlanProjection['planId'],
    turn: 4,
    task: '发布新的复杂任务计划面板',
    phase: 'executing',
    subtasks: [
      { text: '生成执行计划', status: 'completed' },
      { text: '执行第一个子任务', status: 'in_progress' },
      { text: '汇总结果', status: 'pending' },
    ],
    ...overrides,
  }
}

const panel = () => screen.getByRole('button', { name: '收起复杂任务计划' })

describe('HPlanPanel', () => {
  it('renders nothing before the projection arrives or after its clear tombstone', () => {
    const loading = render(<HPlanPanel plan={undefined} t={t} />)
    expect(loading.container.firstChild).toBeNull()
    cleanup()

    const cleared = render(<HPlanPanel plan={null} t={t} />)
    expect(cleared.container.firstChild).toBeNull()
  })

  it('starts each new plan expanded and retains a manual collapse across progress updates', () => {
    const first = makePlan()
    const { rerender } = render(<HPlanPanel plan={first} t={t} />)
    expect(panel()).toHaveProperty('ariaExpanded', 'true')
    expect(screen.getByText('执行第一个子任务')).toBeTruthy()

    fireEvent.click(panel())
    expect(screen.getByRole('button', { name: '展开复杂任务计划' })).toHaveProperty('ariaExpanded', 'false')
    expect(screen.queryByText('执行第一个子任务')).toBeNull()

    rerender(<HPlanPanel plan={makePlan({ subtasks: [
      { text: '生成执行计划', status: 'completed' },
      { text: '执行第一个子任务', status: 'completed' },
      { text: '汇总结果', status: 'in_progress' },
    ] })} t={t} />)
    expect(screen.getByRole('button', { name: '展开复杂任务计划' })).toHaveProperty('ariaExpanded', 'false')

    rerender(<HPlanPanel plan={makePlan({ planId: 'plan-2' as HPlanProjection['planId'] })} t={t} />)
    expect(panel()).toHaveProperty('ariaExpanded', 'true')
    expect(screen.getByText('执行第一个子任务')).toBeTruthy()
  })

  it('allows a manually collapsed plan to be expanded again', () => {
    render(<HPlanPanel plan={makePlan()} t={t} />)
    fireEvent.click(panel())
    fireEvent.click(screen.getByRole('button', { name: '展开复杂任务计划' }))
    expect(panel()).toHaveProperty('ariaExpanded', 'true')
  })

  it.each([
    ['completed', '已完成', { subtasks: [
      { text: '生成执行计划', status: 'completed' },
      { text: '执行第一个子任务', status: 'completed' },
      { text: '汇总结果', status: 'completed' },
    ] }],
    ['failed', '规划失败', { subtasks: [], failure: '规划器没有返回编号步骤' }],
    ['interrupted', '已中断', {}],
  ] as const)('keeps the %s terminal plan visible until the next task clears the projection', (phase, label, overrides) => {
    const { container, rerender } = render(<HPlanPanel plan={makePlan()} t={t} />)
    rerender(<HPlanPanel plan={makePlan({ phase, ...overrides })} t={t} />)
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    expect(screen.getByText('发布新的复杂任务计划面板')).toBeTruthy()

    rerender(<HPlanPanel plan={null} t={t} />)
    expect(container.firstChild).toBeNull()
  })

  it.each([
    ['planning', '正在规划', { subtasks: [] }],
    ['executing', '正在执行', {}],
    ['summarizing', '正在汇总', { subtasks: [
      { text: '生成执行计划', status: 'completed' },
      { text: '执行第一个子任务', status: 'completed' },
      { text: '汇总结果', status: 'completed' },
    ] }],
    ['completed', '已完成', { subtasks: [
      { text: '生成执行计划', status: 'completed' },
      { text: '执行第一个子任务', status: 'completed' },
      { text: '汇总结果', status: 'completed' },
    ] }],
    ['failed', '规划失败', { subtasks: [], failure: '规划器没有返回编号步骤' }],
    ['interrupted', '已中断', {}],
  ] as const)('renders the %s phase', (phase, label, overrides) => {
    render(<HPlanPanel plan={makePlan({ phase, ...overrides })} t={t} />)
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    if (phase === 'planning') expect(screen.getByText('正在生成按顺序执行的子任务…')).toBeTruthy()
    if (phase === 'summarizing') expect(screen.getByText('正在汇总执行结果…')).toBeTruthy()
    cleanup()
  })

  it('renders sequential subtask statuses and progress', () => {
    render(<HPlanPanel plan={makePlan()} t={t} />)
    expect(screen.getByText('1/3 已完成')).toBeTruthy()
    expect(screen.getByText('已完成')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getByText('待处理')).toBeTruthy()
  })

  it('announces the planner failure detail', () => {
    render(<HPlanPanel plan={makePlan({
      phase: 'failed',
      subtasks: [],
      failure: '规划器没有返回编号步骤',
    })} t={t} />)
    expect(screen.getByRole('alert').textContent).toBe('规划器没有返回编号步骤')
  })
})

describe('HPlanDock', () => {
  it('reads the hModelRouting projection and leaves absent or cleared values empty', () => {
    const useProjection = vi.fn(() => makePlan())
    const props = (read: () => HPlanProjection | null | undefined) =>
      ({ useProjection: read, t }) as unknown as Parameters<typeof HPlanDock>[0]
    const shown = render(<HPlanDock {...props(useProjection)} />)
    expect(useProjection).toHaveBeenCalledWith('hModelRouting')
    expect(shown.getByText('发布新的复杂任务计划面板')).toBeTruthy()
    cleanup()

    const cleared = render(<HPlanDock {...props(() => null)} />)
    expect(cleared.container.firstChild).toBeNull()
    cleanup()

    const absent = render(<HPlanDock {...props(() => undefined)} />)
    expect(absent.container.firstChild).toBeNull()
  })
})
