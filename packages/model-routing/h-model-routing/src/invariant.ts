/** Package-owned durable H-routing plan invariants. @module @deepseek-ai/dsh-h-model-routing/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { applyHPlanEvent } from './domain.ts'
import type { HPlanState } from './domain.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-h-model-routing'

/** Apply a candidate log event and attribute malformed state or transitions to this package. */
function applyChecked(state: HPlanState, event: SessionEvent, fail: InvariantFailure): HPlanState {
  try {
    return applyHPlanEvent(state, event)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(`session event ${event.seq} violates the durable H-routing plan stream: ${message}`)
    return state
  }
}

/** Install an independent incremental fold over every attached session. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const states = new WeakMap<Session, HPlanState>()
  const staged = new WeakMap<SessionEvent, { session: Session; state: HPlanState }>()

  const seed = (session: Session): HPlanState => {
    let state: HPlanState = null
    for (const event of session.events) state = applyChecked(state, event, fail)
    states.set(session, state)
    return state
  }
  /* v8 ignore next -- session/event always follows list() or session/created seeding. */
  const stateFor = (session: Session): HPlanState => states.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    staged.set(event, { session, state: applyChecked(stateFor(session), event, fail) })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    const candidate = staged.get(event)
    /* v8 ignore next 2 -- internal/dispatch stages the exact callback arguments. */
    if (candidate === undefined || candidate.session !== session) {
      return fail('session/event reached publication without matching H-routing-plan validation')
    }
    staged.delete(event)
    states.set(session, candidate.state)
  }, { global: true })
}, { inject: ['sessions'] })

/** Cordis companion plugin name. */
export const name = 'h-model-routing-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Register the H-routing plan invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
