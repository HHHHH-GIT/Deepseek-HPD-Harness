import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { CallId, createUserMessage, LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { foldHPlan } from '../src/domain.ts'
import * as hRouting from '../src/index.ts'

type ScriptEntry = StreamChunk[] | Error | ((options: GenerateOptions) => StreamChunk[])

/** The smallest real settings provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** One adapter instance registered under every routed provider, scripted in order. */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    if (entry instanceof Error) throw entry
    const chunks = typeof entry === 'function' ? entry(options) : entry
    for (const chunk of chunks) yield chunk
  }
}

/** One response carrying only a reasoning block (no verdict text). */
function reasoningOnlyResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** An adapter that advertises reasoning efforts including `off`. */
class ReasoningAdapter extends ScriptedAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('off'), name: 'Off' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
        defaultEffort: ReasoningEffortId('high'),
      },
    })
  }
}

/** An adapter that pauses the raw planner call until its owning agent is cancelled. */
class PausingPlannerAdapter extends ScriptedAdapter {
  readonly plannerStarted = Promise.withResolvers<undefined>()

  constructor() {
    super([])
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length === 1) {
      yield* textResponse('COMPLEX')
      return
    }
    if (this.requests.length !== 2) throw new Error('PausingPlannerAdapter: unexpected request')
    this.plannerStarted.resolve(undefined)
    await new Promise<never>((_resolve, reject) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason)
        return
      }
      options.signal?.addEventListener('abort', () => { reject(options.signal?.reason) }, { once: true })
    })
  }
}

/** One successful text response. */
function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** A complete single-call tool request that causes the loop to admit another step. */
function toolCallResponse(): StreamChunk[] {
  const id = CallId('h-routing-tool-call')
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name: 'echo', argumentsDelta: '{"text":"value"}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'echo', arguments: '{"text":"value"}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** The classifier verdict chunk given the request's prompt content. */
function classifyResponse(verdict: string): ScriptEntry {
  return options => options.messages.some(message =>
    message.content.some(block => block.type === 'text' && block.text.includes('Complexity (reply')),
  )
    ? textResponse(verdict)
    : textResponse('fallback')
}

/** Join every text block of one request into a single string. */
function requestText(request: GenerateOptions): string {
  return request.messages
    .flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/** The source forms carried by one request's messages, in order. */
function requestForms(request: GenerateOptions): string[] {
  return request.messages
    .map(message => (message.source as { form?: unknown }).form)
    .filter((form): form is string => typeof form === 'string')
}

/** The one-line summaries of every notice-form context message in a request. */
function requestNotices(request: GenerateOptions): string[] {
  const summaries: string[] = []
  for (const message of request.messages) {
    const source = message.source as { form?: unknown; summary?: unknown }
    if (message.source.kind === 'plugin' && source.form === 'notice' && typeof source.summary === 'string') {
      summaries.push(source.summary)
    }
  }
  return summaries
}

interface Harness {
  readonly ctx: Context
  readonly adapter: ScriptedAdapter
  readonly agent: Agent
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(context => context.fiber.dispose()))
})

/**
 * Mount a real loop with the H plugin and one scripted adapter over both tiers.
 * @param script - the model response script.
 * @param adapterOverride - optional adapter instance (e.g. one advertising reasoning efforts).
 */
async function harness(
  script: ScriptEntry[],
  adapterOverride?: ScriptedAdapter,
  config: hRouting.Config = { emitTodoMirror: false },
): Promise<Harness> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(hRouting, config)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = adapterOverride ?? new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['light', 'expert'], adapter)
  const agent = ctx.agentLoop.create(SessionId(`h-session-${Math.random()}`), {
    provider: 'light',
    model: 'light-1',
  })
  // Bind the two tiers to the two registered routes; the plugin reads this
  // namespace live through installSettingsSection.
  await ctx.settings.update(hRouting.H_MODEL_ROUTING_SETTINGS_NAMESPACE, {
    light: { provider: 'light', model: 'light-1', reasoningEffort: '' },
    expert: { provider: 'expert', model: 'expert-1', reasoningEffort: '' },
    reasoningEffortMode: 'auto',
  })
  return { ctx, adapter, agent }
}

/** Submit one user task and wait for the whole orchestration to settle. */
async function submit(agent: Agent, task: string): Promise<void> {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: task }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
}

