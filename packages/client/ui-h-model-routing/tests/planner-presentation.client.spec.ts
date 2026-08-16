import { describe, expect, it } from 'vitest'
import type { HPlanProjection } from '@deepseek-ai/dsh-h-model-routing/client'
import { plannerPresentationDefinition } from '../src/client/planner-presentation.ts'

describe('Planner presentation projection', () => {
  it('marks the first Assistant step of a durable planning turn as collapsed text', () => {
    const event = {
      type: 'h-model-routing/state',
      seq: 2,
      time: 2,
      data: {
        planId: 'plan-1' as HPlanProjection['planId'],
        turn: 4,
        task: 'Analyze the project',
        phase: 'planning',
        subtasks: [],
      },
    } as const
    const match = plannerPresentationDefinition.match(event)
    expect(match).toEqual({ id: 'plan-1', role: 'start' })
    const state = plannerPresentationDefinition.start(
      {} as never,
      { event, view: undefined, role: 'start', location: { kind: 'unresolved' } } as never,
      {} as never,
    )
    const locationData = plannerPresentationDefinition.buildLocationData?.({ state } as never, 'turn')
    expect(locationData?.key).toBe(plannerPresentationDefinition.kind)
    expect(locationData).toEqual({
      kind: 'turn',
      turn: 4,
      key: 'assistant-presentation',
      value: { collapsedTextSteps: [1] },
    })
  })

  it('ignores cleared and non-planning snapshots', () => {
    expect(plannerPresentationDefinition.match({ type: 'h-model-routing/state', data: null } as never)).toBeNull()
    expect(plannerPresentationDefinition.match({
      type: 'h-model-routing/state',
      data: { phase: 'executing' },
    } as never)).toBeNull()
  })
})
