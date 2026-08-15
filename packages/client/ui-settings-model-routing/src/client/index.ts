/**
 * Model-routing settings plugin, browser half: one \`settings.section\`
 * page where the user binds the Light and Expert models and the reasoning
 * effort mode. Data flows through the existing wire faces (\`llm.models\`
 * catalog + \`settings.describe\`/\`settings.mutate\`).
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ModelRoutingSection } from './ModelRoutingSection.tsx'
import type { ModelRoutingSectionInjected } from './ModelRoutingSection.tsx'
import { ModelRoutingSettingsStore } from './store.ts'
import { en, zh, type ModelKey } from './locales.ts'

export type { ModelRoutingSectionInjected, ModelRoutingSectionProps } from './ModelRoutingSection.tsx'
export type { ModelKey } from './locales.ts'
export type { ModelRoutingSettingsState, HModelRoutingValue, ModelRouteConfigValue, ModelOption } from './store.ts'
export { ModelRoutingSettingsStore, modelOptions, NAMESPACE } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.model-routing': ModelKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.model-routing'

/**
 * Refetch the page snapshot only after its first load: an unopened page must
 * not fetch on background invalidations.
 */
function refreshIfLoaded(controller: ModelRoutingSettingsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Register the Model Routing settings section once the \`settings.section\`
 * declaration is on the ledger, wire its store to the connection, and keep it
 * fresh on pushed invalidations.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-model-routing: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new ModelRoutingSettingsStore(connection.api)
  const useSnapshot = bindSnapshotSelector(controller.store)
  const t = ctx.locale.bind(NS) as ModelRoutingSectionInjected['t']
  const injected = (): ModelRoutingSectionInjected => ({
    controller,
    useSnapshot,
    api: connection.api,
    t,
  })

  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('settings/document-updated', () => { refreshIfLoaded(controller) }),
      ctx.remote.$on('llm/adapters-updated', () => { refreshIfLoaded(controller) }),
      ctx.on('connection/reset', () => { refreshIfLoaded(controller) }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-settings-model-routing: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'model-routing',
    order: 20,
    label: () => t('nav'),
    inject: injected,
  }, ModelRoutingSection))
}