describe('h-model-routing first-version routing', () => {
  it('routes a SIMPLE task straight to the light model', async () => {
    const { adapter, agent } = await harness([
      classifyResponse('SIMPLE'),
      textResponse('ANSWER'),
    ])
    await submit(agent, 'What is 2+2?')
    expect(adapter.requests).toHaveLength(2)
    // Level-1 assessment runs on the expert tier with the classifier prompt.
    expect(adapter.requests[0]?.provider).toBe('expert')
    expect(adapter.requests[0]?.maxTokens).toBe(256)
    expect(requestText(adapter.requests[0]!)).toContain('What is 2+2?')
    // The answer step runs on the light tier with only the verdict notice
    // (no planning directive, no planner/direct/summary chain).
    expect(adapter.requests[1]?.provider).toBe('light')
    expect(requestText(adapter.requests[1]!)).not.toContain('Act as a planner')
    expect(requestNotices(adapter.requests[1]!)).toContain('Level-1 assessment: simple')
    expect(requestForms(adapter.requests[1]!)).toContain('notice')
    expect(requestForms(adapter.requests[1]!)).not.toContain('directive')
  })

  it('routes a COMPLEX task through planner, per-subtask assessment, and light summary', async () => {
    const { adapter, agent } = await harness([
      classifyResponse('COMPLEX'),
      () => textResponse('1. First subtask\n2. Second subtask'),
      classifyResponse('SIMPLE'),
      () => textResponse('Result A'),
      classifyResponse('COMPLEX'),
      () => textResponse('Result B'),
      () => textResponse('FINAL ANSWER'),
    ])
    await submit(agent, 'Refactor the whole project')
    expect(adapter.requests).toHaveLength(7)
    // 1: level-1 classifier. 2: isolated expert planner (never an Agent step).
    expect(adapter.requests[0]?.provider).toBe('expert')
    expect(adapter.requests[1]?.provider).toBe('expert')
    expect(requestText(adapter.requests[1]!)).toContain('Act as a planner')
    expect(requestText(adapter.requests[1]!)).toContain('Do not call todo_write')
    expect(adapter.requests[1]?.tools).toBeUndefined()
    expect(requestNotices(adapter.requests[1]!)).toEqual([])
    expect(requestForms(adapter.requests[1]!)).toEqual([])
    // 3: level-2 classifier (light) for subtask 1; 4: subtask 1 on light.
    expect(adapter.requests[2]?.provider).toBe('light')
    expect(requestText(adapter.requests[3]!)).toContain('Subtask 1/2')
    expect(requestText(adapter.requests[3]!)).toContain('Complete ONLY this subtask')
    expect(requestNotices(adapter.requests[3]!)).toContain('Level-2 assessment: subtask 1 simple')
    expect(adapter.requests[3]?.provider).toBe('light')
    // 5: level-2 classifier (light) for subtask 2; 6: subtask 2 on expert.
    expect(adapter.requests[4]?.provider).toBe('light')
    expect(requestText(adapter.requests[5]!)).toContain('Subtask 2/2')
    expect(requestNotices(adapter.requests[5]!)).toContain('Level-2 assessment: subtask 2 complex')
    expect(adapter.requests[5]?.provider).toBe('expert')
    // 7: summary on light; the turn's final assistant text is the summary.
    expect(adapter.requests[6]?.provider).toBe('light')
    expect(requestText(adapter.requests[6]!)).toContain('Subtask results')
    expect(requestText(adapter.requests[6]!)).toContain('Write ONLY the final answer')
    const last = [...agent.session.events].reverse()
      .find(event => event.type === 'assistant/message')
    expect(last?.type).toBe('assistant/message')
  })

  it('runs the classifier with reasoning off when the model advertises it', async () => {
    const adapter = new ReasoningAdapter([classifyResponse('SIMPLE'), () => textResponse('ANSWER')])
    const { agent } = await harness([], adapter)
    await submit(agent, 'What is 2+2?')
    expect(adapter.requests[0]?.reasoningEffort).toBe('off')
  })

  it('falls back to default routing when the classifier emits no verdict text', async () => {
    const { adapter, agent } = await harness([
      reasoningOnlyResponse('hmm, let me think about this...'),
      () => textResponse('ANSWER'),
    ])
    await submit(agent, 'Some question')
    // The truncated/reasoning-only classifier counts as a failed assessment:
    // the task runs unmodified with no verdict notice and no orchestration.
    expect(adapter.requests).toHaveLength(2)
    expect(requestText(adapter.requests[1]!)).toContain('Some question')
    expect(requestText(adapter.requests[1]!)).not.toContain('Level-1 assessment')
    expect(requestText(adapter.requests[1]!)).not.toContain('Act as a planner')
  })

  it('mirrors durable plan snapshots to the shared todo list only when explicitly enabled', async () => {
    const { agent } = await harness([
      classifyResponse('COMPLEX'),
      () => textResponse('1. First subtask\n2. Second subtask'),
      classifyResponse('SIMPLE'),
      () => textResponse('Result A'),
      classifyResponse('COMPLEX'),
      () => textResponse('Result B'),
      () => textResponse('FINAL ANSWER'),
    ], undefined, { emitTodoMirror: true })
    await submit(agent, 'Refactor the whole project')
    const writes = agent.session.events
      .filter(event => event.type === 'todo/write')
      .map(event => event.data.todos)
    // plan publish + per-subtask progress + final completed snapshot
    expect(writes.length).toBeGreaterThanOrEqual(3)
    expect(writes[0]).toEqual([
      { content: '1. First subtask', status: 'in_progress' },
      { content: '2. Second subtask', status: 'pending' },
    ])
    const last = writes[writes.length - 1]
    expect(last).toEqual([
      { content: '1. First subtask', status: 'completed' },
      { content: '2. Second subtask', status: 'completed' },
    ])
  })

  it('publishes the planning and executing snapshots before the first subtask model request', async () => {
    const { adapter, agent } = await harness([
      classifyResponse('COMPLEX'),
      () => textResponse('1. First subtask\n2. Second subtask'),
      classifyResponse('SIMPLE'),
      () => textResponse('Result A'),
      classifyResponse('SIMPLE'),
      () => textResponse('Result B'),
      () => textResponse('FINAL ANSWER'),
    ])
    await submit(agent, 'Refactor the whole project')
    const snapshots = agent.session.events
      .filter(event => event.type === 'h-model-routing/state')
      .map(event => ({ seq: event.seq, state: event.data }))
    const planning = snapshots.find(snapshot => snapshot.state?.phase === 'planning')
    const executing = snapshots.find(snapshot => snapshot.state?.phase === 'executing')
    const firstStep = agent.session.events.find(event => event.type === 'step/start')
    expect(planning?.state).toMatchObject({ task: 'Refactor the whole project', phase: 'planning', subtasks: [] })
    expect(executing?.state).toMatchObject({
      phase: 'executing',
      subtasks: [
        { text: 'First subtask', status: 'in_progress' },
        { text: 'Second subtask', status: 'pending' },
      ],
    })
    expect(executing?.seq).toBeLessThan(firstStep?.seq ?? Number.POSITIVE_INFINITY)
    expect(adapter.requests[1]?.tools).toBeUndefined()
    expect(requestText(adapter.requests[3]!)).toContain('Subtask 1/2')
    const secondActive = snapshots.find(snapshot => snapshot.state?.phase === 'executing'
      && snapshot.state.subtasks[1]?.status === 'in_progress')
    const secondSteer = agent.session.events.find(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.content.some(block =>
        block.type === 'text' && block.text.includes('Subtask 2/2'),
      )))
    expect(secondActive?.seq).toBeLessThan(secondSteer?.seq ?? Number.POSITIVE_INFINITY)
  })

  it('runs each subtask assessment once when tools require additional execution steps', async () => {
    const { adapter, agent, ctx } = await harness([
      classifyResponse('COMPLEX'),
      () => textResponse('1. Inspect the value\n2. Report the result'),
      classifyResponse('SIMPLE'),
      toolCallResponse(),
      textResponse('Inspected value'),
      classifyResponse('SIMPLE'),
      textResponse('Reported result'),
      textResponse('FINAL ANSWER'),
    ])
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'Return the supplied text.',
      parameters: { text: { type: 'string' } },
      async execute(args) {
        return [{ type: 'text', text: args.text ?? '' }]
      },
    }))

    await submit(agent, 'Inspect a value and report it')

    const classifiers = adapter.requests.filter(request => request.maxTokens === 256)
    expect(classifiers).toHaveLength(3)
    expect(adapter.requests.map(request => request.provider)).toEqual([
      'expert', 'expert', 'light', 'light', 'light', 'light', 'light', 'light',
    ])
  })

  it('falls back to default routing when the level-1 assessment fails', async () => {
    const { adapter, agent } = await harness([
      new Error('classifier down'),
      textResponse('ANSWER'),
    ])
    await submit(agent, 'What is 2+2?')
    // The failed assessment is the only extra request; the task itself runs
    // unmodified on the agent's declared route.
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[1]?.provider).toBe('light')
    expect(requestText(adapter.requests[1]!)).toContain('What is 2+2?')
    expect(requestText(adapter.requests[1]!)).not.toContain('Act as a planner')
  })

  it('treats an unrecognized verdict as simple (a chatty classifier never fans out)', async () => {
    const { adapter, agent } = await harness([
      classifyResponse('MAYBE'),
      () => textResponse('ANSWER'),
    ])
    await submit(agent, 'Task')
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[1]?.provider).toBe('light')
    expect(requestText(adapter.requests[1]!)).not.toContain('Act as a planner')
  })

  it('records planner failure then completes the original task directly without a summary', async () => {
    const { adapter, agent } = await harness([
      classifyResponse('COMPLEX'),
      () => textResponse('no numbered list here'),
      () => textResponse('DIRECT ANSWER'),
    ])
    await submit(agent, 'Complex task')
    expect(adapter.requests).toHaveLength(3)
    expect(adapter.requests[2]?.provider).toBe('expert')
    expect(requestText(adapter.requests[2]!)).toContain('Complete the following task directly')
    expect(requestText(adapter.requests[2]!)).not.toContain('Subtask results')
    const lastState = [...agent.session.events].reverse()
      .find(event => event.type === 'h-model-routing/state')
    expect(lastState?.type === 'h-model-routing/state' && lastState.data).toMatchObject({
      phase: 'failed',
      task: 'Complex task',
      failure: 'The planner did not produce a valid numbered subtask list.',
    })
  })

  it('records a planner transport failure before the expert directly completes the task', async () => {
    const { adapter, agent } = await harness([
      classifyResponse('COMPLEX'),
      new Error('planner unavailable'),
      () => textResponse('DIRECT ANSWER'),
    ])
    await submit(agent, 'Complex task')
    expect(adapter.requests).toHaveLength(3)
    expect(adapter.requests[2]?.provider).toBe('expert')
    expect(requestText(adapter.requests[2]!)).toContain('Complete the following task directly')
    const failed = [...agent.session.events].reverse()
      .find(event => event.type === 'h-model-routing/state')
    expect(failed?.type === 'h-model-routing/state' && failed.data).toMatchObject({
      phase: 'failed',
      failure: 'The planner request failed.',
    })
  })

  it('leaves a durable planning snapshot interrupted when the planner is cancelled', async () => {
    const adapter = new PausingPlannerAdapter()
    const { agent } = await harness([], adapter)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Plan a complex task' }],
      source: { kind: 'user' },
    }))
    await adapter.plannerStarted.promise
    expect(foldHPlan(agent.session.events)).toMatchObject({
      phase: 'planning',
      task: 'Plan a complex task',
    })
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()

    expect(foldHPlan(agent.session.events)).toMatchObject({
      phase: 'interrupted',
      task: 'Plan a complex task',
    })
    const ended = agent.session.events.findLast(event => event.type === 'turn/end')
    expect(ended?.type === 'turn/end' && ended.data.reason.kind).toBe('aborted')
  })

  it('keeps completed subtask progress but projects an execution error as interrupted', async () => {
    const { agent } = await harness([
      classifyResponse('COMPLEX'),
      () => textResponse('1. First subtask\n2. Second subtask'),
      classifyResponse('SIMPLE'),
      new Error('subtask execution failed'),
    ])
    await submit(agent, 'Complex task')

    const raw = [...agent.session.events].reverse()
      .find(event => event.type === 'h-model-routing/state')
    expect(raw?.type === 'h-model-routing/state' && raw.data).toMatchObject({
      phase: 'executing',
      subtasks: [{ status: 'in_progress' }, { status: 'pending' }],
    })
    expect(foldHPlan(agent.session.events)).toMatchObject({
      phase: 'interrupted',
      subtasks: [{ status: 'in_progress' }, { status: 'pending' }],
    })
  })

  it('clears a completed plan before the next user task is assessed', async () => {
    const { agent } = await harness([
      classifyResponse('COMPLEX'),
      () => textResponse('1. First subtask\n2. Second subtask'),
      classifyResponse('SIMPLE'),
      () => textResponse('Result A'),
      classifyResponse('SIMPLE'),
      () => textResponse('Result B'),
      () => textResponse('FINAL ANSWER'),
      classifyResponse('SIMPLE'),
      () => textResponse('SECOND ANSWER'),
    ])
    await submit(agent, 'Complete a complex task')
    await submit(agent, 'Answer a simple task')

    const states = agent.session.events.filter(event => event.type === 'h-model-routing/state')
    const completed = states.findIndex(event => event.data?.phase === 'completed')
    const cleared = states.findIndex((event, index) => index > completed && event.data === null)
    expect(completed).toBeGreaterThanOrEqual(0)
    expect(cleared).toBeGreaterThan(completed)
    expect(foldHPlan(agent.session.events)).toBeNull()
  })

  it('does not route subagent children', async () => {
    const { adapter, agent } = await harness([
      () => textResponse('CHILD ANSWER'),
    ])
    const child = await parentCtx(agent)
    child.followup(createUserMessage({
      content: [{ type: 'text', text: 'child task' }],
      source: { kind: 'user' },
    }))
    await child.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(requestText(adapter.requests[0]!)).toContain('child task')
    expect(adapter.requests[0]?.maxTokens).not.toBe(16)
  })
})

/** Create a subagent-origin child through the same factory (root filter must skip it). */
async function parentCtx(parent: Agent): Promise<Agent> {
  const handle = await parent.ctx.agents.create({
    sessionId: SessionId(`h-child-${Math.random()}`),
    meta: { parentSession: parent.id, origin: 'subagent', delegationDepth: 1 },
    agentOptions: { provider: 'light', model: 'light-1' },
  })
  return handle.agent
}
