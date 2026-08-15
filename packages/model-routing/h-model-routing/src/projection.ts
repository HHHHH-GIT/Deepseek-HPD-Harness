/** H-routing session-projection unit. @module @deepseek-ai/dsh-h-model-routing/projection */

import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { applyHPlanEvent, hPlanStateSchema } from './domain.ts'
import type { HPlanState } from './domain.ts'

/** Whole current H-routing plan, driven over every committed session event. */
export const hModelRoutingProjectionDefinition: ProjectionDefinition<'hModelRouting', HPlanState> = {
  key: 'hModelRouting',
  schema: hPlanStateSchema,
  init: () => null,
  apply: applyHPlanEvent,
  view: state => state,
  stateVersion: 1,
}
