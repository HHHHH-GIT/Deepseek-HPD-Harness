/**
 * Durable H-routing DAG vocabulary, replay fold, and transition validation.
 * The log carries complete snapshots; this module derives `interrupted` only
 * when an unfinished plan's enclosing turn ends unsuccessfully.
 * @module @deepseek-ai/dsh-h-model-routing/domain
 */

import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { MAX_H_PLAN_SUBTASK_TITLE_LENGTH } from './constants.ts'
import type { HPlanId as HPlanIdType, HPlanPhase, HPlanProjection, HPlanSubtaskBehavior, HPlanSubtaskStatus } from './types.ts'

/** One complete durable state value carried by `h-model-routing/state`. */
export type HPlanState = HPlanProjection | null

const PHASES = ['planning', 'executing', 'summarizing', 'completed', 'failed', 'interrupted'] as const satisfies readonly HPlanPhase[]
const STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'blocked'] as const satisfies readonly HPlanSubtaskStatus[]
const ROUTES = ['light', 'expert'] as const
const BEHAVIORS = ['spec', 'react', 'weak'] as const satisfies readonly HPlanSubtaskBehavior[]

/**
 * Brand a generated plan id at the package's host-side construction point.
 * @param id - generated opaque identifier.
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
  id: zod.number().int().positive(),
  title: zod.string().max(MAX_H_PLAN_SUBTASK_TITLE_LENGTH).refine(
    value => value.trim().length > 0 && value === value.trim(),
    'must be a non-empty normalized title',
  ),
  instruction: normalizedString,
  dependsOn: zod.array(zod.number().int().positive()).max(7),
  status: zod.enum(STATUSES),
  route: zod.enum(ROUTES).optional(),
  behavior: zod.enum(BEHAVIORS).optional(),
  sessionId: normalizedString.optional(),
}).strict()

const rawPlanSchema = zod.object({
  planId: normalizedString,
  turn: zod.number().int().positive(),
  task: normalizedString,
  phase: zod.enum(PHASES),
  subtasks: zod.array(subtaskSchema).max(8),
  failure: normalizedString.optional(),
}).strict()

type SnapshotSubtask = zod.infer<typeof subtaskSchema>

/** Validate contiguous ids and topological dependency references. */
function validateDag(subtasks: readonly SnapshotSubtask[], invalid: (message: string) => void): void {
  for (let index = 0; index < subtasks.length; index++) {
    const subtask = subtasks[index]
    if (subtask === undefined) continue
    if (subtask.id !== index + 1) invalid('subtask ids must be contiguous and in topological order')
    const dependencies = new Set<number>()
    for (const dependency of subtask.dependsOn) {
      if (dependency >= subtask.id) invalid('subtask dependencies must name an earlier task id')
      if (dependencies.has(dependency)) invalid('subtask dependencies must not repeat an id')
      dependencies.add(dependency)
    }
  }
}

/** Whether a node no longer needs scheduler work. */
function isTerminal(status: HPlanSubtaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'blocked'
}

/** Add lifecycle-specific whole-snapshot rules that field schemas cannot express. */
function validateSnapshot(snapshot: zod.infer<typeof rawPlanSchema>, ctx: zod.RefinementCtx): void {
  const { phase, subtasks, failure } = snapshot
  const invalid = (message: string): void => { ctx.addIssue({ code: 'custom', message }) }
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
      validateDag(subtasks, invalid)
      return
    case 'summarizing':
    case 'completed':
      if (subtasks.length < 2) invalid(`${phase} state requires 2 to 8 subtasks`)
      if (failure !== undefined) invalid(`${phase} state must not contain failure detail`)
      validateDag(subtasks, invalid)
      if (subtasks.some(subtask => !isTerminal(subtask.status))) invalid(`${phase} state requires every subtask to be terminal`)
      return
    case 'interrupted':
      if (failure !== undefined) invalid('interrupted state must not contain failure detail')
      if (subtasks.length !== 0 && subtasks.length < 2) invalid('interrupted state contains either no subtasks or 2 to 8 subtasks')
      validateDag(subtasks, invalid)
      return
    default:
      phase satisfies never
  }
}

/** Wire schema shared by the projection registry and strict replay decoder. */
export const hPlanStateSchema: ZodType<HPlanState> = zod.union([
  zod.null(),
  rawPlanSchema.superRefine(validateSnapshot),
]) as unknown as ZodType<HPlanState>

/**
 * Decode and validate one durable H-routing plan snapshot.
 * @param value - untrusted persisted event payload.
 * @returns the validated plan snapshot or clear value.
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

/** Assert that planner DAG data is immutable once execution starts. */
function requireSameSubtasks(previous: HPlanProjection, next: HPlanProjection): void {
  if (previous.subtasks.length !== next.subtasks.length || previous.subtasks.some((subtask, index) => {
    const candidate = next.subtasks[index]
    return candidate === undefined || subtask.id !== candidate.id || subtask.title !== candidate.title
      || subtask.instruction !== candidate.instruction
      || subtask.dependsOn.length !== candidate.dependsOn.length
      || subtask.dependsOn.some((dependency, dependencyIndex) => dependency !== candidate.dependsOn[dependencyIndex])
  })) throw new Error('h-model-routing state transition changes planned subtask DAG')
}

