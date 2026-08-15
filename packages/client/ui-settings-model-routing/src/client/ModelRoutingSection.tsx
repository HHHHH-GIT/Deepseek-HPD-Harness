/**
 * Model Routing settings section: the Light and Expert model bindings plus
 * the reasoning-effort mode. Each row picks one concrete model from the
 * host catalog (\`llm.models\`) and optionally one of that model's
 * advertised reasoning efforts. Every change writes through
 * \`settings.mutate\` as one batch and re-renders from the acknowledged
 * namespace view.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import { modelOptions } from './store.ts'
import type { HModelRoutingValue, ModelOption, ModelRoutingSettingsState, ModelRoutingSettingsStore } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelRoutingSection.module.css'

/** Injected dependencies of {@link ModelRoutingSection} (slot \`inject\`). */
export interface ModelRoutingSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: ModelRoutingSettingsStore
  /** uSES subscription hook bound to the store. */
  useSnapshot: SnapshotSelectorHook<ModelRoutingSettingsState>
  /** Wire faces (kept for section symmetry; the store owns the wire). */
  api: Pick<IApiClient, 'llm' | 'settings'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type ModelRoutingSectionProps = Partial<ModelRoutingSectionInjected>

/** The two tiers one page configures. */
type RouteKey = 'light' | 'expert'

/** Locate the catalog row a stored binding names, when the catalog still lists it. */
function findOption(options: readonly ModelOption[], provider: string, model: string): ModelOption | undefined {
  return options.find(option => option.provider === provider && option.model === model)
}

/** Write one batch and surface a rejected write as a local error. */
async function save(
  controller: ModelRoutingSettingsStore,
  setSaveError: (message: string | null) => void,
  ops: readonly SettingsPathOpView[],
): Promise<void> {
  setSaveError(null)
  const error = await controller.write(ops)
  if (error !== undefined) setSaveError(error)
}

interface RouteCardProps {
  route: RouteKey
  label: string
  value: HModelRoutingValue | undefined
  options: readonly ModelOption[]
  disabled: boolean
  manual: boolean
  t: (key: keyof typeof en) => string
  onSave: (ops: readonly SettingsPathOpView[]) => Promise<void>
}

/** One tier card: a concrete model picker plus its reasoning-effort picker. */
function RouteCard({ route, label, value, options, disabled, manual, t, onSave }: RouteCardProps): ReactNode {
  const binding = value?.[route]
  const selected = binding === undefined ? undefined : findOption(options, binding.provider, binding.model)
  const selectValue = selected?.id ?? (binding === undefined ? '' : 'stored')
  const efforts = selected?.efforts ?? []
  const effortValue = binding?.reasoningEffort ?? ''
  return (
    <fieldset className={styles.card}>
      <legend>{label}</legend>
      <label className={styles.field}>
        <span>{t('modelSelect')}</span>
        <select
          value={selectValue}
          disabled={disabled}
          onChange={(event) => {
            const option = options.find(candidate => candidate.id === event.target.value)
            if (option === undefined) return
            // A model switch clears the stored effort so a stale effort from
            // another model can never ride along.
            void onSave([
              { op: 'set', path: [route, 'provider'], value: option.provider },
              { op: 'set', path: [route, 'model'], value: option.model },
              { op: 'set', path: [route, 'reasoningEffort'], value: '' },
            ])
          }}
        >
          {binding !== undefined && selected === undefined
            ? <option value="stored">{binding.provider}/{binding.model}</option>
            : null}
          {options.map(option => (
            <option key={option.id} value={option.id}>
              {option.providerName} · {option.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>{t('effortSelect')}</span>
        <select
          value={effortValue}
          disabled={disabled || !manual}
          onChange={(event) => {
            void onSave([{ op: 'set', path: [route, 'reasoningEffort'], value: event.target.value }])
          }}
        >
          <option value="">{t('effortDefault')}</option>
          {efforts.map(effort => (
            <option key={effort.id} value={effort.id}>
              {effort.name}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  )
}

/** The Model Routing settings page body. */
export function ModelRoutingSection({ controller, useSnapshot, api, t }: ModelRoutingSectionProps): ReactNode {
  void api
  const snapshot = useSnapshot?.(state => state)
  const [saveError, setSaveError] = useState<string | null>(null)
  useEffect(() => {
    void controller?.load()
  }, [controller])
  if (snapshot === undefined || controller === undefined || t === undefined) return null
  const value = snapshot.value
  const manual = value?.reasoningEffortMode === 'manual'
  const disabled = snapshot.status !== 'ready' || !snapshot.writable
  const options = modelOptions(snapshot.groups)
  const changeMode = (mode: 'auto' | 'manual'): void => {
    void save(controller, setSaveError, [{ op: 'set', path: ['reasoningEffortMode'], value: mode }])
  }
  return (
    <div className={styles.section}>
      <p className={styles.intro}>{t('intro')}</p>
      {snapshot.status === 'error'
        ? <p className={styles.error}>{t('loadError')}: {snapshot.error}</p>
        : null}
      <fieldset className={styles.card}>
        <legend>{t('modeLabel')}</legend>
        <label className={styles.field}>
          <input
            type="radio"
            name="h-reasoning-effort-mode"
            checked={!manual}
            disabled={disabled || value === undefined}
            onChange={() => { changeMode('auto') }}
          />
          <span>{t('modeAuto')}</span>
        </label>
        <label className={styles.field}>
          <input
            type="radio"
            name="h-reasoning-effort-mode"
            checked={manual}
            disabled={disabled || value === undefined}
            onChange={() => { changeMode('manual') }}
          />
          <span>{t('modeManual')}</span>
        </label>
      </fieldset>
      <RouteCard
        route="light"
        label={t('lightLabel')}
        value={value}
        options={options}
        disabled={disabled}
        manual={manual}
        t={t}
        onSave={ops => save(controller, setSaveError, ops)}
      />
      <RouteCard
        route="expert"
        label={t('expertLabel')}
        value={value}
        options={options}
        disabled={disabled}
        manual={manual}
        t={t}
        onSave={ops => save(controller, setSaveError, ops)}
      />
      {saveError !== null
        ? <p className={styles.error}>{t('saveError')}: {saveError}</p>
        : null}
    </div>
  )
}
