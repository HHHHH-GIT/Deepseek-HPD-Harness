/**
 * Hierarchical model routing with a durable DAG plan and bounded parallel
 * subagent execution. The agent-loop driver stays unchanged: classification
 * is a standalone call, while planning and summary are visible root-agent
 * steps around the isolated worker lifecycle.
 * @module @deepseek-ai/dsh-h-model-routing
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { BlockAssembler, createUserMessage, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { SessionId, TodoItem, UserMessage } from '@deepseek-ai/dsh-session'
import type { SubagentRun, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-subagent'
import {
  CLASSIFY_SYSTEM,
  SUBTASK_ROUTING_SYSTEM,
  classifyPrompt,
  directPrompt,
  parseComplexity,
  parseSubtaskRouting,
  parseSubtasks,
  plannerPrompt,
  subtaskRoutingPrompt,
  subtaskPrompt,
  summaryPrompt,
} from './prompts.ts'
import type { HDependencyResult, HSubtaskRoutingDecision } from './prompts.ts'
import { HPlanId } from './domain.ts'
import { hModelRoutingProjectionDefinition } from './projection.ts'
import { createHState, resetHState } from './state.ts'
import type { HRouteKind, HState, HSubtask } from './state.ts'
import type { HPlanPhase, HPlanProjection, HPlanSubtaskBehavior, HPlanSubtaskStatus, HPlanTask } from './types.ts'

export { CLASSIFY_SYSTEM, SUBTASK_ROUTING_SYSTEM, classifyPrompt, directPrompt, parseComplexity, parseSubtaskRouting, parseSubtasks, plannerPrompt, subtaskRoutingPrompt, subtaskPrompt, summaryPrompt } from './prompts.ts'
export type { HDependencyResult, HSubtaskRoutingDecision, HSubtaskSummary } from './prompts.ts'
export { createHState, resetHState } from './state.ts'
export type { HState, HPhase, HRouteKind, HSubtask } from './state.ts'
export type * from './types.ts'
export type { HPlanState } from './domain.ts'

/** Cordis function-plugin name. */
export const name = 'h-model-routing'
/** Services required before the routing listeners may attach. */
export const inject = ['agents', 'llm', 'subagents']

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

/** The user-owned settings section of the hierarchical router. */
export interface HModelRoutingSettings {
  light: ModelRouteConfig
  expert: ModelRouteConfig
  /** auto = never force an effort; manual = apply each tier's configured effort. */
  reasoningEffortMode: 'auto' | 'manual'
}

/** Deployment-owned personas selected for admitted DAG nodes. */
export interface HBehaviorPersonas {
  /** Inspect-first work style for maintenance and diagnosis. */
  spec: string
  /** Produce-verify work style for independent implementation. */
  react: string
  /** Task-directed fallback when no stable style is clear. */
  weak: string
}

/** Optional behavior-routing controls for isolated DAG workers. */
export interface HBehaviorRoutingConfig {
  /** Whether level-2 routing also selects and applies a worker persona. */
  enabled: boolean
  /** Persona text selected by the level-2 work-style verdict. An empty value leaves that style unmodified. */
  personas: HBehaviorPersonas
}

/** Schemastery schema of the settings section. */
export const H_MODEL_ROUTING_SETTINGS_SCHEMA: z<HModelRoutingSettings> = z.object({
  light: z.object({ provider: z.string().required(), model: z.string().required(), reasoningEffort: z.string() }),
  expert: z.object({ provider: z.string().required(), model: z.string().required(), reasoningEffort: z.string() }),
  reasoningEffortMode: z.union(['auto', 'manual'] as const).default('auto'),
})

/** Deployment-owned routing and parallel-scheduling options. */
export interface Config {
  /** Whether H plan snapshots also write the legacy shared todo projection. */
  emitTodoMirror: boolean
  /** Maximum ready DAG nodes that may classify and run concurrently. */
  maxConcurrentSubtasks: number
  /** Registered one-shot subagent provider for isolated DAG workers. */
  subagentProvider: string
  /** Optional behavior-routing controls for isolated DAG workers. */
  behavior?: HBehaviorRoutingConfig
}