/** Allow a child session id to appear once after provider publication and never change or disappear. */
function requireForwardSession(previous: HPlanProjection, next: HPlanProjection): void {
  for (let index = 0; index < previous.subtasks.length; index++) {
    const before = previous.subtasks[index]
    const after = next.subtasks[index]
    if (before === undefined || after === undefined) throw new Error('plan subtask sequence unexpectedly changed')
    if (before.sessionId !== undefined && before.sessionId !== after.sessionId) {
      throw new Error('h-model-routing state transition changes or removes a published child session id')
    }
    if (before.sessionId === undefined && after.sessionId !== undefined && before.status !== 'in_progress') {
      throw new Error('h-model-routing state transition publishes a child session before task admission')
    }
  }
}

/** Allow a selected tier to appear once after admission and never change or disappear. */
function requireForwardRoute(previous: HPlanProjection, next: HPlanProjection): void {
  for (let index = 0; index < previous.subtasks.length; index++) {
    const before = previous.subtasks[index]
    const after = next.subtasks[index]
    if (before === undefined || after === undefined) throw new Error('plan subtask sequence unexpectedly changed')
    if (before.route !== undefined && before.route !== after.route) {
      throw new Error('h-model-routing state transition changes or removes a selected subtask route')
    }
    if (before.route === undefined && after.route !== undefined && before.status !== 'in_progress') {
      throw new Error('h-model-routing state transition selects a subtask route before task admission')
    }
  }
}

/** Allow a selected work style to appear once after admission and never change or disappear. */
function requireForwardBehavior(previous: HPlanProjection, next: HPlanProjection): void {
  for (let index = 0; index < previous.subtasks.length; index++) {
    const before = previous.subtasks[index]
    const after = next.subtasks[index]
    if (before === undefined || after === undefined) throw new Error('plan subtask sequence unexpectedly changed')
    if (before.behavior !== undefined && before.behavior !== after.behavior) {
      throw new Error('h-model-routing state transition changes or removes a selected subtask behavior')
    }
    if (before.behavior === undefined && after.behavior !== undefined && before.status !== 'in_progress') {
      throw new Error('h-model-routing state transition selects a subtask behavior before task admission')
    }
  }
}

/** Assert the one-way state transition for a scheduler-owned node. */
function requireForwardStatus(before: HPlanSubtaskStatus, after: HPlanSubtaskStatus): void {
  if (before === after) return
  if (before === 'pending' && (after === 'in_progress' || after === 'blocked')) return
  if (before === 'in_progress' && (after === 'completed' || after === 'failed')) return
  throw new Error('h-model-routing state transition moves subtask progress backwards or across an invalid terminal state')
}

/** Reject progress snapshots that mutate scheduler-owned task state illegally. */
function requireMonotonicProgress(previous: HPlanProjection, next: HPlanProjection): void {
  for (let index = 0; index < previous.subtasks.length; index++) {
    const before = previous.subtasks[index]
    const after = next.subtasks[index]
    if (before === undefined || after === undefined) throw new Error('plan subtask sequence unexpectedly changed')
    requireForwardStatus(before.status, after.status)
  }
}

/** Validate the next whole snapshot against the preceding one. */
function validateTransition(previous: HPlanState, next: HPlanState): void {
  if (next === null) return
  if (previous === null) {
    if (next.phase !== 'planning') throw new Error('h-model-routing state may begin only with planning')
    return
  }
  requireSamePlan(previous, next)
  switch (previous.phase) {
    case 'planning':
      if (next.phase !== 'executing' && next.phase !== 'failed' && next.phase !== 'interrupted') throw new Error(`h-model-routing planning cannot transition to ${next.phase}`)
      return
    case 'executing':
      if (next.phase !== 'executing' && next.phase !== 'summarizing' && next.phase !== 'interrupted') throw new Error(`h-model-routing executing cannot transition to ${next.phase}`)
      requireSameSubtasks(previous, next)
      requireMonotonicProgress(previous, next)
      requireForwardRoute(previous, next)
      requireForwardBehavior(previous, next)
      requireForwardSession(previous, next)
      return
    case 'summarizing':
      if (next.phase !== 'completed' && next.phase !== 'interrupted') throw new Error(`h-model-routing summarizing cannot transition to ${next.phase}`)
      requireSameSubtasks(previous, next)
      requireForwardRoute(previous, next)
      requireForwardBehavior(previous, next)
      requireForwardSession(previous, next)
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
    subtasks: state.subtasks.map(subtask => ({
      id: subtask.id,
      title: subtask.title,
      instruction: subtask.instruction,
      dependsOn: [...subtask.dependsOn],
      status: subtask.status,
      ...(subtask.route === undefined ? {} : { route: subtask.route }),
      ...(subtask.behavior === undefined ? {} : { behavior: subtask.behavior }),
      ...(subtask.sessionId === undefined ? {} : { sessionId: subtask.sessionId }),
    })),
  }
}

/**
 * Apply one session event to an H-routing projection state.
 * @param state - projection state before the event.
 * @param event - next durable session event.
 * @returns projection state after the event.
 */
export function applyHPlanEvent(state: HPlanState, event: SessionEvent): HPlanState {
  if (event.type === 'h-model-routing/state') {
    const next = decodeHPlanState(event.data)
    validateTransition(state, next)
    return next
  }
  if (event.type === 'turn/end' && event.data.reason.kind !== 'completed'
    && state !== null && isLivePhase(state.phase) && event.data.turn === state.turn) return interrupted(state)
  return state
}

/**
 * Fold a contiguous log prefix into its current durable H-routing plan.
 * @param events - ordered session events to replay.
 * @returns the current plan projection after replay.
 */
export function foldHPlan(events: readonly SessionEvent[]): HPlanState {
  let state: HPlanState = null
  for (const event of events) state = applyHPlanEvent(state, event)
  return state
}
