import { test } from '@packages/e2e-harness'
import { requireEnv } from '@packages/require-env'
import { runOAuthRevokeFlow } from './oauth-revoke-flow'

const BASE_URL = `http://localhost:${requireEnv('E2E_PORT')}`

test.describe('OAuth revoke sign-out (local)', () => {
	test('iOS token revocation destroys every session the user holds', async () => {
		await runOAuthRevokeFlow({
			baseURL: BASE_URL,
			// A user of its own so the parallel readlist-flow spec never loses its
			// session mid-run to this flow's sign-out-everywhere.
			email: 'oauth-revoke-e2e@example.com',
			password: 'test-password-123',
		})
	})
})
