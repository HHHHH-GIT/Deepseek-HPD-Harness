import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { HPlanId } from '../src/domain.ts'
import * as HInvariant from '../src/invariant.ts'
import type { HPlanProjection } from '../src/types.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(context => context.fiber.dispose()))
})

async function setup(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(HInvariant)
  return ctx
}

function state(phase: HPlanProjection['phase'], statuses: readonly string[] = []): HPlanProjection {
  return {
    planId: HPlanId('h-plan-invariant'),
    turn: 1,
    task: 'Refactor the project',
    phase,
    subtasks: statuses.map((status, index) => ({ text: `Task ${index + 1}`, status })) as HPlanProjection['subtasks'],
    ...phase === 'failed' ? { failure: 'The planner request failed.' } : {},
  }
}

function event(data: unknown, seq = 0): SessionEvent {
  return { type: 'h-model-routing/state', seq, time: 0, data } as SessionEvent
}

describe('H-routing durable plan invariants', () => {
  it('accepts a complete planning, execution, summary, and completion stream', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('h-plan-valid'))
    ctx.emit('session/event', session, event(state('planning'), 0))
    ctx.emit('session/event', session, event(state('executing', ['in_progress', 'pending']), 1))
    ctx.emit('session/event', session, event(state('executing', ['completed', 'in_progress']), 2))
    ctx.emit('session/event', session, event(state('summarizing', ['completed', 'completed']), 3))
    expect(() => ctx.emit('session/event', session, event(state('completed', ['completed', 'completed']), 4))).not.toThrow()
  })

  it('rejects a state stream that starts execution without planning', async () => {
    const ctx = await setup()
    expect(() => ctx.emit('session/event', Session.create(SessionId('h-plan-direct-execution')), event(
      state('executing', ['in_progress', 'pending']),
    ))).toThrow(/may begin only with planning/)
  })

  it('rejects an invalid ordered subtask snapshot', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('h-plan-invalid-order'))
    ctx.emit('session/event', session, event(state('planning'), 0))
    expect(() => ctx.emit('session/event', session, event(
      state('executing', ['pending', 'in_progress']),
      1,
    ))).toThrow(/sequential completed, in_progress, pending order/)
  })

  it('rejects an illegal terminal-state transition', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('h-plan-terminal'))
    ctx.emit('session/event', session, event(state('planning'), 0))
    ctx.emit('session/event', session, event(state('failed'), 1))
    expect(() => ctx.emit('session/event', session, event(state('planning'), 2)))
      .toThrow(/terminal failed state must be cleared/)
  })

  it('rejects an invalid persisted snapshot during late registration', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('h-model-routing/state', state('executing', ['in_progress', 'pending']))
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(HInvariant).then(() => undefined)).rejects.toThrow(/may begin only with planning/)
  })

  it('ignores unrelated events', async () => {
    const ctx = await setup()
    expect(() => ctx.emit('session/event', Session.create(SessionId('h-plan-other')), {
      type: 'turn/start', seq: 0, time: 0, data: { turn: 1 },
    })).not.toThrow()
  })
})