const DEFAULT_BEHAVIOR_PERSONAS: HBehaviorPersonas = {
  spec: 'You are a careful software engineer. Inspect the relevant existing artifacts and constraints before making changes. Verify the result against the task.',
  react: 'You are a hands-on software engineer. Work directly toward a usable result, then verify it. Do not add ceremony the assigned task does not need.',
  weak: 'You are a software engineer completing one focused task. Decide whether inspection or direct production is appropriate, then complete and verify the assigned work.',
}

const DEFAULT_BEHAVIOR_ROUTING: HBehaviorRoutingConfig = {
  enabled: true,
  personas: DEFAULT_BEHAVIOR_PERSONAS,
}

interface ResolvedConfig extends Omit<Config, 'behavior'> {
  behavior: HBehaviorRoutingConfig
}

export const Config = z.object({
  emitTodoMirror: z.boolean().default(false),
  maxConcurrentSubtasks: z.number().step(1).min(1).max(8).default(3),
  subagentProvider: z.string().default('spawn'),
  behavior: z.object({
    enabled: z.boolean().default(true),
    personas: z.object({
      spec: z.string().default(DEFAULT_BEHAVIOR_PERSONAS.spec),
      react: z.string().default(DEFAULT_BEHAVIOR_PERSONAS.react),
      weak: z.string().default(DEFAULT_BEHAVIOR_PERSONAS.weak),
    }),
  }).default(DEFAULT_BEHAVIOR_ROUTING),
})

const DEFAULT_CONFIG: ResolvedConfig = {
  emitTodoMirror: false,
  maxConcurrentSubtasks: 3,
  subagentProvider: 'spawn',
  behavior: DEFAULT_BEHAVIOR_ROUTING,
}
const PLUGIN = '@deepseek-ai/dsh-h-model-routing'
const CLASSIFY_MAX_TOKENS = 256

interface ResolvedRoute {
  provider: string
  model: string
  effort?: string
}

/** Resolve optional deployment controls once at plugin construction. */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    emitTodoMirror: config.emitTodoMirror,
    maxConcurrentSubtasks: config.maxConcurrentSubtasks,
    subagentProvider: config.subagentProvider,
    behavior: config.behavior ?? DEFAULT_BEHAVIOR_ROUTING,
  }
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function directiveMessage(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: PLUGIN, form: 'directive' } })
}

function verdictNotice(summary: string, detail: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text: detail }], source: { kind: 'plugin', plugin: PLUGIN, form: 'notice', summary } })
}

/** Map richer DAG outcomes to the legacy Todo vocabulary when the compatibility mirror is enabled. */
function todoStatus(status: HPlanSubtaskStatus): TodoItem['status'] {
  if (status === 'completed') return 'completed'
  if (status === 'in_progress') return 'in_progress'
  return 'pending'
}

function writeTodos(agent: Agent, plan: HPlanProjection): void {
  if (plan.subtasks.length === 0) return
  agent.session.append('todo/write', {
    todos: plan.subtasks.map(subtask => ({ content: `${subtask.id}. ${subtask.title}`, status: todoStatus(subtask.status) })),
  })
}

function currentPlan(state: HState): HPlanProjection {
  if (state.plan === undefined) throw new Error('h-model-routing active cycle has no durable plan snapshot')
  return state.plan
}

