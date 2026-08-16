/**
 * Model-routing settings page store: joins the host model catalog
 * (\`llm.models\`) with the \`h-model-routing\` settings namespace view
 * (\`settings.describe\`), and writes field changes through
 * \`settings.mutate\` with the namespace revision. The host stays the
 * single fact source; every mutation re-reads the acknowledged view.
 */

import type { IApiClient, ModelCatalogFailure, ModelProviderGroup, SettingsPathOpView, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The settings namespace this page owns. */
export const NAMESPACE = 'h-model-routing'

/** Client-side mirror of the host schema (plain wire JSON). */
export interface ModelRouteConfigValue {
  provider: string
  model: string
  reasoningEffort: string
}

/** Client-side mirror of the host settings section. */
export interface HModelRoutingValue {
  light: ModelRouteConfigValue
  expert: ModelRouteConfigValue
  reasoningEffortMode: 'auto' | 'manual'
}

/** One selectable model row, flattened from the provider groups. */
export interface ModelOption {
  /** Opaque row id: `groupIndex:modelIndex`. */
  id: string
  provider: string
  model: string
  name: string
  providerName: string
  efforts: readonly { id: string; name: string; description?: string }[]
}

/**
 * Flatten the catalog into selectable rows with stable opaque ids.
 * @param groups - provider-grouped model catalog.
 * @returns selectable model rows in catalog order.
 */
export function modelOptions(groups: readonly ModelProviderGroup[]): ModelOption[] {
  const rows: ModelOption[] = []
  groups.forEach((group, groupIndex) => {
    group.models.forEach((model, modelIndex) => {
      rows.push({
        id: `${groupIndex}:${modelIndex}`,
        provider: group.id,
        model: model.id,
        name: model.name,
        providerName: group.name,
        efforts: model.reasoning?.efforts ?? [],
      })
    })
  })
  return rows
}

/** Page snapshot. */
export interface ModelRoutingSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  writable: boolean
  groups: readonly ModelProviderGroup[]
  failures: readonly ModelCatalogFailure[]
  value: HModelRoutingValue | undefined
  revision: number | undefined
}

/** Decode one namespace view's value defensively. */
function decodeValue(view: SettingsNamespaceView): HModelRoutingValue | undefined {
  const value = view.value
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const route = (key: string): ModelRouteConfigValue | undefined => {
    const section = record[key]
    if (typeof section !== 'object' || section === null) return undefined
    const fields = section as Record<string, unknown>
    if (typeof fields['provider'] !== 'string' || typeof fields['model'] !== 'string') return undefined
    return {
      provider: fields['provider'],
      model: fields['model'],
      reasoningEffort: typeof fields['reasoningEffort'] === 'string' ? fields['reasoningEffort'] : '',
    }
  }
  const light = route('light')
  const expert = route('expert')
  if (light === undefined || expert === undefined) return undefined
  const mode = record['reasoningEffortMode']
  return {
    light,
    expert,
    reasoningEffortMode: mode === 'manual' ? 'manual' : 'auto',
  }
}

/** The model-routing settings page controller (one per settings surface). */
export class ModelRoutingSettingsStore {
  /** The snapshot the section renders from. */
  readonly store: SnapshotStore<ModelRoutingSettingsState> = createSnapshotStore<ModelRoutingSettingsState>({
    status: 'idle', error: null, writable: false, groups: [], failures: [], value: undefined, revision: undefined,
  })

  private generation = 0

  constructor(private readonly api: Pick<IApiClient, 'llm' | 'settings'>) {}

  /** Refresh the page snapshot: catalog and namespace view in parallel. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    let groups: ModelProviderGroup[]
    let failures: ModelCatalogFailure[]
    let writable: boolean
    let view: SettingsNamespaceView | undefined
    try {
      const [modelsResponse, settingsResponse] = await Promise.all([
        this.api.llm.models({}),
        this.api.settings.describe({}),
      ])
      if (!modelsResponse.result.ok) throw new Error(modelsResponse.result.error.message)
      if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message)
      groups = modelsResponse.result.value.groups
      failures = modelsResponse.result.value.failures
      writable = settingsResponse.result.value.writable
      view = settingsResponse.result.value.namespaces.find(candidate => candidate.ns === NAMESPACE)
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'error'
        state.error = error instanceof Error ? error.message : String(error)
      })
      return
    }
    if (generation !== this.generation) return
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.groups = groups
      state.failures = failures
      state.writable = writable
      state.value = view === undefined ? undefined : decodeValue(view)
      state.revision = view?.revision
    })
  }

  /**
   * Write one batch of field ops and adopt the acknowledged view. A rejected
   * or rejected-by-transport write reloads so the page never shows a value the
   * host does not have.
   * @param ops - field mutations to apply atomically.
   * @returns the failure message, or undefined once the write landed.
   */
  async write(ops: readonly SettingsPathOpView[]): Promise<string | undefined> {
    const { revision } = this.store.getSnapshot()
    try {
      const response = await this.api.settings.mutate({
        ns: NAMESPACE,
        ops: [...ops],
        ...(revision === undefined ? {} : { expectedRevision: revision }),
      })
      if (!response.result.ok) {
        await this.load()
        return response.result.error.message
      }
      const view = response.result.value
      this.store.update((state) => {
        const decoded = decodeValue(view)
        if (decoded !== undefined) state.value = decoded
        state.revision = view.revision
      })
      return undefined
    } catch (error) {
      await this.load()
      return error instanceof Error ? error.message : String(error)
    }
  }
}
