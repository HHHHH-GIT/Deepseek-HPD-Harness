/**
 * Host-side durable H-routing plan vocabulary, strict replay fold, and
 * transition validation. The log carries complete snapshots; this module only
 * derives `interrupted` from an unfinished plan's enclosing `turn/end`.
 * @module @deepseek-ai/dsh-h-model-routing/domain
 */

import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  HPlanId as HPlanIdType,
  HPlanPhase,
  HPlanProjection,
  HPlanSubtaskStatus,
} from './types.ts'

/** One complete durable state value carried by `h-model-routing/state`. */
export type HPlanState = HPlanProjection | null

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete current H-routing plan snapshot, or null when a fresh task clears the prior plan. */
    'h-model-routing/state': HPlanState
  }
}

const PHASES = [
  'planning',
  'executing',
  'summarizing',
  'completed',
  'failed',
  'interrupted',
] as const satisfies readonly HPlanPhase[]

const STATUSES = ['pending', 'in_progress', 'completed'] as const satisfies readonly HPlanSubtaskStatus[]

/**
 * Brand a generated plan id at the package's host-side construction point.
 * @param id - generated opaque identifier text.
 * @returns the branded plan identifier.
 */
export function HPlanId(id: string): HPlanIdType {
  return id as HPlanIdType
}

/** Require a persisted display string to be non-blank and already normalized. */
const normalizedString = zod.string().refine(
  value => value.trim().length > 0 && value === value.trim(),
  'must be a non-empty normalized string',
)

const subtaskSchema = zod.object({
  text: normalizedString,
  status: zod.enum(STATUSES),
}).strict()

const rawPlanSchema = zod.object({
  planId: normalizedString,
  turn: zod.number().int().positive(),
  task: normalizedString,
  phase: zod.enum(PHASES),
  subtasks: zod.array(subtaskSchema).max(8),
  failure: normalizedString.optional(),
}).strict()

/** Add the lifecycle-specific whole-snapshot rules that field schemas cannot express. */
function validateSnapshot(snapshot: zod.infer<typeof rawPlanSchema>, ctx: zod.RefinementCtx): void {
  const { phase, subtasks, failure } = snapshot
  const invalid = (message: string): void => {
    ctx.addIssue({ code: 'custom', message })
  }
  switch (phase) {
    case 'planning':
      if (subtasks.length !== 0) invalid('planning state must not contain subtasks')
      if (failure !== undefined) invalid('planning state must not contain failure detail')
      return
    case 'failed':
      if (subtasks.length !== 0) invalid('failed state must not contain subtasks')
      if (failure === undefined) invalid('failed state requires failure detail')
      return
    case 'executing':
      if (subtasks.length < 2) invalid('executing state requires 2 to 8 subtasks')
      if (failure !== undefined) invalid('executing state must not contain failure detail')
      validateExecutionOrder(subtasks, true, invalid)
      return
    case 'summarizing':
    case 'completed':
      if (subtasks.length < 2) invalid(`${phase} state requires 2 to 8 subtasks`)
      if (failure !== undefined) invalid(`${phase} state must not contain failure detail`)
      if (subtasks.some(subtask => subtask.status !== 'completed')) {
        invalid(`${phase} state requires every subtask to be completed`)
      }
      return
    case 'interrupted':
      if (failure !== undefined) invalid('interrupted state must not contain failure detail')
      if (subtasks.length !== 0 && subtasks.length < 2) {
        invalid('interrupted state contains either no subtasks or 2 to 8 subtasks')
      }
      validateExecutionOrder(subtasks, false, invalid)
      return
    default:
      phase satisfies never
  }
}

/** Validate ordered sequential statuses, optionally requiring an active item. */
function validateExecutionOrder(
  subtasks: readonly zod.infer<typeof subtaskSchema>[],
  requireActive: boolean,
  invalid: (message: string) => void,
): void {
  let stage = 0
  let active = 0
  for (const subtask of subtasks) {
    const next = subtask.status === 'completed' ? 0 : subtask.status === 'in_progress' ? 1 : 2
    if (next < stage) invalid('subtask statuses must stay in sequential completed, in_progress, pending order')
    stage = Math.max(stage, next)
    if (subtask.status === 'in_progress') active++
  }
  if (active > 1) invalid('plan may have at most one in-progress subtask')
  if (requireActive && active !== 1) invalid('executing state requires exactly one in-progress subtask')
}

/** Wire schema shared by the projection registry and strict replay decoder. */
export const hPlanStateSchema: ZodType<HPlanState> = zod.union([
  zod.null(),
  rawPlanSchema.superRefine(validateSnapshot),
]) as unknown as ZodType<HPlanState>

/**
 * Decode and validate one durable H-routing plan snapshot.
 * @param value - persisted event payload.
 * @returns the validated plan snapshot or clear tombstone.
 * @throws {Error} when the payload violates the persisted plan vocabulary.
 */
