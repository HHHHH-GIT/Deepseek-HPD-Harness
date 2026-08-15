/**
 * H model-routing plan panel, browser half. Its live state reaches the dock
 * through `useProjection('hModelRouting')`; this plugin owns only local
 * disclosure state and no domain store, refresh path, or event listener.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the hModelRouting SessionProjectionMap merge into the client program.
import type {} from '@deepseek-ai/dsh-h-model-routing/client'
// Type-only: pulls the conversation dock SlotMap declaration into the client program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale service Context merge into the client program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { HPlanDock } from './HPlanPanel.tsx'
import { en, NS, type HModelRoutingKey, zh } from './locales.ts'

export type { HModelRoutingKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** H model-routing plan dock copy. */
    hModelRouting: HModelRoutingKey
  }
}

/** Services needed to register the panel and its dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Register the projection-driven H plan dock.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-h-model-routing: dictionaries')
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'h-model-routing',
    order: 5,
    locale: NS,
  }, HPlanDock))
}
