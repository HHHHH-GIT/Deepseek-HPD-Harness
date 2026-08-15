/**
 * Process-local orchestration state for one exact agent. The current visible
 * plan is durable in `h-model-routing/state`; this state only retains results
 * and next-step routing decisions while the active turn is running.
 * @module @deepseek-ai/dsh-h-model-routing/state
 */

import type { HPlanProjection } from './types.ts'

/** Which stage of the hierarchical flow owns the next steps. */
export type HPhase = 'idle' | 'planning' | 'subtasks' | 'summarizing' | 'direct'

/** The model tier a routing decision selected. */
export type HRouteKind = 'light' | 'expert'

/** One planner-produced subtask with its collected execution result. */
export interface HSubtask {
  /** The subtask text, verbatim from the parsed plan. */
  text: string
  /** The subtask step's final assistant text, captured at its turn-stop boundary. */
  result?: string
}

/** Mutable per-agent routing state, owned exclusively by the plugin. */
export interface HState {
  phase: HPhase
  /** Tier selected for active direct, subtask, or summary work; tool continuations reuse it. */
  route: HRouteKind | undefined
  /** The original user task text that started the current cycle. */
  task: string
  /** Planner-produced subtasks; empty until a plan parses. */
  subtasks: HSubtask[]
  /** Index of the subtask the next step executes. */
  index: number
  /** Subtask whose level-2 verdict selected `route`; tool continuations reuse it. */
  classifiedSubtaskIndex: number | undefined
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
    index: 0,
    classifiedSubtaskIndex: undefined,
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
  state.index = 0
  state.classifiedSubtaskIndex = undefined
  state.plan = undefined
}
