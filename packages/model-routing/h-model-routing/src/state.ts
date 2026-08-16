/**
 * Process-local orchestration state for one exact agent. The current visible
 * plan is durable in `h-model-routing/state`; this state only retains results
 * and next-step routing decisions while the active turn is running.
 * @module @deepseek-ai/dsh-h-model-routing/state
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type { HPlanProjection, HPlanSubtaskBehavior, HPlanSubtaskRoute, HPlanTask, HPlanSubtaskStatus } from './types.ts'

/** Which stage of the hierarchical flow owns the next steps. */
export type HPhase = 'idle' | 'assessing' | 'planning' | 'subtasks' | 'summarizing' | 'direct'

/** The model tier a routing decision selected. */
export type HRouteKind = HPlanSubtaskRoute

/** One planner-produced subtask with its collected execution result. */
export interface HSubtask extends HPlanTask {
  /** The scheduler-owned live state, mirrored into every durable snapshot. */
  status: HPlanSubtaskStatus
  /** Tier selected by level-2 routing before the child provider starts. */
  route?: HPlanSubtaskRoute
  /** Work style selected with the tier before the child provider starts. */
  behavior?: HPlanSubtaskBehavior
  /** Published child session id used by the task graph navigation. */
  sessionId?: SessionId
  /** The isolated child agent's final assistant text. */
  result?: string
  /** Stable failure summary captured when the child cannot complete. */
  failure?: string
}

/** Mutable per-agent routing state, owned exclusively by the plugin. */
export interface HState {
  phase: HPhase
  /** Tier selected for active direct, subtask, or summary work; tool continuations reuse it. */
  route: HRouteKind | undefined
  /** The original user task text that started the current cycle. */
  task: string
  /** Planner-produced DAG nodes; empty until a plan parses. */
  subtasks: HSubtask[]
  /** Latest durable plan snapshot while this process owns its active turn. */
  plan: HPlanProjection | undefined
}

/**
 * Mint a fresh idle state.
 * @returns mutable process-local state with no active plan.
 */
export function createHState(): HState {
  return {
    phase: 'idle',
    route: undefined,
    task: '',
    subtasks: [],
    plan: undefined,
  }
}

/**
 * Return one state to its idle shape after rejection, error, or a new cycle.
 * @param state - plugin-owned mutable state to clear.
 */
export function resetHState(state: HState): void {
  state.phase = 'idle'
  state.route = undefined
  state.task = ''
  state.subtasks = []
  state.plan = undefined
}
