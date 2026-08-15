/**
 * First-version hierarchical model routing: complexity-gated light/expert
 * routing implemented as an OUT-OF-LOOP policy over the agent loop's
 * extension points (\`agent/pre-step\`, \`agent/request\`,
 * \`agent/turn-stopping\`). The ReactLoopAgent driver is never touched;
 * classifiers and planner are independent model calls, while the accepted plan
 * and every progress transition are durable `h-model-routing/state` snapshots.
 * Process-local state only carries in-flight result text and next-step routing.
 * @module @deepseek-ai/dsh-h-model-routing
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { BlockAssembler, createUserMessage, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId, TodoItem, UserMessage } from '@deepseek-ai/dsh-session'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
// Type-only: merges ctx.get('agentDefaultModel') onto the Context service map.
import type {} from '@deepseek-ai/dsh-agent-default-model'
// Type-only: resolves ctx.sessionProjections for the optional projection unit.
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  CLASSIFY_SYSTEM,
  classifyPrompt,
  directPrompt,
  parseComplexity,
  parseSubtasks,
  plannerPrompt,
  subtaskPrompt,
  summaryPrompt,
} from './prompts.ts'
import { createHState, resetHState } from './state.ts'
import type { HState, HRouteKind } from './state.ts'
import { HPlanId } from './domain.ts'
import { hModelRoutingProjectionDefinition } from './projection.ts'
import type { HPlanPhase, HPlanProjection, HPlanSubtaskStatus } from './types.ts'

export { CLASSIFY_SYSTEM, classifyPrompt, directPrompt, parseComplexity, parseSubtasks, plannerPrompt, subtaskPrompt, summaryPrompt } from './prompts.ts'
export type { HSubtaskSummary } from './prompts.ts'
export { createHState, resetHState } from './state.ts'
export type { HState, HPhase, HRouteKind, HSubtask } from './state.ts'
export type * from './types.ts'
export type { HPlanState } from './domain.ts'

/** Cordis function-plugin name. */
export const name = 'h-model-routing'
/** Services required before the routing listeners may attach. */
export const inject = ['agents', 'llm']

/** Settings namespace carrying the user's light/expert configuration. */
export const H_MODEL_ROUTING_SETTINGS_NAMESPACE = settingsNamespace('h-model-routing')

/** One complete model binding: a single concrete model, never a pool. */
export interface ModelRouteConfig {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort id, honored only in manual mode. */
  reasoningEffort: string
}

/** The user-owned settings section of the first-version H routing. */
export interface HModelRoutingSettings {
  light: ModelRouteConfig
  expert: ModelRouteConfig
  /** auto = never force an effort; manual = apply each tier's configured effort. */
  reasoningEffortMode: 'auto' | 'manual'
}

/** Schemastery schema of the settings section. */
export const H_MODEL_ROUTING_SETTINGS_SCHEMA: z<HModelRoutingSettings> = z.object({
  light: z.object({
    provider: z.string().required(),
    model: z.string().required(),
    reasoningEffort: z.string(),
  }),
  expert: z.object({
    provider: z.string().required(),
    model: z.string().required(),
    reasoningEffort: z.string(),
  }),
  reasoningEffortMode: z.union(['auto', 'manual'] as const).default('auto'),
})

/** Deployment-owned routing presentation options. */
export interface Config {
  /** Whether H plan snapshots also write the legacy shared todo projection. */
  emitTodoMirror: boolean
}
export const Config: z<Config> = z.object({
  emitTodoMirror: z.boolean().default(false),
})

/** Plugin-owned message source: injected messages never look user-authored. */
const PLUGIN = '@deepseek-ai/dsh-h-model-routing'

/** Output budget for both classifier calls: enough for a brief thought plus the verdict. */
const CLASSIFY_MAX_TOKENS = 256

/** One tier binding resolved from the current settings section. */
interface ResolvedRoute {
  provider: string
  model: string
  /** Present only in manual mode with a configured effort. */
  effort?: string
}

/** Render an unknown thrown value for diagnostics. */
function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Wrap one orchestration instruction as a plugin-sourced user message tagged
 * with the `directive` context form: the conversation UI drops that form, so
 * the instruction reaches the model without surfacing as a chat row.
 */
function directiveMessage(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: PLUGIN, form: 'directive' },
  })
}

