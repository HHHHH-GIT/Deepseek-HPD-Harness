import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as HModelRoutingInvariant from '../src/invariant.ts'

describe('invariant companion', () => {
  it('registers the package-owned installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(HModelRoutingInvariant).await()).resolves.toBeDefined()
  })
})
