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

function state(phase: HPlanProjection['phase'], statuses: readonly HPlanProjection['subtasks'][number]['status'][] = []): HPlanProjection {
  return {
    planId: HPlanId('h-plan-invariant'),
    turn: 1,
    task: 'Refactor the project',
    phase,
    subtasks: statuses.map((status, index) => ({
      id: index + 1,
      title: `Task ${index + 1}`,
      instruction: `Complete task ${index + 1}.`,
      dependsOn: index === 0 ? [] : [index],
      status,
    })),
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
    expect(() => { ctx.emit('session/event', session, event(state('completed', ['completed', 'completed']), 4)) }).not.toThrow()
  })

  it('rejects a state stream that starts execution without planning', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('session/event', Session.create(SessionId('h-plan-direct-execution')), event(
        state('executing', ['in_progress', 'pending']),
      ))
    }).toThrow(/may begin only with planning/)
  })

  it('rejects a subtask that depends on itself or a later task', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('h-plan-invalid-order'))
    ctx.emit('session/event', session, event(state('planning'), 0))
    expect(() => {
      ctx.emit('session/event', session, event(
        { ...state('executing', ['in_progress', 'pending']), subtasks: [
          { id: 1, title: 'Task 1', instruction: 'Complete task 1.', dependsOn: [], status: 'in_progress' },
          { id: 2, title: 'Task 2', instruction: 'Complete task 2.', dependsOn: [2], status: 'pending' },
        ] },
        1,
      ))
    }).toThrow(/dependencies must name an earlier task id/)
  })

  it('rejects an illegal terminal-state transition', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('h-plan-terminal'))
    ctx.emit('session/event', session, event(state('planning'), 0))
    ctx.emit('session/event', session, event(state('failed'), 1))
    expect(() => { ctx.emit('session/event', session, event(state('planning'), 2)) })
      .toThrow(/terminal failed state must be cleared/)
  })

  it('allows a route after admission and rejects changing it', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('h-plan-route'))
    const admitted = state('executing', ['in_progress', 'pending'])
    const routed = {
      ...admitted,
      subtasks: admitted.subtasks.map((subtask, index) => index === 0 ? { ...subtask, route: 'light' as const } : subtask),
    }
    ctx.emit('session/event', session, event(state('planning'), 0))
    ctx.emit('session/event', session, event(admitted, 1))
    ctx.emit('session/event', session, event(routed, 2))
    expect(() => {
      ctx.emit('session/event', session, event({
        ...routed,
        subtasks: routed.subtasks.map((subtask, index) => index === 0 ? { ...subtask, route: 'expert' as const } : subtask),
      }, 3))
    }).toThrow(/changes or removes a selected subtask route/)
  })

  it('allows a behavior after admission and rejects changing it', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('h-plan-behavior'))
    const admitted = state('executing', ['in_progress', 'pending'])
    const selected = {
      ...admitted,
      subtasks: admitted.subtasks.map((subtask, index) => index === 0 ? { ...subtask, behavior: 'spec' as const } : subtask),
    }
    ctx.emit('session/event', session, event(state('planning'), 0))
    ctx.emit('session/event', session, event(admitted, 1))
    ctx.emit('session/event', session, event(selected, 2))
    expect(() => {
      ctx.emit('session/event', session, event({
        ...selected,
        subtasks: selected.subtasks.map((subtask, index) => index === 0 ? { ...subtask, behavior: 'react' as const } : subtask),
      }, 3))
    }).toThrow(/changes or removes a selected subtask behavior/)
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
    expect(() => {
      ctx.emit('session/event', Session.create(SessionId('h-plan-other')), {
        type: 'turn/start', seq: 0, time: 0, data: { turn: 1 },
      })
    }).not.toThrow()
  })
})
