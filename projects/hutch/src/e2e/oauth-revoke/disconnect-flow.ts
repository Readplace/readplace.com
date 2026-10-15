import assert from 'node:assert/strict'
import { type APIRequestContext, request as playwrightRequest } from '@playwright/test'
import { JSDOM } from 'jsdom'
import { z } from 'zod'
import { seedChromeGrant } from './seed-grant'

const CHROME_CLIENT_ID = 'hutch-chrome-extension'

const RefusedRefresh = z.object({ error: z.string() })

async function connectedApps(browserJar: APIRequestContext): Promise<Element> {
	const account = await browserJar.get('/account', { maxRedirects: 0 })
	assert.equal(account.status(), 200, 'the signed-in reader must load the account page')
	const section = new JSDOM(await account.text()).window.document.querySelector('[data-test-connected-apps]')
	assert(section, 'the account page must render its Connected apps section')
	return section
}

export async function runDisconnectFlow(options: {
	baseURL: string
	email: string
	password: string
}): Promise<void> {
	const { baseURL, email, password } = options
	const browserJar = await playwrightRequest.newContext({ baseURL })

	try {
		const signup = await browserJar.post('/signup', {
			form: {
				website: '',
				loadedAt: String(Date.now() - 8000),
				email,
				password,
			},
			maxRedirects: 0,
		})
		assert.equal(signup.status(), 303, 'signup must create the account or sign in to the existing one')
		const { refreshToken } = await seedChromeGrant(browserJar, baseURL)

		const chromeRow = (await connectedApps(browserJar)).querySelector(
			`[data-test-connected-app-client="${CHROME_CLIENT_ID}"]`,
		)
		assert(chromeRow, 'the account page must list the Chrome extension the reader just signed in to')
		assert.equal(chromeRow.getAttribute('data-test-connected-app'), 'chrome', 'the listed row must be the Chrome row')

		const disconnect = await browserJar.post(`/account/connected-apps/${CHROME_CLIENT_ID}/disconnect`, {
			maxRedirects: 0,
		})
		assert.equal(disconnect.status(), 303, 'a Disconnect must answer with a redirect')
		assert.equal(disconnect.headers().location, '/account#connected-apps', 'a Disconnect must land back on Connected apps')

		const refresh = await browserJar.post('/oauth/token', {
			form: {
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				client_id: CHROME_CLIENT_ID,
			},
		})
		assert.equal(refresh.status(), 400, 'the disconnected extension must not refresh its token')
		assert.equal(RefusedRefresh.parse(await refresh.json()).error, 'invalid_grant', 'the refusal must be invalid_grant')

		const remaining = await connectedApps(browserJar)
		assert.equal(
			remaining.getAttribute('data-test-connected-apps-state'),
			'empty',
			'the account page must list nothing once its only app is disconnected',
		)
	} finally {
		await browserJar.dispose()
	}
}
