/**
 * Model-facing prompts and the strict parsers that read their outputs.
 * All prompts are deployment-owned constants: the model supplies data only.
 * @module @deepseek-ai/dsh-h-model-routing/prompts
 */

import type { HPlanSubtaskBehavior, HPlanTask, HPlanSubtaskStatus } from './types.ts'
import { MAX_H_PLAN_SUBTASK_TITLE_LENGTH } from './constants.ts'

/** System prompt of both complexity classifiers. */
export const CLASSIFY_SYSTEM = 'You are a task difficulty router for an agent system. '
  + 'Classify the task below as SIMPLE or COMPLEX. '
  + 'SIMPLE means one short, single-step answer with no tools or planning: greetings, small talk, '
  + 'and single factual or editorial questions are SIMPLE. '
  + 'COMPLEX means the task needs multiple steps, tool use, or planning: multi-step coding or analysis, '
  + 'debugging, research, file operations, or anything whose answer requires verification or decomposition '
  + 'are COMPLEX. When in doubt, classify COMPLEX. '
  + 'Reply with ONLY the single word SIMPLE or COMPLEX — no greeting, no explanation, no punctuation.'

/** System prompt of the level-2 model-tier and work-style classifier. */
export const SUBTASK_ROUTING_SYSTEM = 'You route one isolated subtask in an agent system. '
  + 'Choose the model tier and work style from the assigned instruction alone. '
  + 'Use SIMPLE for a short, self-contained task that does not require substantial reasoning, investigation, or tool use; otherwise use COMPLEX. '
  + 'Use spec for debugging, maintenance, review, migration, or work that benefits from inspecting existing artifacts before acting. '
  + 'Use react for independent implementation or production work that benefits from a direct produce-verify loop. '
  + 'Use weak only when neither style is clearly better. '
  + 'Reply with ONLY one valid JSON object and no Markdown.'

/**
 * Render the user-role classifier prompt for one task text.
 * @param task - normalized user task.
 * @returns the classifier's user-role prompt.
 */
export function classifyPrompt(task: string): string {
  return `Task:
${task}

Complexity (reply with the single word SIMPLE or COMPLEX and nothing else):`
}

/**
 * Parse a classifier reply. Only an explicit COMPLEX keyword routes the
 * complex path; any other reply — SIMPLE, a greeting, a refusal, or an empty
 * answer — is treated as simple so a trivial input never fans out into the
 * planner/direct/summary chain.
 * @param text - the raw classifier output.
 * @returns 'complex' only for an explicit COMPLEX verdict.
 */
export function parseComplexity(text: string): 'simple' | 'complex' {
  return text.toUpperCase().includes('COMPLEX') ? 'complex' : 'simple'
}

/** One level-2 routing verdict for an admitted DAG node. */
export interface HSubtaskRoutingDecision {
  /** Model-capability tier selected from the node instruction. */
  readonly complexity: 'simple' | 'complex'
  /** Optional behavior selection; legacy plain-text classifier output leaves it unset. */
  readonly behavior?: HPlanSubtaskBehavior
}

/** Render the strict JSON level-2 routing request for one subtask instruction. */
export function subtaskRoutingPrompt(instruction: string): string {
  return `Assigned subtask instruction:
${instruction}

Return exactly:
{"complexity":"SIMPLE or COMPLEX","behavior":"spec, react, or weak"}`
}

/** Parse the level-2 classifier's strict JSON verdict, retaining legacy tier-only replies without a behavior override. */
export function parseSubtaskRouting(text: string): HSubtaskRoutingDecision | undefined {
  const legacy = text.trim().toUpperCase()
  if (legacy === 'SIMPLE' || legacy === 'COMPLEX') {
    return { complexity: legacy === 'SIMPLE' ? 'simple' : 'complex' }
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 2 || (record.complexity !== 'SIMPLE' && record.complexity !== 'COMPLEX')
    || (record.behavior !== 'spec' && record.behavior !== 'react' && record.behavior !== 'weak')) return undefined
  return {
    complexity: record.complexity === 'SIMPLE' ? 'simple' : 'complex',
    behavior: record.behavior,
  }
}

/**
 * Render the no-tools DAG planner request for one complex task.
 * @param task - normalized original user task.
 * @returns the Planner request text.
 */
