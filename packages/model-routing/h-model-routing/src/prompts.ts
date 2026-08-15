/**
 * Model-facing prompts and the strict parsers that read their outputs.
 * All prompts are deployment-owned constants: the model supplies data only.
 * @module @deepseek-ai/dsh-h-model-routing/prompts
 */

/** System prompt of both complexity classifiers. */
export const CLASSIFY_SYSTEM = 'You are a task difficulty router for an agent system. '
  + 'Classify the task below as SIMPLE or COMPLEX. '
  + 'SIMPLE means one short, single-step answer with no tools or planning: greetings, small talk, '
  + 'and single factual or editorial questions are SIMPLE. '
  + 'COMPLEX means the task needs multiple steps, tool use, or planning: multi-step coding or analysis, '
  + 'debugging, research, file operations, or anything whose answer requires verification or decomposition '
  + 'are COMPLEX. When in doubt, classify COMPLEX. '
  + 'Reply with ONLY the single word SIMPLE or COMPLEX — no greeting, no explanation, no punctuation.'

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

/**
 * Render the planner instruction injected for a complex task.
 * @param task - normalized complex user task.
 * @returns the standalone planner prompt.
 */
export function plannerPrompt(task: string): string {
  return `Act as a planner. Break the following task into a numbered list of 2 to 8 subtasks.
Each subtask must be self-contained and independently executable in order.
Output ONLY the numbered list, one subtask per line, with no other text.
Do not call todo_write for this work; the subtask list is managed automatically.

Task:
${task}`
}

/**
 * Parse a planner reply into subtasks. Lines must start with a number
 * (`1.`, `2)`) or a list bullet; up to 8 items are accepted.
 * @param text - the raw planner output.
 * @returns 2 to 8 subtask texts in plan order; empty when the response does
 * not contain a usable multi-step plan.
 */
export function parseSubtasks(text: string): string[] {
  const subtasks: string[] = []
  for (const line of text.split('\n')) {
    const match = /^\s*(?:\d+[.)]|[-*])\s+(.+?)\s*$/.exec(line)
    if (match?.[1] === undefined) continue
    const item = match[1].trim().replace(/[.,;，。；]+$/, '').trim()
    if (item.length > 0) subtasks.push(item)
    if (subtasks.length >= 8) break
  }
  return subtasks.length >= 2 ? subtasks : []
}

/**
 * Render the execution instruction for one subtask.
 * @param index - zero-based subtask position.
 * @param count - total planned subtask count.
 * @param text - self-contained planner-produced subtask.
 * @returns the injected execution directive.
 */
export function subtaskPrompt(index: number, count: number, text: string): string {
  return `Subtask ${index + 1}/${count}:
${text}

Complete ONLY this subtask now and report the result concisely. Do not work on other subtasks — each remaining subtask is steered separately.`
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
  const body = subtasks.map((subtask, index) =>
    `${index + 1}. Task: ${subtask.text}
   Result: ${subtask.result === undefined || subtask.result.length === 0 ? '(no result)' : subtask.result}`,
  ).join('\n')
  return `All subtasks of the original task are complete. Combine the subtask results below into ONE final answer
for the original task. Write ONLY the final answer — do not recap, enumerate, or repeat the subtasks or their completion status.

Original task:
${task}

Subtask results:
${body}`
}

/** The summary-shaped view of one subtask (text plus collected result). */
export interface HSubtaskSummary {
  text: string
  result?: string
}
