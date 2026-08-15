/**
 * Package-owned invariant companion for
 * `@deepseek-ai/dsh-client-ui-h-model-routing`.
 * @module @deepseek-ai/dsh-client-ui-h-model-routing/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-h-model-routing'

/** Cordis companion plugin name. */
export const name = 'client-ui-h-model-routing-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plan state is owned by the h-model-routing
 * projection, while this package only registers a projection-driven dock
 * entry whose disposal is covered by the package's HMR-safety spec.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
