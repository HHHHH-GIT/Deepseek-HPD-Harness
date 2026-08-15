import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { HPlanId, foldHPlan } from '../src/domain.ts'
import * as HRouting from '../src/index.ts'
import type { HPlanProjection } from '../src/types.ts'

/** The minimal writable settings provider required by the routing plugin. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(context => context.fiber.dispose()))
})

async function harness(): Promise<{ ctx: Context; fiber: { dispose(): Promise<void> } }> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = await ctx.plugin(HRouting, { emitTodoMirror: false })
  return { ctx, fiber }
}

function planning(turn = 1): HPlanProjection {
  return {
    planId: HPlanId('h-plan-projection'),
    turn,
    task: 'Refactor the project',
    phase: 'planning',
    subtasks: [],
  }
}

describe('H-routing plan projection', () => {
  it('folds an unfinished plan into interrupted on a non-completed terminal turn and recovers it cold', async () => {
    const { ctx } = await harness()
    const session = ctx.sessions.create()
    const changes: Array<{ key: string; phase: string | undefined; seq: number }> = []
    ctx.sessionProjections.onChanged((_subject, key, value, seq) => {
      changes.push({ key, phase: (value as HPlanProjection | null)?.phase, seq })
    })
    session.append('turn/start', { turn: 1 })
    session.append('h-model-routing/state', planning())
    expect(ctx.sessionProjections.snapshot(session).values.hModelRouting).toMatchObject({ phase: 'planning' })
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(ctx.sessionProjections.snapshot(session).values.hModelRouting).toMatchObject({ phase: 'interrupted' })
    expect(changes.map(change => ({ key: change.key, phase: change.phase }))).toEqual([
      { key: 'hModelRouting', phase: 'planning' },
      { key: 'hModelRouting', phase: 'interrupted' },
    ])
    expect(foldHPlan(session.events)).toMatchObject({ phase: 'interrupted', task: 'Refactor the project' })

    const cold = await harness()
    const copy = cold.ctx.sessions.create()
    for (const event of session.events) copy.append(event.type, event.data)
    expect(cold.ctx.sessionProjections.snapshot(copy).values.hModelRouting).toMatchObject({ phase: 'interrupted' })
  })

  it('leaves a live plan unchanged when its matching turn completed without a terminal snapshot', async () => {
    const { ctx } = await harness()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('h-model-routing/state', planning())
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(ctx.sessionProjections.snapshot(session).values.hModelRouting).toMatchObject({ phase: 'planning' })
  })

  it('removes its projection key when the routing fiber unloads', async () => {
    const { ctx, fiber } = await harness()
    const session = ctx.sessions.create()
    expect(ctx.sessionProjections.snapshot(session).values.hModelRouting).toBeNull()
    await fiber.dispose()
    expect('hModelRouting' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})
