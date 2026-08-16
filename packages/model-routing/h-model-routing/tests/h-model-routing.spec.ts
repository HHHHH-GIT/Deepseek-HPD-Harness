import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, {
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
  type SubagentResult,
  type SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { foldHPlan } from '../src/domain.ts'
import { parseSubtaskRouting, parseSubtasks } from '../src/prompts.ts'
import * as hRouting from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.doc)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

interface ScriptedCompletion {
  readonly text: string
  readonly reasoning?: string
}

function response(completion: ScriptedCompletion): StreamChunk[] {
  const reasoning: StreamChunk[] = completion.reasoning === undefined ? [] : [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: completion.reasoning },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: completion.reasoning } },
  ]
  const textIndex = reasoning.length === 0 ? 0 : 1
  return [
    ...reasoning,
    { type: 'block-start', index: textIndex, blockType: 'text' },
    { type: 'block-end', index: textIndex, block: { type: 'text', text: completion.text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

type ScriptedResponse = string | ScriptedCompletion | ((options: GenerateOptions) => Promise<string | ScriptedCompletion>)

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly responses: ScriptedResponse[]) { super() }
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const scripted = this.responses.shift()
    if (scripted === undefined) throw new Error('unexpected LLM request')
    const completion = typeof scripted === 'function' ? await scripted(options) : scripted
    yield* response(typeof completion === 'string' ? { text: completion } : completion)
  }
}

const capabilities: SubagentCapabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }

interface ControlledRun {
  readonly taskId: number
  readonly request: ResolvedSubagentStartRequest
  readonly resolve: (result: SubagentResult) => void
  disposed: boolean
}

/** A one-shot provider whose results are released by the test. */
class ControlledProvider implements SubagentProvider {
  readonly name = 'controlled'
  readonly capabilities = capabilities
  readonly inheritsParentContext = false
  readonly runs: ControlledRun[] = []

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const taskId = Number(/^(\d+)\./.exec(request.label ?? '')?.[1])
    const pending = Promise.withResolvers<SubagentResult>()
    const record: ControlledRun = { taskId, request, resolve: pending.resolve, disposed: false }
    this.runs.push(record)
    const abort = (): void => { pending.resolve({ output: [], stopReason: 'aborted' }) }
    request.signal.addEventListener('abort', abort, { once: true })
    return {
      id: SessionId(`controlled-${taskId}-${this.runs.length}`),
      localAgent: undefined,
      result: pending.promise,
      dispose: async () => { record.disposed = true },
    }
  }

  settle(taskId: number, stopReason: SubagentResult['stopReason'] = 'completed'): void {
    const run = this.runs.find(candidate => candidate.taskId === taskId)
    if (run === undefined) throw new Error(`task ${taskId} has not started`)
    run.resolve({ output: [{ type: 'text', text: `result ${taskId}` }], stopReason })
  }
}

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly adapter: ScriptedAdapter
  readonly provider: ControlledProvider
  readonly errors: unknown[]
}

const contexts: Context[] = []
afterEach(async () => { await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

async function harness(
  responses: ScriptedResponse[],
  maxConcurrentSubtasks = 3,
): Promise<Harness> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(SubagentRuntime)
  ctx.tools.register(defineContentToolFixture({
    name: 'routing_probe',
    description: 'Test whether normal routed requests retain tools.',
    parameters: {},
    execute: async () => [{ type: 'text', text: 'ok' }],
  }))
  const provider = new ControlledProvider()
  const errors: unknown[] = []
  ctx.on('agent/error', ({ error }) => { errors.push(error) })
  ctx.subagents.registerProvider(provider)
  await ctx.plugin(hRouting, {
    emitTodoMirror: false,
    maxConcurrentSubtasks,
    subagentProvider: provider.name,
  })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter(responses)
  ctx.llm.registerAdapter(['light', 'expert'], adapter)
  const agent = ctx.agentLoop.create(SessionId(`h-session-${Math.random()}`), { provider: 'light', model: 'light-1' })
  await ctx.settings.update(hRouting.H_MODEL_ROUTING_SETTINGS_NAMESPACE, {
    light: { provider: 'light', model: 'light-1', reasoningEffort: '' },
    expert: { provider: 'expert', model: 'expert-1', reasoningEffort: '' },
    reasoningEffortMode: 'auto',
  })
  return { ctx, agent, adapter, provider, errors }
}

function submit(agent: Agent, task: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: task }], source: { kind: 'user' } }))
}