/** Build an immutable snapshot from the scheduler's mutable task ledger. */
function planSnapshot(state: HState, phase: Extract<HPlanPhase, 'executing' | 'summarizing' | 'completed'>): HPlanProjection {
  const plan = currentPlan(state)
  return {
    planId: plan.planId,
    turn: plan.turn,
    task: plan.task,
    phase,
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

function publishPlan(agent: Agent, state: HState, plan: HPlanProjection, emitTodoMirror: boolean): void {
  agent.session.append('h-model-routing/state', plan)
  state.plan = plan
  if (emitTodoMirror) writeTodos(agent, plan)
}

function taskText(message: UserMessage): string {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
}

function findUserMessage(messages: readonly UserMessage[]): UserMessage | undefined {
  return messages.find(message => message.source.kind === 'user')
}

function outputText(blocks: readonly ContentBlock[]): string {
  return blocks.filter(block => block.type === 'text').map(block => block.text).join('').trim()
}

function isTerminal(status: HPlanSubtaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'blocked'
}

/** Install the hierarchical router and its bounded DAG scheduler. */
export function apply(ctx: Context, config: Config = DEFAULT_CONFIG): void {
  const resolvedConfig = resolveConfig(config)
  const defaults = ctx.get('agentDefaultModel')?.currentSelection()
  const entry: HModelRoutingSettings = {
    light: { provider: defaults?.provider ?? '', model: defaults?.model ?? '', reasoningEffort: '' },
    expert: { provider: defaults?.provider ?? '', model: defaults?.model ?? '', reasoningEffort: '' },
    reasoningEffortMode: 'auto',
  }
  let source: () => HModelRoutingSettings = () => entry
  installSettingsSection(ctx, H_MODEL_ROUTING_SETTINGS_NAMESPACE, H_MODEL_ROUTING_SETTINGS_SCHEMA, entry, {
    setSource: (current) => { source = current },
    onChange: () => {},
  })

  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(hModelRoutingProjectionDefinition)
  })

  const states = new Map<Agent, HState>()
  const activeRuns = new Set<SubagentRun>()
  const lifetime = new AbortController()
  const effortCache = new Map<string, boolean>()
  const classifierEffortCache = new Map<string, string | undefined>()
  const settings = (): HModelRoutingSettings => source()

  function resolveRoute(kind: HRouteKind): ResolvedRoute | undefined {
    const binding = settings()[kind]
    if (binding.provider.trim() === '' || binding.model.trim() === '') return undefined
    const effort = settings().reasoningEffortMode === 'manual' && binding.reasoningEffort.trim() !== '' ? binding.reasoningEffort : undefined
    return { provider: binding.provider, model: binding.model, ...(effort === undefined ? {} : { effort }) }
  }

  async function validateEffort(route: ResolvedRoute, signal?: AbortSignal): Promise<string | undefined> {
    if (route.effort === undefined) return undefined
    const key = `${route.provider}/${route.model}/${route.effort}`
    let valid = effortCache.get(key)
    if (valid === undefined) {
      try {
        await ctx.llm.resolveCallConfig({
          provider: route.provider,
          model: route.model,
          reasoningEffort: ReasoningEffortId(route.effort),
        }, signal)
        valid = true
      } catch (error) {
        ctx.logger.warn(`h-model-routing: reasoning effort "${route.effort}" is invalid for ${route.provider}/${route.model}; omitting it: ${renderError(error)}`)
        valid = false
      }
      effortCache.set(key, valid)
    }
    return valid ? route.effort : undefined
  }

  async function classifierEffort(provider: string, model: string, signal?: AbortSignal): Promise<string | undefined> {
    const key = `${provider}/${model}`
    if (classifierEffortCache.has(key)) return classifierEffortCache.get(key)
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

  async function classify(kind: HRouteKind, task: string, sessionId: SessionId, signal: AbortSignal): Promise<'simple' | 'complex'> {
    const route = resolveRoute(kind)
    if (route === undefined) throw new Error('h-model-routing: no configured route for the complexity classifier')
    const assembler = new BlockAssembler()
    const effort = await classifierEffort(route.provider, route.model, signal)
    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({ content: [{ type: 'text', text: classifyPrompt(task) }], source: { kind: 'plugin', plugin: PLUGIN } })],
      system: CLASSIFY_SYSTEM,
      maxTokens: CLASSIFY_MAX_TOKENS,
      ...(effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) }),
      sessionId,
      signal,
    }
    for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)
    const verdict = assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join('')
    if (verdict.trim().length === 0) throw new Error('h-model-routing: classifier produced no verdict text')
    return parseComplexity(verdict)
  }

  /** Classify one DAG node's model tier and, when requested, its isolated worker persona. */
  async function classifySubtask(task: string, sessionId: SessionId, signal: AbortSignal): Promise<HSubtaskRoutingDecision> {
    const route = resolveRoute('light')
    if (route === undefined) throw new Error('h-model-routing: no configured route for the level-2 classifier')
    const assembler = new BlockAssembler()
    const effort = await classifierEffort(route.provider, route.model, signal)
    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({ content: [{ type: 'text', text: subtaskRoutingPrompt(task) }], source: { kind: 'plugin', plugin: PLUGIN } })],
      system: SUBTASK_ROUTING_SYSTEM,
      maxTokens: CLASSIFY_MAX_TOKENS,
      ...(effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) }),
      sessionId,
      signal,
    }
    for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)
    const verdict = assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join('')
    const decision = parseSubtaskRouting(verdict)
    if (decision === undefined) throw new Error('h-model-routing: level-2 classifier produced no valid routing verdict')
    return decision
  }

  function planningSnapshot(task: string, turn: number): HPlanProjection {
    return { planId: HPlanId(`h-plan-${randomUUID()}`), turn, task, phase: 'planning', subtasks: [] }
  }

  function dependencies(state: HState, subtask: HSubtask): HDependencyResult[] {
    return subtask.dependsOn.map((id) => {
      const dependency = state.subtasks[id - 1]
      if (dependency === undefined || dependency.status !== 'completed') throw new Error(`h-model-routing: task ${subtask.id} has unresolved dependency ${id}`)
      return { id: dependency.id, title: dependency.title, result: dependency.result ?? '(no result)' }
    })
  }

  function markBlocked(state: HState): void {
    let changed = true
    while (changed) {
      changed = false
      for (const subtask of state.subtasks) {
        if (subtask.status !== 'pending') continue
        if (subtask.dependsOn.some((id) => {
          const dependency = state.subtasks[id - 1]
          return dependency?.status === 'failed' || dependency?.status === 'blocked'
        })) {
          subtask.status = 'blocked'
          subtask.failure = 'A required dependency did not complete.'
          changed = true
        }
      }
    }
  }

  function readySubtasks(state: HState): HSubtask[] {
    return state.subtasks.filter(subtask => subtask.status === 'pending' && subtask.dependsOn.every(id => state.subtasks[id - 1]?.status === 'completed'))
  }

  function nodeFailure(result: SubagentResult): string {
    return result.stopReason === 'completed' ? '' : `The isolated worker ended with ${result.stopReason}.`
  }

  /** Resolve the selected scoped persona and reject providers that cannot apply it. */
  function subtaskPersona(behavior: HPlanSubtaskBehavior | undefined): string | undefined {
    if (behavior === undefined) return undefined
    const persona = resolvedConfig.behavior.personas[behavior].trim()
    if (persona.length === 0) return undefined
    const provider = ctx.subagents.getProvider(resolvedConfig.subagentProvider)
    if (provider !== undefined && !provider.capabilities.persona) {
      throw new Error(`h-model-routing: subagent provider "${resolvedConfig.subagentProvider}" does not support behavior personas`)
    }
    return persona
  }

  async function disposeRun(run: SubagentRun): Promise<void> {
    activeRuns.delete(run)
    await run.dispose()
  }

  async function drainRuns(runs: Iterable<SubagentRun>): Promise<void> {
    await Promise.allSettled([...runs].map(async run => disposeRun(run)))
  }

  async function runSubtask(agent: Agent, state: HState, signal: AbortSignal, subtask: HSubtask): Promise<void> {
    let run: SubagentRun | undefined
    try {
      let kind: HRouteKind
      try {
        const decision = resolvedConfig.behavior.enabled
          ? await classifySubtask(subtask.instruction, agent.session.id, signal)
          : { complexity: await classify('light', subtask.instruction, agent.session.id, signal) }
        kind = decision.complexity === 'complex' ? 'expert' : 'light'
        if (decision.behavior !== undefined) subtask.behavior = decision.behavior
      } catch (error) {
        if (signal.aborted) throw error
        ctx.logger.warn(`h-model-routing: level-2 assessment failed for task ${subtask.id}; routing to expert: ${renderError(error)}`)
        kind = 'expert'
      }
      signal.throwIfAborted()
      subtask.route = kind
      publishPlan(agent, state, planSnapshot(state, 'executing'), resolvedConfig.emitTodoMirror)
      const route = resolveRoute(kind)
      if (route === undefined) throw new Error(`h-model-routing: no configured ${kind} route for task ${subtask.id}`)
      const persona = subtaskPersona(subtask.behavior)
      run = await ctx.subagents.start(resolvedConfig.subagentProvider, {
        label: `${subtask.id}. ${subtask.title}`,
        parent: agent,
        prompt: [{ type: 'text', text: subtaskPrompt(state.task, subtask, dependencies(state, subtask)) }],
        signal,
        agentOptions: { provider: route.provider, model: route.model },
        ...(persona === undefined ? {} : { persona }),
      })
      activeRuns.add(run)
      subtask.sessionId = run.id
      publishPlan(agent, state, planSnapshot(state, 'executing'), resolvedConfig.emitTodoMirror)
      const result = await run.result
      signal.throwIfAborted()
      if (result.stopReason === 'completed') {
        subtask.status = 'completed'
        subtask.result = outputText(result.output)
      } else {
        subtask.status = 'failed'
        subtask.result = outputText(result.output)
        subtask.failure = nodeFailure(result)
        markBlocked(state)
      }
    } catch (error) {
      if (signal.aborted) throw error
      subtask.status = 'failed'
      subtask.failure = 'The isolated worker could not be started or completed.'
      markBlocked(state)
      ctx.logger.warn(`h-model-routing: task ${subtask.id} failed: ${renderError(error)}`)
    } finally {
      if (run !== undefined) await disposeRun(run)
    }
    signal.throwIfAborted()
    publishPlan(agent, state, planSnapshot(state, 'executing'), resolvedConfig.emitTodoMirror)
  }

  /** Schedule ready DAG nodes until every node reaches a terminal state. */
  async function executePlan(agent: Agent, state: HState, signal: AbortSignal): Promise<void> {
    const active = new Set<Promise<void>>()
    try {
      while (true) {
        signal.throwIfAborted()
        markBlocked(state)
        const capacity = resolvedConfig.maxConcurrentSubtasks - active.size
        const ready = capacity > 0 ? readySubtasks(state).slice(0, capacity) : []
        if (ready.length > 0) {
          for (const subtask of ready) subtask.status = 'in_progress'
          publishPlan(agent, state, planSnapshot(state, 'executing'), resolvedConfig.emitTodoMirror)
          for (const subtask of ready) {
            const worker = runSubtask(agent, state, signal, subtask).finally(() => { active.delete(worker) })
            active.add(worker)
          }
          continue
        }
        if (active.size > 0) {
          await Promise.race(active)
          continue
        }
        if (state.subtasks.every(subtask => isTerminal(subtask.status))) return
        throw new Error('h-model-routing: DAG scheduler found no ready or active task')
      }
    } finally {
      if (signal.aborted) await Promise.allSettled(active)
    }
  }

  async function onPreStep(
    agent: Agent,
    state: HState,
    turn: number,
    signal: AbortSignal,
    assembly: PromptAssembly,
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> {
    const operationSignal = AbortSignal.any([signal, lifetime.signal])
    const decision = await next()
    if (decision.kind !== 'enter') {
      resetHState(state)
      return decision
    }
    if (state.phase === 'summarizing') {
      return { ...decision, assembly: { ...(decision.assembly ?? assembly), tools: [] } }
    }
    const userMessage = findUserMessage(decision.messages)
    if (state.phase !== 'idle' && state.phase !== 'assessing') return decision
    if (userMessage === undefined) {
      resetHState(state)
      return decision
    }
    const task = taskText(userMessage)
    if (task.length === 0) {
      resetHState(state)
      return decision
    }
    state.phase = 'assessing'
    agent.session.append('h-model-routing/state', null)
    try {
      const verdict = await classify('expert', task, agent.session.id, operationSignal)
      operationSignal.throwIfAborted()
      if (verdict === 'simple') {
        state.phase = 'direct'
        state.route = 'light'
        return { kind: 'enter', messages: [...decision.messages, verdictNotice('Level-1 assessment: simple', 'Routed to the light model for a direct answer.')] }
      }
      state.phase = 'planning'
      state.route = 'expert'
      state.task = task
      const planning = planningSnapshot(task, turn)
      publishPlan(agent, state, planning, resolvedConfig.emitTodoMirror)
      return {
        kind: 'enter',
        messages: [
          ...decision.messages,
          verdictNotice('Level-1 assessment: complex', 'Routed to the expert model for visible DAG planning.'),
          directiveMessage(plannerPrompt(task)),
        ],
        assembly: { ...(decision.assembly ?? assembly), tools: [] },
      }
    } catch (error) {
      if (operationSignal.aborted) throw error
      resetHState(state)
      ctx.logger.warn(`h-model-routing: level-1 assessment failed for agent "${agent.id}": ${renderError(error)}`)
      return decision
    }
  }

  async function onRequest(state: HState, signal: AbortSignal, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig> {
    const request = await next()
    const kind = state.route
    if (kind === undefined) return request
    const route = resolveRoute(kind)
    if (route === undefined) return request
    const effort = await validateEffort(route, signal)
    const { reasoningEffort: _dropped, ...base } = request
    return {
      ...base,
      provider: route.provider,
      model: route.model,
      ...(effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) }),
    }
  }

  function plannerOutput(agent: Agent, state: HState): string {
    const turn = currentPlan(state).turn
    const event = agent.session.events.findLast(candidate =>
      candidate.type === 'assistant/message' && candidate.data.turn === turn)
    return event?.type === 'assistant/message' ? outputText(event.data.message.content) : ''
  }

  function failPlanner(agent: Agent, state: HState, failure: string): void {
    const plan = currentPlan(state)
    publishPlan(agent, state, { ...plan, phase: 'failed', failure }, resolvedConfig.emitTodoMirror)
    state.phase = 'direct'
    state.route = 'expert'
    agent.inject(verdictNotice('Planning failed', failure))
    agent.steer(directiveMessage(directPrompt(state.task)))
  }

  async function onTurnStopping(agent: Agent, state: HState, signal: AbortSignal): Promise<void> {
    switch (state.phase) {
      case 'planning': {
        const tasks: HPlanTask[] = parseSubtasks(plannerOutput(agent, state))
        if (tasks.length === 0) {
          failPlanner(agent, state, 'The planner did not produce a valid task DAG.')
          return
        }
        state.phase = 'subtasks'
        state.subtasks = tasks.map(subtask => ({ ...subtask, status: 'pending' }))
        const operationSignal = AbortSignal.any([signal, lifetime.signal])
        await executePlan(agent, state, operationSignal)
        operationSignal.throwIfAborted()
        state.phase = 'summarizing'
        state.route = 'expert'
        publishPlan(agent, state, planSnapshot(state, 'summarizing'), resolvedConfig.emitTodoMirror)
        agent.steer(directiveMessage(summaryPrompt(state.task, state.subtasks)))
        return
      }
      case 'summarizing':
        publishPlan(agent, state, planSnapshot(state, 'completed'), resolvedConfig.emitTodoMirror)
        resetHState(state)
        return
      case 'direct':
        resetHState(state)
        return
      case 'idle':
      case 'assessing':
      case 'subtasks':
        state.route = undefined
    }
  }

  ctx.on('agent/created', ({ agent }) => {
    if (states.has(agent) || !ctx.agents.roots().includes(agent) || agent.session.header.origin === 'subagent' || (agent.session.header.delegationDepth ?? 0) > 0) return
    const state = createHState()
    states.set(agent, state)
    agent.ctx.on('agent/pre-step', (payload, next) => onPreStep(agent, state, payload.turn, payload.signal, payload.assembly, next))
    agent.ctx.on('agent/request', (payload, next) => onRequest(state, payload.signal, next))
    agent.ctx.on('agent/request-error', async (_payload, next) => {
      const action = await next()
      if (state.phase === 'planning' && action?.kind !== 'retry') {
        failPlanner(agent, state, 'The planner request failed.')
      }
      return action
    })
    agent.ctx.on('agent/turn-stopping', ({ signal }) => onTurnStopping(agent, state, signal))
    agent.ctx.on('agent/status', ({ status }) => {
      if (status === 'idle') resetHState(state)
    })
  })
  ctx.on('agent/disposed', ({ agent }) => { states.delete(agent) })
  ctx.on('agent/error', ({ agent }) => {
    const state = states.get(agent)
    if (state === undefined || state.phase === 'direct') return
    if (state.phase === 'planning') {
      failPlanner(agent, state, 'The planner request failed.')
      return
    }
    resetHState(state)
  })
  ctx.effect(() => async () => {
    lifetime.abort(new Error('h-model-routing unloaded'))
    await drainRuns(activeRuns)
  }, 'h-model-routing: drain isolated DAG workers')
}
