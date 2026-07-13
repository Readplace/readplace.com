import assert from 'node:assert/strict'
import { type Page, expect, request as playwrightRequest } from '@playwright/test'
import { HATEOASClient, PageNavigationHandler } from '../hateoas'
import {
  createExtendTrialActions,
  type ExtendTrialConfig,
  type ExtendTrialProgress,
} from './extend-trial-actions'

/** Drives the operator's extend-trial journey end-to-end in a real browser
 * against the in-memory-provider server: the admin gate bounces the anonymous
 * visit to /login, the allowlisted admin signs in, looks up an unknown email,
 * a founding member (refused), and a genuinely trialing user, then extends the
 * trial twice — the second submit proving delete-then-create idempotency
 * against the scheduler fake that rejects duplicate names like EventBridge. */
export async function runExtendTrialFlow(page: Page, config: ExtendTrialConfig & {
  target: { email: string; password: string }
}): Promise<void> {
  // Seed over HTTP, the oauth-revoke way. The admin comes from the out-of-band
  // fixture endpoint (no subscription row — deliberately, so the flow can also
  // prove the founding-member refusal on the admin's own address). The TARGET
  // goes through the real /signup handler so the row and both trial one-shots
  // exist exactly as production signup (startTrial) creates them; loadedAt is
  // backdated past the bot-defense minimum.
  const seed = await playwrightRequest.newContext({ baseURL: config.baseURL })
  try {
    const adminCreated = await seed.post('/e2e/users', {
      data: { email: config.admin.email, password: config.admin.password },
    })
    assert.equal(adminCreated.status(), 201, 'seeding the admin user must succeed')

    // Signup only starts a trial once the founding allocation (3 seats in the
    // e2e fixture) is exhausted — earlier accounts become founding members with
    // no subscription row, which this page refuses. Two fillers plus the admin
    // guarantee the target lands past the allocation regardless of how many
    // users the parallel specs have created by now.
    for (const filler of ['extend-trial-filler-1@example.com', 'extend-trial-filler-2@example.com']) {
      const created = await seed.post('/e2e/users', {
        data: { email: filler, password: 'filler-password-123' },
      })
      assert.equal(created.status(), 201, `seeding ${filler} must succeed`)
    }

    const targetSignup = await seed.post('/signup', {
      form: {
        website: '',
        loadedAt: String(Date.now() - 8000),
        email: config.target.email,
        password: config.target.password,
      },
      maxRedirects: 0,
    })
    assert.equal(targetSignup.status(), 303, 'target signup must create a real trialing user')
  } finally {
    await seed.dispose()
  }

  const progress: ExtendTrialProgress = {
    loggedInAsAdmin: false,
    openedAdminPage: false,
    unknownEmailReported: false,
    foundingMemberRefused: false,
    targetLookedUp: false,
    trialExtended: false,
    overrideVerified: false,
  }

  const actions = createExtendTrialActions(config, progress)
  const navigationHandler = new PageNavigationHandler(
    page,
    {
      successDetector: async () => Object.values(progress).every(Boolean),
    },
    new Map(Object.entries(actions)),
  )

  const client = new HATEOASClient(page, navigationHandler)
  const result = await client.navigate(`${config.baseURL}/admin/extend-trial`, {
    maxNavigations: 20,
  })

  expect(result.success).toBe(true)
}