async function waitForStarts(provider: ControlledProvider, count: number): Promise<void> {
  await vi.waitFor(() => { expect(provider.runs).toHaveLength(count) })
}

const threeRoots = JSON.stringify({ subtasks: [
  { id: 1, title: 'Inspect source files', instruction: 'Inspect the relevant source files.', dependsOn: [] },
  { id: 2, title: 'Inspect test failures', instruction: 'Inspect the relevant test failures.', dependsOn: [] },
  { id: 3, title: 'Inspect documentation', instruction: 'Inspect the relevant documentation.', dependsOn: [] },
  { id: 4, title: 'Combine findings', instruction: 'Combine all completed findings.', dependsOn: [1, 2, 3] },
] })

function node(id: number, title: string, dependsOn: number[] = []): object {
  return { id, title, instruction: `Complete ${title.toLowerCase()}.`, dependsOn }
}

describe('DAG planning and parallel execution', () => {
  it('retains normal tools for a SIMPLE Light request', async () => {
    const { agent, adapter } = await harness(['SIMPLE', 'LIGHT ANSWER'])
    submit(agent, 'Answer directly')
    await agent.whenIdle()

    expect(adapter.requests[1]?.provider).toBe('light')
    expect(adapter.requests[1]?.tools?.map(tool => tool.name)).toContain('routing_probe')
  })

  it('accepts only strict topologically ordered DAG JSON', () => {
    expect(parseSubtasks(threeRoots)).toHaveLength(4)
    expect(parseSubtasks(threeRoots.slice(0, -1))).toHaveLength(4)
    for (const invalid of [
      '{}',
      '{"subtasks":[{"id":1,"title":"a","instruction":"truncated',
      JSON.stringify({ subtasks: [node(1, 'a')] }),
      JSON.stringify({ subtasks: [node(1, 'a'), node(1, 'b')] }),
      JSON.stringify({ subtasks: [node(1, 'a', [1]), node(2, 'b')] }),
      JSON.stringify({ subtasks: [node(1, 'a'), node(2, 'b', [3]), node(3, 'c')] }),
      JSON.stringify({ subtasks: [node(2, 'a'), node(1, 'b')] }),
      JSON.stringify({ subtasks: [node(1, 'x'.repeat(49)), node(2, 'b')] }),
    ]) expect(parseSubtasks(invalid)).toEqual([])
  })

  it('accepts a strict level-2 tier and behavior verdict while retaining legacy tier-only replies', () => {
    expect(parseSubtaskRouting('{"complexity":"COMPLEX","behavior":"spec"}')).toEqual({ complexity: 'complex', behavior: 'spec' })
    expect(parseSubtaskRouting('SIMPLE')).toEqual({ complexity: 'simple' })
    expect(parseSubtaskRouting('{"complexity":"SIMPLE","behavior":"mixed"}')).toBeUndefined()
  })

  it('persists the selected behavior and scopes its persona to each isolated worker', async () => {
    const { agent, provider } = await harness([
      'COMPLEX', threeRoots,
      '{"complexity":"SIMPLE","behavior":"spec"}',
      '{"complexity":"COMPLEX","behavior":"react"}',
      '{"complexity":"SIMPLE","behavior":"weak"}',
      '{"complexity":"SIMPLE","behavior":"spec"}',
      'FINAL',
    ])
    submit(agent, 'Analyze the repository')
    await waitForStarts(provider, 3)

    expect(foldHPlan(agent.session.events)?.subtasks.map(subtask => ({ route: subtask.route, behavior: subtask.behavior }))).toEqual([
      { route: 'light', behavior: 'spec' },
      { route: 'expert', behavior: 'react' },
      { route: 'light', behavior: 'weak' },
      { route: undefined, behavior: undefined },
    ])
    expect(provider.runs.map(run => run.request.persona)).toEqual([
      expect.stringContaining('Inspect the relevant existing artifacts'),
      expect.stringContaining('Work directly toward a usable result'),
      expect.stringContaining('Decide whether inspection or direct production'),
    ])
    for (const run of provider.runs) provider.settle(run.taskId)
    await waitForStarts(provider, 4)
    provider.settle(4)
    await agent.whenIdle()
  })

  it('logs visible Planner reasoning, publishes node routes, and keeps Planner and summary on Expert', async () => {
    const { agent, adapter, provider } = await harness([
      'COMPLEX',
      { reasoning: 'Separate independent inspections before combining their results.', text: threeRoots },
      'SIMPLE', 'SIMPLE', 'SIMPLE', 'SIMPLE', 'FINAL',
    ])
    submit(agent, 'Analyze the repository')
    await waitForStarts(provider, 3)
    expect(provider.runs.map(run => run.taskId)).toEqual([1, 2, 3])
    expect(adapter.requests[1]?.tools ?? []).toEqual([])
    expect(foldHPlan(agent.session.events)?.subtasks.map(subtask => subtask.sessionId)).toEqual([
      'controlled-1-1', 'controlled-2-2', 'controlled-3-3', undefined,
    ])
    expect(foldHPlan(agent.session.events)?.subtasks.map(subtask => subtask.route)).toEqual([
      'light', 'light', 'light', undefined,
    ])
    const plannerMessageIndex = agent.session.events.findIndex(event => event.type === 'assistant/message')
    const reasoningIndex = agent.session.events.findIndex(event =>
      event.type === 'assistant/chunk' && event.data.chunk.type === 'reasoning-delta')
    const executingIndex = agent.session.events.findIndex(event => event.type === 'h-model-routing/state' && event.data?.phase === 'executing')
    expect(reasoningIndex).toBeGreaterThan(-1)
    expect(plannerMessageIndex).toBeGreaterThan(reasoningIndex)
    expect(executingIndex).toBeGreaterThan(plannerMessageIndex)
    const executing = agent.session.events[executingIndex]
    expect(executing?.type === 'h-model-routing/state' && executing.data !== null && executing.data.subtasks.map(task => task.status)).toEqual([
      'in_progress', 'in_progress', 'in_progress', 'pending',
    ])
    for (const run of provider.runs) provider.settle(run.taskId)
    await waitForStarts(provider, 4)
    provider.settle(4)
    await agent.whenIdle()
    expect(foldHPlan(agent.session.events)).toMatchObject({ phase: 'completed' })
    const plannerRequest = adapter.requests[1]
    const summaryRequest = adapter.requests.at(-1)
    expect(plannerRequest?.provider).toBe('expert')
    expect(summaryRequest?.provider).toBe('expert')
    expect(summaryRequest?.messages.slice(0, plannerRequest?.messages.length)).toEqual(plannerRequest?.messages)
    expect(summaryRequest?.tools ?? []).toEqual([])
  })

  it('does not start a dependent node before every predecessor settles', async () => {
    const { agent, provider, errors } = await harness(['COMPLEX', threeRoots, 'SIMPLE', 'SIMPLE', 'SIMPLE', 'SIMPLE', 'FINAL'])
    submit(agent, 'Analyze the repository')
    await waitForStarts(provider, 3)
    provider.settle(1)
    provider.settle(2)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(provider.runs).toHaveLength(3)
    provider.settle(3)
    await waitForStarts(provider, 4)
    expect(errors).toEqual([])
    expect(provider.runs[3]?.taskId).toBe(4)
    provider.settle(4)
    await agent.whenIdle()
  })

  it('continues independent work, recursively blocks dependents, and summarizes partial results', async () => {
    const dag = JSON.stringify({ subtasks: [
      node(1, 'Failing branch'),
      node(2, 'Independent branch'),
      node(3, 'Blocked descendant', [1]),
      node(4, 'Independent result', [2]),
    ] })
    const { agent, adapter, provider } = await harness(['COMPLEX', dag, 'SIMPLE', 'SIMPLE', 'SIMPLE', 'FINAL'])
    submit(agent, 'Run a DAG with failure')
    await waitForStarts(provider, 2)
    provider.settle(1, 'error')
    provider.settle(2)
    await waitForStarts(provider, 3)
    expect(provider.runs.map(run => run.taskId)).toEqual([1, 2, 4])
    provider.settle(4)
    await agent.whenIdle()
    expect(foldHPlan(agent.session.events)).toMatchObject({
      phase: 'completed',
      subtasks: [{ status: 'failed' }, { status: 'completed' }, { status: 'blocked' }, { status: 'completed' }],
    })
    expect(adapter.requests.at(-1)?.messages.flatMap(message => message.content).some(block => block.type === 'text' && block.text.includes('blocked'))).toBe(true)
  })

  it('records an invalid planner result as failed before the expert directly completes the task', async () => {
    const { agent, adapter, provider } = await harness(['COMPLEX', 'not JSON', 'DIRECT'])
    submit(agent, 'Complex task')
    await agent.whenIdle()
    expect(provider.runs).toHaveLength(0)
    expect(foldHPlan(agent.session.events)).toMatchObject({ phase: 'failed', failure: 'The planner did not produce a valid task DAG.' })
    expect(adapter.requests.at(-1)?.provider).toBe('expert')
  })

  it('records a Planner request failure before steering an Expert direct answer', async () => {
    const rejectPlanner = async (): Promise<string> => { throw new Error('planner transport failed') }
    const { agent, adapter, provider } = await harness(['COMPLEX', rejectPlanner, 'DIRECT'])
    submit(agent, 'Complex task with a failed Planner request')
    await agent.whenIdle()

    expect(provider.runs).toHaveLength(0)
    expect(foldHPlan(agent.session.events)).toMatchObject({ phase: 'failed', failure: 'The planner request failed.' })
    expect(adapter.requests.at(-1)?.provider).toBe('expert')
  })

  it('keeps planning active until the root Planner finishes without a plugin deadline', async () => {
    const planner = Promise.withResolvers<string>()
    const { agent, provider } = await harness(['COMPLEX', async () => await planner.promise, 'SIMPLE', 'SIMPLE', 'SIMPLE', 'SIMPLE', 'FINAL'])
    submit(agent, 'Complex task with deliberate planning')
    await vi.waitFor(() => { expect(foldHPlan(agent.session.events)).toMatchObject({ phase: 'planning' }) })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(provider.runs).toHaveLength(0)
    expect(foldHPlan(agent.session.events)).toMatchObject({ phase: 'planning' })

    planner.resolve(threeRoots)
    await waitForStarts(provider, 3)
    for (const run of provider.runs) provider.settle(run.taskId)
    await waitForStarts(provider, 4)
    provider.settle(4)
    await agent.whenIdle()
    expect(foldHPlan(agent.session.events)).toMatchObject({ phase: 'completed' })
  })

  it('cancels live workers, then routes the next user task as a fresh turn', async () => {
    const { agent, adapter, provider } = await harness([
      'COMPLEX', threeRoots, 'SIMPLE', 'SIMPLE', 'SIMPLE',
      'SIMPLE', 'SECOND ANSWER',
    ])
    submit(agent, 'Analyze the repository')
    await waitForStarts(provider, 3)
    const statesBeforeCancel = agent.session.events.filter(event => event.type === 'h-model-routing/state').length
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    expect(provider.runs.every(run => run.disposed)).toBe(true)
    expect(agent.session.events.filter(event => event.type === 'h-model-routing/state')).toHaveLength(statesBeforeCancel)
    expect(foldHPlan(agent.session.events)).toMatchObject({ phase: 'interrupted' })

    submit(agent, 'Answer the next question')
    await agent.whenIdle()
    expect(foldHPlan(agent.session.events)).toBeNull()
    expect(adapter.requests.at(-2)?.provider).toBe('expert')
    expect(adapter.requests.at(-1)?.provider).toBe('light')
    expect(adapter.requests.at(-1)?.messages.flatMap(message => message.content).some(block =>
      block.type === 'text' && block.text.includes('Answer the next question'),
    )).toBe(true)
  })
})
