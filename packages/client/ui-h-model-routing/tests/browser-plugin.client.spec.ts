import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { HPlanDock } from '../src/client/HPlanPanel.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.input.dock': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  return ctx
}

describe('ui-h-model-routing browser plugin', () => {
  it('declares only the slot and locale services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the H plan dock and drops it with the plugin fiber', async () => {
    const ctx = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = ctx.slots.entries('conversation.input.dock')[0]
    expect(entry?.component).toBe(HPlanDock)
    expect(entry?.options).toMatchObject({ id: 'h-model-routing', order: 5 })
    expect(entry?.locale).toBe('hModelRouting')

    await fiber.dispose()
    expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(0)
  })

  it('waits for the conversation package to declare the dock', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(0)

    ctx.slots.register({
      name: 'root',
      children: { 'conversation.input.dock': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(1)
  })

  it('keeps the node half as an inert roster entry', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
