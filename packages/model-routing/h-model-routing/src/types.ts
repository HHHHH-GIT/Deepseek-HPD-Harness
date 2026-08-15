/**
 * Client-safe vocabulary of the hierarchical-routing plan. This is the one
 * home of the `hModelRouting` projection key; it has no host service imports
 * so browser packages can depend on it without pulling in the routing plugin.
 * @module @deepseek-ai/dsh-h-model-routing/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one durable H-routing plan across all of its snapshots. */
export type HPlanId = Branded<'HPlanId'>

/** The durable lifecycle state of an H-routing plan. */
export type HPlanPhase =
  | 'planning'
  | 'executing'
  | 'summarizing'
  | 'completed'
  | 'failed'
  | 'interrupted'

/** The visible state of one sequential planner-produced subtask. */
export type HPlanSubtaskStatus = 'pending' | 'in_progress' | 'completed'

/** One ordered planner-produced subtask in the current plan snapshot. */
export interface HPlanSubtask {
  /** The planner's self-contained instruction for this item. */
  readonly text: string
  /** Its current sequential execution state. */
  readonly status: HPlanSubtaskStatus
}

/**
 * Whole current H-routing plan, reconstructed from the latest
 * `h-model-routing/state` event and the enclosing turn's terminal boundary.
 */
export interface HPlanProjection {
  /** Stable identity shared by every snapshot of this plan. */
  readonly planId: HPlanId
  /** The turn in which the plan was accepted. */
  readonly turn: number
  /** Original normalized user task that the plan decomposes. */
  readonly task: string
  /** Current H-routing lifecycle state. */
  readonly phase: HPlanPhase
  /** Planner order and per-item progress; empty while planning or failed. */
  readonly subtasks: readonly HPlanSubtask[]
  /** Stable human-readable planner failure detail, present only when failed. */
  readonly failure?: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Current durable hierarchical-routing plan, or null before planning and after a new task clears it. */
    hModelRouting: HPlanProjection | null
  }
}