export function decodeHPlanState(value: unknown): HPlanState {
  const parsed = hPlanStateSchema.safeParse(value)
  if (parsed.success) return parsed.data
  throw new Error(`invalid h-model-routing state: ${parsed.error.issues[0]?.message ?? 'unknown validation failure'}`)
}

/** Whether this phase describes an unfinished plan that must stop at its turn boundary. */
function isLivePhase(phase: HPlanPhase): boolean {
  return phase === 'planning' || phase === 'executing' || phase === 'summarizing'
}

/** Assert that two snapshots name the same plan and immutable original task. */
function requireSamePlan(previous: HPlanProjection, next: HPlanProjection): void {
  if (previous.planId !== next.planId || previous.turn !== next.turn || previous.task !== next.task) {
    throw new Error('h-model-routing state transition changes plan identity, turn, or task')
  }
}

/** Assert planner text is stable once execution has started. */
function requireSameSubtasks(previous: HPlanProjection, next: HPlanProjection): void {
  if (previous.subtasks.length !== next.subtasks.length
    || previous.subtasks.some((subtask, index) => subtask.text !== next.subtasks[index]?.text)) {
    throw new Error('h-model-routing state transition changes planned subtask text or order')
  }
}

/** Numeric ordering of a subtask's only allowed forward states. */
function statusRank(status: HPlanSubtaskStatus): number {
  switch (status) {
    case 'pending': return 0
    case 'in_progress': return 1
    case 'completed': return 2
    default:
      status satisfies never
      return 0
  }
}

/** Reject progress snapshots that resurrect an already advanced subtask. */
function requireMonotonicProgress(previous: HPlanProjection, next: HPlanProjection): void {
  for (let index = 0; index < previous.subtasks.length; index++) {
    const before = previous.subtasks[index]
    const after = next.subtasks[index]
    /* v8 ignore next -- requireSameSubtasks establishes matching array lengths first. */
    if (before === undefined || after === undefined) throw new Error('plan subtask sequence unexpectedly changed')
    if (statusRank(after.status) < statusRank(before.status)) {
      throw new Error('h-model-routing state transition moves subtask progress backwards')
    }
  }
}

/** Validate the next whole snapshot against the preceding one. */
function validateTransition(previous: HPlanState, next: HPlanState): void {
  if (next === null) return
  if (previous === null) {
    if (next.phase !== 'planning') {
      throw new Error('h-model-routing state may begin only with planning')
    }
    return
  }
  requireSamePlan(previous, next)
  switch (previous.phase) {
    case 'planning':
      if (next.phase !== 'executing' && next.phase !== 'failed' && next.phase !== 'interrupted') {
        throw new Error(`h-model-routing planning cannot transition to ${next.phase}`)
      }
      return
    case 'executing':
      if (next.phase !== 'executing' && next.phase !== 'summarizing' && next.phase !== 'interrupted') {
        throw new Error(`h-model-routing executing cannot transition to ${next.phase}`)
      }
      requireSameSubtasks(previous, next)
      requireMonotonicProgress(previous, next)
      return
    case 'summarizing':
      if (next.phase !== 'completed' && next.phase !== 'interrupted') {
        throw new Error(`h-model-routing summarizing cannot transition to ${next.phase}`)
      }
      requireSameSubtasks(previous, next)
      return
    case 'completed':
    case 'failed':
    case 'interrupted':
      throw new Error(`h-model-routing terminal ${previous.phase} state must be cleared before another snapshot`)
    default:
      previous.phase satisfies never
  }
}

/** Copy a live plan into its terminal interrupted view without mutating the prior snapshot. */
function interrupted(state: HPlanProjection): HPlanProjection {
  return {
    planId: state.planId,
    turn: state.turn,
    task: state.task,
    phase: 'interrupted',
    subtasks: state.subtasks.map(subtask => ({ text: subtask.text, status: subtask.status })),
  }
}

/**
 * Apply one session event to an H-routing projection state. A normal snapshot
 * event carries the full replacement; an enclosing terminal boundary turns an
 * unfinished snapshot into `interrupted`, which prevents cold resume from
 * silently continuing work.
 * @param state - projection value before the event.
 * @param event - next durable session event.
 * @returns the projection value after the event.
 * @throws {Error} when a snapshot or state transition is invalid.
 */
export function applyHPlanEvent(state: HPlanState, event: SessionEvent): HPlanState {
  if (event.type === 'h-model-routing/state') {
    const next = decodeHPlanState(event.data)
    validateTransition(state, next)
    return next
  }
  if (event.type === 'turn/end' && event.data.reason.kind !== 'completed'
    && state !== null && isLivePhase(state.phase) && event.data.turn === state.turn) {
    return interrupted(state)
  }
  return state
}

/**
 * Fold a contiguous log prefix into its current durable H-routing plan.
 * @param events - ordered session-event prefix.
 * @returns the current plan snapshot or clear state.
 * @throws {Error} when the H-routing state stream is invalid.
 */
export function foldHPlan(events: readonly SessionEvent[]): HPlanState {
  let state: HPlanState = null
  for (const event of events) state = applyHPlanEvent(state, event)
  return state
}