export function plannerPrompt(task: string): string {
  return `Act as a planner. Decompose the task into a directed acyclic graph of 2 to 8 subtasks.
Think through the decomposition and dependencies before producing the final response.
Each subtask needs a concise title of at most ${MAX_H_PLAN_SUBTASK_TITLE_LENGTH} characters and a complete self-contained instruction.
Use dependsOn only for work that must finish first.
Tasks with no shared mutable files, external side effects, or result dependency must remain independent.
When tasks read or write the same mutable artifact, call the same external system, or consume another task's result, encode that ordering in dependsOn.
Number tasks in topological order: every dependency id must be lower than the task id.
In the final response, output ONLY valid JSON with exactly this structure and no Markdown:
{"subtasks":[{"id":1,"title":"...","instruction":"...","dependsOn":[]}]}

Task:
${task}`
}

/**
 * Parse and validate the planner's topologically ordered JSON DAG.
 * @param text - raw Planner output.
 * @returns the validated tasks, or an empty array for invalid output.
 */
export function parseSubtasks(text: string): HPlanTask[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    const trimmed = text.trim()
    if (!trimmed.startsWith('{') || trimmed.endsWith('}')) return []
    try {
      value = JSON.parse(`${trimmed}}`)
    } catch {
      return []
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1 || !Array.isArray(record.subtasks)) return []
  const rawSubtasks = record.subtasks as unknown[]
  if (rawSubtasks.length < 2 || rawSubtasks.length > 8) return []
  const subtasks: HPlanTask[] = []
  for (let index = 0; index < rawSubtasks.length; index++) {
    const candidate = rawSubtasks[index]
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return []
    const task = candidate as Record<string, unknown>
    const id = task.id
    const title = task.title
    const instruction = task.instruction
    if (Object.keys(task).length !== 4 || typeof id !== 'number' || !Number.isInteger(id) || id !== index + 1
      || typeof title !== 'string' || title.trim().length === 0 || title !== title.trim()
      || title.length > MAX_H_PLAN_SUBTASK_TITLE_LENGTH
      || typeof instruction !== 'string' || instruction.trim().length === 0 || instruction !== instruction.trim()
      || !Array.isArray(task.dependsOn)) return []
    const rawDependencies = task.dependsOn as unknown[]
    const dependencies: number[] = []
    for (const dependency of rawDependencies) {
      if (typeof dependency !== 'number' || !Number.isInteger(dependency)
        || dependency < 1 || dependency >= id || dependencies.includes(dependency)) return []
      dependencies.push(dependency)
    }
    subtasks.push({ id, title, instruction, dependsOn: dependencies })
  }
  return subtasks
}

/** One settled dependency supplied to a downstream isolated worker. */
export interface HDependencyResult {
  id: number
  title: string
  result: string
}

/**
 * Render one isolated parallel worker's complete task context.
 * @param task - normalized original user task.
 * @param subtask - DAG node assigned to this worker.
 * @param dependencies - completed direct dependency results.
 * @returns the isolated worker prompt.
 */
export function subtaskPrompt(
  task: string,
  subtask: HPlanTask,
  dependencies: readonly HDependencyResult[],
): string {
  const dependencyContext = dependencies.length === 0
    ? '(none)'
    : dependencies.map(dependency => `Task ${dependency.id}: ${dependency.title}\nResult: ${dependency.result}`).join('\n\n')
  return `You are a parallel worker completing one node of a larger task graph.
Complete only your assigned subtask. Do not work on sibling tasks. Use available tools when needed and report a concise result for the final synthesizer.

Original task:
${task}

Assigned task ${subtask.id}:
${subtask.title}

Instruction:
${subtask.instruction}

Completed dependency results:
${dependencyContext}

Return only the result of assigned task ${subtask.id}.`
}

/**
 * Render the direct-completion fallback for an unparseable plan.
 * @param task - normalized original user task.
 * @returns the Expert completion directive.
 */
export function directPrompt(task: string): string {
  return `Complete the following task directly and comprehensively now.

Task:
${task}`
}

/**
 * Render the final summary instruction over all subtask results.
 * @param task - normalized original user task.
 * @param subtasks - planned tasks with their final execution text.
 * @returns the injected summary directive.
 */
export function summaryPrompt(task: string, subtasks: readonly HSubtaskSummary[]): string {
  const body = subtasks.map(subtask =>
    `Task ${subtask.id}: ${subtask.title}
Status: ${subtask.status}
Result: ${subtask.result === undefined || subtask.result.length === 0 ? '(no result)' : subtask.result}${subtask.failure === undefined ? '' : `\nFailure: ${subtask.failure}`}`,
  ).join('\n')
  return `The task graph has settled. Combine the successful results below into ONE final answer for the original task.
When any task failed or was blocked, state the resulting limitation plainly. Write ONLY the final answer.

Original task:
${task}

Subtask results:
${body}`
}

/** The summary-shaped view of one subtask (text plus collected result). */
export interface HSubtaskSummary extends HPlanTask {
  status: HPlanSubtaskStatus
  result?: string
  failure?: string
}
