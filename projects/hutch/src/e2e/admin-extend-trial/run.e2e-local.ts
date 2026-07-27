import { requireEnv } from '@packages/require-env'
import { test } from '@packages/e2e-harness'
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './admin-e2e-user'
import { runExtendTrialFlow } from './extend-trial-flow'

const BASE_URL = `http://localhost:${requireEnv('E2E_PORT')}`

test.describe('Admin extend-trial flow (local)', () => {
	test('admin looks up unknown, founding, and trialing users, then extends and overrides a trial', async ({ page }) => {
		await runExtendTrialFlow(page, {
			baseURL: BASE_URL,
			admin: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD },
			// A user of its own so the parallel queue-flow spec never sees this
			// flow's admin mutations on its account.
			target: {
				email: 'extend-trial-target-e2e@example.com',
				password: 'target-password-123',
			},
			firstExtension: {
				input: '2033-03-01T10:30',
				iso: '2033-03-01T10:30:00.000Z',
			},
			secondExtension: {
				input: '2033-04-01T09:00',
				iso: '2033-04-01T09:00:00.000Z',
			},
		})
	})
})
