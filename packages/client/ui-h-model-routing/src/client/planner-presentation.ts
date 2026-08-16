/** Conversation projection that marks the root Planner's text as secondary output. */
import type { AssistantPresentationData } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-h-model-routing/client'

interface PlannerPresentationState {
  readonly turn: number
}

const PLANNER_PRESENTATION: AssistantPresentationData = { collapsedTextSteps: [1] }

/** Durable planning snapshots identify the root turn whose first step is the Planner. */
export const plannerPresentationDefinition: ConversationNodeDefinition<PlannerPresentationState> = {
  kind: 'assistant-presentation',
  match: event => event.type === 'h-model-routing/state' && event.data?.phase === 'planning'
    ? { id: String(event.data.planId), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'h-model-routing/state' || match.event.data === null) {
      throw new Error('assistant-presentation requires a planning state event')
    }
    return { turn: match.event.data.turn }
  },
  update: context => context.state,
  buildLocationData: (context, scope) => {
    if (scope !== 'turn' || context.state === undefined) return null
    return {
      kind: 'turn',
      turn: context.state.turn,
      key: 'assistant-presentation',
      value: PLANNER_PRESENTATION,
    }
  },
}
