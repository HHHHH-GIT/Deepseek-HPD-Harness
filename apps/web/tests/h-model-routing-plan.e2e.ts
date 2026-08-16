// Keyless assembled-browser coverage for H routing over a minimal preset. The
// host owns the H projection outside preset tool lists, so a cold session that
// has no todo_write tool must still render the durable plan and its progress.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { HPlanProjection } from '@deepseek-ai/dsh-h-model-routing'
import type {} from '@deepseek-ai/dsh-h-model-routing'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/h-model-routing-plan', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const SHIPPED_PRESETS = fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'h-model-routing-plan-web-e2e'
const TASK = 'Audit the release path and prepare a safe rollout.'

/**
 * One closed minimal-preset session whose unfinished H execution stops at an
 * aborted turn boundary. The durable fold must retain completed work while
 * exposing the plan as interrupted rather than attempting cold resumption.
 * @returns a tokenized session log suitable for {@link seedSession}.
 */
function seedLog(): string {
  const session = Session.create(SessionId('h-model-routing-plan-source'))
  const planId = 'h-plan-web-replay' as HPlanProjection['planId']
  const time = 1784974100000
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: TASK }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('h-model-routing/state', null)
  session.append('h-model-routing/state', {
    planId,
    turn: 1,
    task: TASK,
    phase: 'planning',
    subtasks: [],
  })
  session.append('h-model-routing/state', {
    planId,
    turn: 1,
    task: TASK,
    phase: 'executing',
    subtasks: [
      { id: 1, title: 'Inspect release checklist', instruction: 'Inspect the complete release checklist.', dependsOn: [], status: 'completed' },
      { id: 2, title: 'Validate production rollout', instruction: 'Validate the production rollout.', dependsOn: [], status: 'in_progress' },
      { id: 3, title: 'Write handoff summary', instruction: 'Write the final handoff summary.', dependsOn: [1, 2], status: 'pending' },
    ],
  })
  session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
  return [
    // seedSession supplies the persisted header's cwd. Omitting it here keeps
    // this inline fixture valid on Windows, where a raw `{{cwd}}` replacement
    // would otherwise place backslashes inside JSON without escaping them.
    JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', createdAt: time }),
    ...session.events.map(event => JSON.stringify({ ...event, time: time + event.seq * 1_000 })),
    '',
  ].join('\n')
}

/** Wait for the session open to attach its recorded minimal-preset agent. */
async function attachedAgent(scaffold: WebScaffold): Promise<Agent> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const agent = scaffold.ctx.agents.get(SessionId(SEED_ID))
    if (agent !== undefined) return agent
    await new Promise<void>((resolve) => { setTimeout(resolve, 25) })
  }
  throw new Error('seeded minimal session did not attach an agent')
}

describe('web e2e: H routing plan without todo_write', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    if (MODE === 'record') throw new Error('h-model-routing-plan is a keyless assembled snapshot')
    scaffold = await launchWebScaffold({
      agentPresets: { roots: [{ path: SHIPPED_PRESETS, trust: 'system' }], default: 'minimal' },
    })
    await seedSession(scaffold, seedLog(), SEED_ID, 'minimal')
    expect(scaffold.ctx.tools.get('todo_write')).toBeUndefined()
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    const agent = await attachedAgent(scaffold)
    expect(scaffold.ctx.tools.get('todo_write', agent)).toBeUndefined()
    expect(scaffold.ctx.tools.schemas(agent).some(tool => tool.name === 'todo_write')).toBe(false)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('folds the cold execution to interrupted and renders its DAG progress', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-h-model-routing-plan'))
    const panel = page.locator('section[aria-label="Complex task plan"]')
    await panel.waitFor({ timeout: 15_000 })
    await expect.poll(() => panel.getByRole('button', { name: 'Collapse complex task plan' }).getAttribute('aria-expanded'))
      .toBe('true')
    await expect.poll(() => panel.getByText('Interrupted', { exact: true }).count()).toBe(1)
    await expect.poll(() => panel.getByText('1/3 completed', { exact: true }).count()).toBe(1)
    await expect.poll(() => panel.locator('li[data-status="completed"]').count()).toBe(1)
    await expect.poll(() => panel.locator('li[data-status="in_progress"]').count()).toBe(1)
    await expect.poll(() => panel.locator('li[data-status="pending"]').count()).toBe(1)
    await expect.poll(() => panel.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe('true')
    await expect.poll(() => panel.getByRole('button', { name: 'Task graph view' }).getAttribute('aria-pressed')).toBe('false')
    await expect.poll(() => panel.getByText(TASK, { exact: false }).count()).toBe(1)
    expect(await page.locator('[data-testid="todo-panel"]').count()).toBe(0)
    expect(await page.locator('[data-tool="todo_write"]').count()).toBe(0)

    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
  }, 60_000)

  it('keeps the fixture inventory closed and the browser clean', async () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  })
})
