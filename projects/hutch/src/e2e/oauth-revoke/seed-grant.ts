import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { z } from 'zod'

const CHROME_CLIENT_ID = 'hutch-chrome-extension'
const CHROME_CALLBACK = 'http://127.0.0.1:3000/oauth/callback'

const IssuedTokens = z.object({ refresh_token: z.string() })

export async function seedChromeGrant(request: APIRequestContext, baseUrl: string): Promise<{ refreshToken: string }> {
	const verifier = randomBytes(48).toString('base64url').slice(0, 64)
	const authorize = await request.post(`${baseUrl}/oauth/authorize`, {
		form: {
			client_id: CHROME_CLIENT_ID,
			redirect_uri: CHROME_CALLBACK,
			response_type: 'code',
			code_challenge: createHash('sha256').update(verifier).digest('base64url'),
			code_challenge_method: 'S256',
			state: randomUUID(),
			action: 'approve',
		},
		maxRedirects: 0,
	})
	assert.equal(authorize.status(), 302, 'consent approval must redirect to the extension callback')
	const callback = authorize.headers().location
	assert(callback, 'consent approval must name the callback it redirects to')
	assert(callback.startsWith(CHROME_CALLBACK), `unexpected callback: ${callback}`)
	const code = new URL(callback).searchParams.get('code')
	assert(code, 'the extension callback must carry an authorization code')

	const exchange = await request.post(`${baseUrl}/oauth/token`, {
		form: {
			grant_type: 'authorization_code',
			code,
			redirect_uri: CHROME_CALLBACK,
			client_id: CHROME_CLIENT_ID,
			code_verifier: verifier,
		},
	})
	assert.equal(exchange.status(), 200, 'PKCE code exchange must succeed')
	return { refreshToken: IssuedTokens.parse(await exchange.json()).refresh_token }
}
