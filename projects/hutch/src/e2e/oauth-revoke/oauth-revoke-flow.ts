import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { request as playwrightRequest } from '@playwright/test'

/** Drives the iOS sign-out contract end-to-end over plain HTTP, the way the
 * app does it: sign in, authorize the built-in `ios-app` PKCE client, mint
 * reader sessions from the bearer, then revoke — and prove every session the
 * user held is dead afterwards. Against staging this exercises the deployed
 * DynamoDB GSI + IAM grant that no fake-client unit test can reach. */
export async function runOAuthRevokeFlow(options: {
	baseURL: string
	email: string
	password: string
}): Promise<void> {
	const { baseURL, email, password } = options
	const browserJar = await playwrightRequest.newContext({ baseURL })
	const probe = await playwrightRequest.newContext({ baseURL })

	try {
		// Sign up (first run) or fall back to login (user already exists). The
		// loadedAt field must be old enough to clear the signup bot-defense gate.
		const signup = await browserJar.post('/signup', {
			form: {
				website: '',
				loadedAt: String(Date.now() - 8000),
				email,
				password,
				confirmPassword: password,
			},
			maxRedirects: 0,
		})
		if (signup.status() !== 303) {
			const login = await browserJar.post('/login', {
				form: { email, password },
				maxRedirects: 0,
			})
			assert.equal(login.status(), 303, 'signup said the account exists, so login must succeed')
		}
		const webSessionId = (await browserJar.storageState()).cookies
			.find((cookie) => cookie.name === 'hutch_sid')?.value
		assert(webSessionId, 'signing in must set the hutch_sid web session cookie')

		const verifier = randomBytes(48).toString('base64url').slice(0, 64)
		const authorize = await browserJar.post('/oauth/authorize', {
			form: {
				client_id: 'ios-app',
				redirect_uri: 'readplace://oauth-callback',
				response_type: 'code',
				code_challenge: createHash('sha256').update(verifier).digest('base64url'),
				code_challenge_method: 'S256',
				state: randomUUID(),
				action: 'approve',
			},
			maxRedirects: 0,
		})
		assert.equal(authorize.status(), 302, 'consent approval must redirect to the native callback')
		const callback = authorize.headers().location
		assert(callback?.startsWith('readplace://oauth-callback'), `unexpected callback: ${callback}`)
		const code = new URL(callback).searchParams.get('code')
		assert(code, 'the native callback must carry an authorization code')

		const tokenResponse = await browserJar.post('/oauth/token', {
			form: {
				grant_type: 'authorization_code',
				code,
				redirect_uri: 'readplace://oauth-callback',
				client_id: 'ios-app',
				code_verifier: verifier,
			},
		})
		assert.equal(tokenResponse.status(), 200, 'PKCE code exchange must succeed')
		const tokens: { access_token: string; refresh_token: string } = await tokenResponse.json()
		assert(tokens.access_token, 'token response must carry an access token')
		assert(tokens.refresh_token, 'token response must carry a refresh token')

		// One session per reader open — mint two, like opening two articles.
		const mintReaderSession = async (): Promise<string> => {
			const minted = await probe.post('/auth/session', {
				headers: { authorization: `Bearer ${tokens.access_token}` },
				maxRedirects: 0,
			})
			assert.equal(minted.status(), 204, 'minting a reader session from the bearer must succeed')
			const sessionCookie = minted
				.headersArray()
				.filter((header) => header.name.toLowerCase() === 'set-cookie')
				.map((header) => header.value)
				.find((value) => value.startsWith('hutch_sid='))
			assert(sessionCookie, 'minting must set hutch_sid')
			return sessionCookie.split(';')[0].slice('hutch_sid='.length)
		}
		const readerSessionA = await mintReaderSession()
		const readerSessionB = await mintReaderSession()

		const sessionStatus = async (sessionId: string): Promise<number> => {
			const response = await probe.get('/queue', {
				headers: { cookie: `hutch_sid=${sessionId}` },
				maxRedirects: 0,
			})
			return response.status()
		}

		assert.equal(await sessionStatus(webSessionId), 200, 'web session must be live before revoke')
		assert.equal(await sessionStatus(readerSessionA), 200, 'reader session A must be live before revoke')
		assert.equal(await sessionStatus(readerSessionB), 200, 'reader session B must be live before revoke')

		// iOS sign-out: revoke the refresh token.
		const revoke = await probe.post('/oauth/revoke', { data: { token: tokens.refresh_token } })
		assert.equal(revoke.status(), 200, 'revoke must return 200')

		assert.equal(await sessionStatus(webSessionId), 303, 'web session must be destroyed by the iOS revoke')
		assert.equal(await sessionStatus(readerSessionA), 303, 'reader session A must be destroyed by the iOS revoke')
		assert.equal(await sessionStatus(readerSessionB), 303, 'reader session B must be destroyed by the iOS revoke')

		const mintWithRevokedBearer = await probe.post('/auth/session', {
			headers: { authorization: `Bearer ${tokens.access_token}` },
			maxRedirects: 0,
		})
		assert.equal(mintWithRevokedBearer.status(), 401, 'the revoked bearer must not mint new sessions')
	} finally {
		await browserJar.dispose()
		await probe.dispose()
	}
}
