import { test } from '@packages/e2e-harness'
import { requireEnv } from '@packages/require-env'
import { runDisconnectFlow } from './disconnect-flow'
import { runOAuthRevokeFlow } from './oauth-revoke-flow'

const BASE_URL = `http://localhost:${requireEnv('E2E_PORT')}`

test.describe('OAuth revoke sign-out (local)', () => {
	test('iOS sign-out ends only its own grant\'s sessions, keeping the web login and another iPhone signed in', async () => {
		await runOAuthRevokeFlow({
			baseURL: BASE_URL,
			email: 'oauth-revoke-e2e@example.com',
			password: 'test-password-123',
		})
	})

	test('disconnecting the Chrome extension from the account page refuses its refresh and keeps the web session', async () => {
		await runDisconnectFlow({
			baseURL: BASE_URL,
			email: 'oauth-disconnect-e2e@example.com',
			password: 'test-password-123',
		})
	})
})