/**
 * Wrap one routing verdict as a collapsed one-line `notice` context row so the
 * level-1/level-2 assessment shows in the transcript like a thinking trace.
 */
function verdictNotice(summary: string, detail: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: detail }],
    source: { kind: 'plugin', plugin: PLUGIN, form: 'notice', summary },
  })
}

/** Mirror one H-routing snapshot to the legacy todo projection when enabled by composition. */
function writeTodos(agent: Agent, plan: HPlanProjection): void {
  if (plan.subtasks.length === 0) return
  const todos: TodoItem[] = plan.subtasks.map((subtask, index) => ({
    content: `${index + 1}. ${subtask.text}`,
    status: subtask.status,
  }))
  agent.session.append('todo/write', { todos })
}

/** Require the current runtime cycle to own a durable plan before moving its state forward. */
function currentPlan(state: HState): HPlanProjection {
  if (state.plan === undefined) throw new Error('h-model-routing active cycle has no durable plan snapshot')
  return state.plan
}

/** Build one complete execution-state snapshot from the runtime result ledger. */
function planSnapshot(state: HState, phase: Extract<HPlanPhase, 'executing' | 'summarizing' | 'completed'>): HPlanProjection {
  const plan = currentPlan(state)
  const status = (index: number): HPlanSubtaskStatus => {
    if (phase === 'executing') {
      if (index < state.index) return 'completed'
      return index === state.index ? 'in_progress' : 'pending'
    }
    return 'completed'
  }
  return {
    planId: plan.planId,
    turn: plan.turn,
    task: plan.task,
    phase,
    subtasks: state.subtasks.map((subtask, index) => ({ text: subtask.text, status: status(index) })),
  }
}

/** Commit a durable plan snapshot before the matching next-step instruction can enter the inbox. */
function publishPlan(agent: Agent, state: HState, plan: HPlanProjection, emitTodoMirror: boolean): void {
  agent.session.append('h-model-routing/state', plan)
  state.plan = plan
  if (emitTodoMirror) writeTodos(agent, plan)
}

/** Join the text blocks of one user message into the task text. */
function taskText(message: UserMessage): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/** The claimed batch's user-authored message, when one entered this step. */
function findUserMessage(messages: readonly UserMessage[]): UserMessage | undefined {
  return messages.find(message => message.source.kind === 'user')
}

/** The final assistant text of one turn, from its durable message events. */
function lastAssistantText(session: Session, turn: number): string {
  let text = ''
  for (const event of session.events) {
    if (event.type !== 'assistant/message' || event.data.turn !== turn) continue
    text = event.data.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
  }
  return text
}

/**
 * Install the first-version hierarchical routing policy.
 * @param ctx - host context owning the listeners and the settings section.
 */
