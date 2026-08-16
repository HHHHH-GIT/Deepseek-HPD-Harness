import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { ConversationEventRegistry, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { HPlanDock } from '../src/client/HPlanPanel.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  await ctx.plugin(ConversationEventRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.input.dock': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sessions', { openSubagent: () => {} })
  return ctx
}

describe('ui-h-model-routing browser plugin', () => {
  it('declares the slot, locale, and navigation services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'conversationEvents'])
  })

  it('registers the H plan dock and drops it with the plugin fiber', async () => {
    const ctx = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = ctx.slots.entries('conversation.input.dock')[0]
    expect(entry?.component).toBe(HPlanDock)
    expect(entry?.options).toMatchObject({ id: 'h-model-routing', order: 5 })
    expect(entry?.locale).toBe('hModelRouting')
    expect(ctx.conversationEvents.entries().map(definition => definition.kind)).toContain('assistant-presentation')

    await fiber.dispose()
    expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(0)
    expect(ctx.conversationEvents.entries().map(definition => definition.kind)).not.toContain('assistant-presentation')
  })

  it('waits for the conversation package to declare the dock', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    await ctx.plugin(ConversationEventRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('sessions', { openSubagent: () => {} })
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
