/**
 * Client-safe vocabulary of the hierarchical-routing plan. This is the one
 * home of the `hModelRouting` projection key; it has no host service imports
 * so browser packages can depend on it without pulling in the routing plugin.
 * @module @deepseek-ai/dsh-h-model-routing/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

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

/** The visible state of one planner-produced DAG node. */
export type HPlanSubtaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked'

/** Model tier selected by level-2 routing for one admitted DAG node. */
export type HPlanSubtaskRoute = 'light' | 'expert'

/** Work style selected with the model tier for one admitted DAG node. */
export type HPlanSubtaskBehavior = 'spec' | 'react' | 'weak'

/** One planner-produced task before the scheduler assigns its live status. */
export interface HPlanTask {
  /** Human-visible, one-based task number in the planner's topological order. */
  readonly id: number
  /** Concise human-visible label for list and graph navigation. */
  readonly title: string
  /** The planner's complete self-contained execution instruction. */
  readonly instruction: string
  /** Task numbers that must complete before this task may start. */
  readonly dependsOn: readonly number[]
}

/** One planner-produced DAG node in the current plan snapshot. */
export interface HPlanSubtask extends HPlanTask {
  /** The scheduler's current execution state. */
  readonly status: HPlanSubtaskStatus
  /** Selected tier after level-2 assessment; absent before routing. */
  readonly route?: HPlanSubtaskRoute
  /** Selected work style after level-2 assessment; absent when behavior routing is disabled or unavailable. */
  readonly behavior?: HPlanSubtaskBehavior
  /** Published one-shot child session after the provider accepts this node. */
  readonly sessionId?: SessionId
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

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete current H-routing plan snapshot, or null when a fresh task clears the prior plan. */
    'h-model-routing/state': HPlanProjection | null
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Current durable hierarchical-routing plan, or null before planning and after a new task clears it. */
    hModelRouting: HPlanProjection | null
  }
}