export function apply(ctx: Context, config: Config = { emitTodoMirror: false }): void {

  // ---- settings section (same convention as agent-default-model) ----
  const defaults = ctx.get('agentDefaultModel')?.currentSelection()
  const entry: HModelRoutingSettings = {
    light: {
      provider: defaults?.provider ?? '',
      model: defaults?.model ?? '',
      reasoningEffort: '',
    },
    expert: {
      provider: defaults?.provider ?? '',
      model: defaults?.model ?? '',
      reasoningEffort: '',
    },
    reasoningEffortMode: 'auto',
  }
  let source: () => HModelRoutingSettings = () => entry
  installSettingsSection(
    ctx,
    H_MODEL_ROUTING_SETTINGS_NAMESPACE,
    H_MODEL_ROUTING_SETTINGS_SCHEMA,
    entry,
    {
      setSource: (current) => { source = current },
      onChange: () => {},
    },
  )

  // This child is optional so headless compositions without the projection
  // registry retain routing behavior while Web compositions receive snapshots.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(hModelRoutingProjectionDefinition)
  })

  // ---- process-local routing state ----
  const states = new Map<Agent, HState>()
  /** Manual-effort validation results, cached per (provider, model, effort). */
  const effortCache = new Map<string, boolean>()

  const settings = (): HModelRoutingSettings => source()

  /** Resolve one tier's binding; undefined while unconfigured. */
  function resolveRoute(kind: HRouteKind): ResolvedRoute | undefined {
    const current = settings()
    const binding = current[kind]
    if (binding.provider.trim() === '' || binding.model.trim() === '') return undefined
    const effort = current.reasoningEffortMode === 'manual' && binding.reasoningEffort.trim() !== ''
      ? binding.reasoningEffort
      : undefined
    return {
      provider: binding.provider,
      model: binding.model,
      ...(effort === undefined ? {} : { effort }),
    }
  }

  /**
   * Validate a manual effort against its exact model once per triple, so an
   * unsupported stored effort degrades to the model default instead of
   * failing the routed step with UNSUPPORTED_REASONING_EFFORT.
   */
  async function validateEffort(route: ResolvedRoute, signal?: AbortSignal): Promise<string | undefined> {
    const effort = route.effort
    if (effort === undefined) return undefined
    const key = `${route.provider}/${route.model}/${effort}`
    let valid = effortCache.get(key)
    if (valid === undefined) {
      try {
        await ctx.llm.resolveCallConfig({
          provider: route.provider,
          model: route.model,
          reasoningEffort: ReasoningEffortId(effort),
        }, signal)
        valid = true
      } catch (error) {
        ctx.logger.warn(
          `h-model-routing: reasoning effort "${effort}" is invalid for ${route.provider}/${route.model}; omitting it: ${renderError(error)}`,
        )
        valid = false
      }
      effortCache.set(key, valid)
    }
    return valid ? effort : undefined
  }

  /**
   * Resolve the reasoning effort the classifier should run with: a thinking
   * model would otherwise burn its output budget reasoning and never emit the
   * verdict word, silently collapsing every classification to SIMPLE. Request
   * `off` when the model advertises it, else omit (adapter default).
   */
  const classifierEffortCache = new Map<string, string | undefined>()
  async function classifierEffort(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const key = `${provider}/${model}`
    const cached = classifierEffortCache.get(key)
    if (cached !== undefined) return cached
    let resolved: string | undefined
    try {
      const info = await ctx.llm.resolveModelInfo(provider, model, signal)
      resolved = info.reasoning?.efforts.some(effort => effort.id === 'off') === true ? 'off' : undefined
    } catch {
      resolved = undefined
    }
    classifierEffortCache.set(key, resolved)
    return resolved
  }

  /** Run one complexity classifier call against the named tier. */
  async function classify(
    kind: HRouteKind,
    task: string,
    sessionId: SessionId,
    signal: AbortSignal,
  ): Promise<'simple' | 'complex'> {
    const route = resolveRoute(kind)
    if (route === undefined) throw new Error('h-model-routing: no configured route for the complexity classifier')
    const assembler = new BlockAssembler()
    const messages: GenerateOptions['messages'] = [createUserMessage({
      content: [{ type: 'text', text: classifyPrompt(task) }],
      source: { kind: 'plugin', plugin: PLUGIN },
    })]
    const effort = await classifierEffort(route.provider, route.model, signal)
    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages,
      system: CLASSIFY_SYSTEM,
      maxTokens: CLASSIFY_MAX_TOKENS,
      ...(effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) }),
      sessionId,
      signal,
    }
    for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)
    }
    const text = assembler.blocks()
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    if (text.trim().length === 0) {
      // No verdict word at all (e.g. the whole budget went to reasoning): the
      // assessment failed, so the caller falls back instead of fabricating a
      // SIMPLE verdict that would silently misroute real work to the light tier.
      throw new Error('h-model-routing: classifier produced no verdict text')
    }
    return parseComplexity(text)
  }

  /** Planner output that did not satisfy the required numbered multi-step list. */
  class PlannerOutputError extends Error {}

  /** Run the expert planner as an isolated no-tools LLM request. */
  async function plan(
    task: string,
    sessionId: SessionId,
    signal: AbortSignal,
  ): Promise<string[]> {
    const route = resolveRoute('expert')
    if (route === undefined) throw new Error('h-model-routing: no configured expert route for planning')
    const effort = await validateEffort(route, signal)
    const assembler = new BlockAssembler()
    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: plannerPrompt(task) }],
        source: { kind: 'plugin', plugin: PLUGIN },
      })],
      // Omitting `tools` keeps this raw LLM request independent of the agent's
      // assembled schemas, so planning cannot execute task tools.
      ...(effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) }),
      sessionId,
      signal,
    }
    for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
    signal.throwIfAborted()
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)
    }
    const subtasks = parseSubtasks(assembler.blocks()
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join(''))
    if (subtasks.length === 0) {
      throw new PlannerOutputError('h-model-routing: planner produced no valid numbered subtask list')
    }
    return subtasks
  }

  /** Stable failure detail shown in the H plan panel without exposing provider internals. */
  function plannerFailure(error: unknown): string {
    return error instanceof PlannerOutputError
      ? 'The planner did not produce a valid numbered subtask list.'
      : 'The planner request failed.'
  }

  /** Start a durable plan immediately after level-1 accepts the complex route. */
  function planningSnapshot(task: string, turn: number): HPlanProjection {
    return {
      planId: HPlanId(`h-plan-${randomUUID()}`),
      turn,
      task,
      phase: 'planning',
      subtasks: [],
    }
  }

  /** Classify one newly admitted H-plan item after its full snapshot is durable. */
  async function enterSubtask(
    agent: Agent,
    state: HState,
    signal: AbortSignal,
    decision: PreStepDecision & { kind: 'enter' },
    prefix: readonly UserMessage[] = [],
  ): Promise<PreStepDecision> {
    const subtask = state.subtasks[state.index]
    if (subtask === undefined) return decision
    if (state.classifiedSubtaskIndex === state.index) return decision
    try {
      signal.throwIfAborted()
      const verdict = await classify('light', subtask.text, agent.session.id, signal)
      signal.throwIfAborted()
      state.route = verdict === 'complex' ? 'expert' : 'light'
    } catch (error) {
      if (signal.aborted) throw error
      ctx.logger.warn(
        `h-model-routing: level-2 assessment failed for agent "${agent.id}"; routing the subtask to expert: ${renderError(error)}`,
      )
      state.route = 'expert'
    }
    state.classifiedSubtaskIndex = state.index
    const index = state.index
    const kind = state.route
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        ...prefix,
        verdictNotice(
          `Level-2 assessment: subtask ${index + 1} ${kind === 'expert' ? 'complex' : 'simple'}`,
          `Routed subtask ${index + 1} to the ${kind} model.`,
        ),
      ],
    }
  }

  /**
   * Decide the next step's tier at the step boundary. Assessments run after
   * the downstream waterfall so a rejected step spends no classifier call.
   */
  async function onPreStep(
    agent: Agent,
    state: HState,
    turn: number,
    signal: AbortSignal,
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> {
    const decision = await next()
    if (decision.kind !== 'enter') {
      resetHState(state)
      return decision
    }
    const userMessage = findUserMessage(decision.messages)
    // A fresh user-authored message always owns a fresh cycle, even when a
    // previous orchestration aborted mid-flight.
    if (userMessage !== undefined) resetHState(state)

    if (state.phase === 'idle') {
      if (userMessage === undefined) return decision
      const task = taskText(userMessage)
      if (task.length === 0) return decision
      // Clear a completed, failed, or interrupted plan before the new task's
      // level-1 call, so stale visible progress never belongs to a new request.
      agent.session.append('h-model-routing/state', null)
      try {
        signal.throwIfAborted()
        const verdict = await classify('expert', task, agent.session.id, signal)
        signal.throwIfAborted()
        if (verdict === 'complex') {
          state.phase = 'planning'
          state.route = 'expert'
          state.task = task
          const planning = planningSnapshot(task, turn)
          publishPlan(agent, state, planning, config.emitTodoMirror)
          try {
            const subtasks = await plan(task, agent.session.id, signal)
            signal.throwIfAborted()
            state.phase = 'subtasks'
            state.index = 0
            state.subtasks = subtasks.map(text => ({ text }))
            publishPlan(agent, state, planSnapshot(state, 'executing'), config.emitTodoMirror)
            const first = subtasks[0]
            /* v8 ignore next -- plan() rejects an empty parsed list. */
            if (first === undefined) throw new Error('h-model-routing parsed plan unexpectedly lacks its first subtask')
            return enterSubtask(agent, state, signal, decision, [
              verdictNotice('Level-1 assessment: complex', 'Routed to the expert model for planning.'),
              directiveMessage(subtaskPrompt(0, subtasks.length, first)),
            ])
          } catch (error) {
            if (signal.aborted) throw error
            const failure = plannerFailure(error)
            const failed: HPlanProjection = {
              planId: planning.planId,
              turn: planning.turn,
              task: planning.task,
              phase: 'failed',
              subtasks: [],
              failure,
            }
            publishPlan(agent, state, failed, config.emitTodoMirror)
            state.phase = 'direct'
            state.route = 'expert'
            return {
              kind: 'enter',
              messages: [
                ...decision.messages,
                verdictNotice('Level-1 assessment: complex', 'Routed to the expert model for planning.'),
                verdictNotice('Planning failed', failure),
                directiveMessage(directPrompt(task)),
              ],
            }
          }
        }
        state.route = 'light'
        return {
          kind: 'enter',
          messages: [
            ...decision.messages,
            verdictNotice('Level-1 assessment: simple', 'Routed to the light model for a direct answer.'),
          ],
        }
      } catch (error) {
        if (signal.aborted) throw error
        ctx.logger.warn(
          `h-model-routing: level-1 assessment failed for agent "${agent.id}"; falling back to default routing: ${renderError(error)}`,
        )
        return decision
      }
    }

    if (state.phase === 'subtasks') return enterSubtask(agent, state, signal, decision)
    if (state.phase === 'summarizing') {
      state.route = 'light'
      return decision
    }
    if (state.phase === 'direct') {
      state.route = 'expert'
      return decision
    }
    return decision
  }

  /** Apply the selected tier to the request config, overriding the route only. */
  async function onRequest(
    state: HState,
    signal: AbortSignal,
    next: () => Promise<LlmCallConfig>,
  ): Promise<LlmCallConfig> {
    const resolved = await next()
    const kind = state.route
    if (kind === undefined) return resolved
    const route = resolveRoute(kind)
    if (route === undefined) return resolved
    const effort = await validateEffort(route, signal)
    // The routed model owns the effort decision: auto mode (or a dropped
    // invalid effort) must not inherit an effort proposed for another model.
    const { reasoningEffort: _dropped, ...base } = resolved
    return {
      ...base,
      provider: route.provider,
      model: route.model,
      ...(effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) }),
    }
  }

  /** Advance the orchestration at the turn-stop boundary via steering. */
  async function onTurnStopping(agent: Agent, state: HState, turn: number): Promise<void> {
    switch (state.phase) {
      case 'idle':
      case 'planning': {
        state.route = undefined
        return
      }
      case 'subtasks': {
        const result = lastAssistantText(agent.session, turn)
        const current = state.subtasks[state.index]
        if (current !== undefined) current.result = result
        const nextIndex = state.index + 1
        const next = nextIndex < state.subtasks.length ? state.subtasks[nextIndex] : undefined
        if (next !== undefined) {
          state.index = nextIndex
          publishPlan(agent, state, planSnapshot(state, 'executing'), config.emitTodoMirror)
          agent.steer(directiveMessage(subtaskPrompt(nextIndex, state.subtasks.length, next.text)))
        } else {
          state.index = state.subtasks.length
          state.phase = 'summarizing'
          state.route = 'light'
          publishPlan(agent, state, planSnapshot(state, 'summarizing'), config.emitTodoMirror)
          agent.steer(directiveMessage(summaryPrompt(state.task, state.subtasks)))
        }
        return
      }
      case 'direct': {
        // A planner failure is terminal from the H plan's perspective. The
        // expert's direct answer is already the final answer, so do not invent
        // a single-item plan or add an extra summary step.
        resetHState(state)
        return
      }
      case 'summarizing': {
        publishPlan(agent, state, planSnapshot(state, 'completed'), config.emitTodoMirror)
        resetHState(state)
        return
      }
    }
  }

  // ---- wiring: root agents of this surface only, per-agent listeners ----
  ctx.on('agent/created', ({ agent }) => {
    if (states.has(agent)) return
    if (!ctx.agents.roots().includes(agent)) return
    if (agent.session.header.origin === 'subagent') return
    if ((agent.session.header.delegationDepth ?? 0) > 0) return
    const state = createHState()
    states.set(agent, state)
    agent.ctx.on('agent/pre-step', (payload, next) =>
      onPreStep(agent, state, payload.turn, payload.signal, next),
    )
    agent.ctx.on('agent/request', (payload, next) =>
      onRequest(state, payload.signal, next),
    )
    agent.ctx.on('agent/turn-stopping', payload =>
      onTurnStopping(agent, state, payload.turn),
    )
  })
  ctx.on('agent/disposed', ({ agent }) => { states.delete(agent) })
  ctx.on('agent/error', ({ agent }) => {
    const state = states.get(agent)
    if (state !== undefined) resetHState(state)
  })
}
