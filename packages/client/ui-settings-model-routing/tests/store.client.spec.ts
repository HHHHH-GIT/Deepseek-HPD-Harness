/** Model-routing settings store over fake wire faces. */

import { describe, expect, it } from 'vitest'
import { ModelRoutingSettingsStore, NAMESPACE } from '../src/client/store.ts'
import type { ModelRoutingSettingsState } from '../src/client/store.ts'

function ok<T>(value: T) {
  return { result: { ok: true as const, value } }
}

function err(code: string) {
  return { result: { ok: false as const, error: { code, message: code, details: {} } } }
}

describe('ModelRoutingSettingsStore', () => {
  it('loads the catalog and the h-model-routing namespace view', async () => {
    const doc = {
      light: { provider: 'light-route', model: 'light-1', reasoningEffort: '' },
      expert: { provider: 'expert-route', model: 'expert-1', reasoningEffort: 'max' },
      reasoningEffortMode: 'manual',
    }
    const store = new ModelRoutingSettingsStore({
      llm: {
        models: async () => ok({
          groups: [{
            id: 'light-route',
            name: 'Light Provider',
            models: [{ id: 'light-1', name: 'Light One', reasoning: { efforts: [{ id: 'off', name: 'Off' }] } }],
          }],
          failures: [],
        }),
      },
      settings: {
        describe: async () => ok({
          writable: true,
          hasDocument: true,
          namespaces: [{
            ns: NAMESPACE,
            schema: {},
            value: doc,
            revision: 7,
          }],
        }),
        mutate: async () => err('unreachable'),
      },
    } as never)
    await store.load()
    const snapshot: ModelRoutingSettingsState = store.store.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.writable).toBe(true)
    expect(snapshot.groups[0]?.models[0]?.reasoning?.efforts).toEqual([{ id: 'off', name: 'Off' }])
    expect(snapshot.value).toEqual(doc)
    expect(snapshot.revision).toBe(7)
  })

  it('writes one batch with the revision and adopts the acknowledged view', async () => {
    const acknowledged = {
      light: { provider: 'light-route', model: 'light-2', reasoningEffort: '' },
      expert: { provider: 'expert-route', model: 'expert-1', reasoningEffort: 'max' },
      reasoningEffortMode: 'auto',
    }
    const mutate = async (payload: unknown) => {
      const { expectedRevision, ops } = payload as { expectedRevision: number; ops: unknown[] }
      expect(expectedRevision).toBe(7)
      expect(ops).toEqual([{ op: 'set', path: ['light', 'model'], value: 'light-2' }])
      return ok({
        ns: NAMESPACE,
        schema: {},
        value: acknowledged,
        revision: 8,
      })
    }
    const store = new ModelRoutingSettingsStore({
      llm: { models: async () => ok({ groups: [], failures: [] }) },
      settings: {
        describe: async () => ok({
          writable: true,
          hasDocument: true,
          namespaces: [{
            ns: NAMESPACE,
            schema: {},
            value: {
              light: { provider: 'light-route', model: 'light-1', reasoningEffort: '' },
              expert: { provider: 'expert-route', model: 'expert-1', reasoningEffort: '' },
              reasoningEffortMode: 'auto',
            },
            revision: 7,
          }],
        }),
        mutate,
      },
    } as never)
    await store.load()
    const error = await store.write([{ op: 'set', path: ['light', 'model'], value: 'light-2' }])
    expect(error).toBeUndefined()
    const snapshot = store.store.getSnapshot()
    expect(snapshot.value?.light.model).toBe('light-2')
    expect(snapshot.revision).toBe(8)
  })

  it('reloads and reports a rejected write', async () => {
    let loads = 0
    const store = new ModelRoutingSettingsStore({
      llm: { models: async () => ok({ groups: [], failures: [] }) },
      settings: {
        describe: async () => {
          loads += 1
          return ok({
            writable: true,
            hasDocument: true,
            namespaces: [{
              ns: NAMESPACE,
              schema: {},
              value: {
                light: { provider: 'light-route', model: 'light-1', reasoningEffort: '' },
                expert: { provider: 'expert-route', model: 'expert-1', reasoningEffort: '' },
                reasoningEffortMode: 'auto',
              },
              revision: 7,
            }],
          })
        },
        mutate: async () => err('settings-conflict'),
      },
    } as never)
    await store.load()
    const error = await store.write([{ op: 'set', path: ['light', 'model'], value: 'light-9' }])
    expect(error).toBe('settings-conflict')
    expect(loads).toBe(2)
  })
})
