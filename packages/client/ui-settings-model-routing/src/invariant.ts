/**
 * Package-owned invariant companion for the model-routing settings plugin.
 * @module @deepseek-ai/dsh-client-ui-settings-model-routing/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-model-routing'

/** Install the package contribution into the invariant registry's child context. */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure): void => {
  // No runtime invariant: the browser settings page writes no durable session events.
}, { inject: [] })

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-model-routing-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Register the model-routing settings invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
