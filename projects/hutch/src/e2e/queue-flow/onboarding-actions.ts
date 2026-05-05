import { createHash, randomBytes } from 'node:crypto'
import { expect } from '@playwright/test'
import { COOKIE_NAME, COOKIE_VALUE } from '@packages/onboarding-extension-signal'
import type { PageAction } from '../hateoas/navigation-handler.types'
import type { OnboardingActionKey } from './action-catalog'
import type { AuthProgress } from './auth-actions'

export type OnboardingProgress = {
  installedExtension: boolean
  savedViaExtension: boolean
  persistedAfterLogin: boolean
}

export interface OnboardingConfig {
  sirenSaveUrl: string
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('hex')
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  return { codeVerifier, codeChallenge }
}

export function createOnboardingActions(
  progress: OnboardingProgress,
  config: OnboardingConfig,
): (authProgress: AuthProgress) => Record<OnboardingActionKey, PageAction> {
  return (authProgress) => ({
    'onboarding-install-extension-incomplete': {
      isAvailable: async (page) => {
        if (!authProgress.accountCreated) return false
        if (progress.installedExtension) return false
        return (await page.locator('[data-test-onboarding-step="install-extension"]').count()) > 0
      },
      execute: async (page) => {
        const step = page.locator('[data-test-onboarding-step="install-extension"]')
        await expect(step).toHaveAttribute('data-test-onboarding-complete', 'false')

        await page.context().addCookies([{
          name: COOKIE_NAME,
          value: COOKIE_VALUE,
          path: '/',
          domain: new URL(page.url()).hostname,
        }])
        await page.reload({ waitUntil: 'domcontentloaded' })

        const stillIncomplete = await page.locator(
          '[data-test-onboarding-step="install-extension"][data-test-onboarding-complete="false"]',
        ).count()
        expect(stillIncomplete).toBe(0)

        progress.installedExtension = true
      },
    },

    'onboarding-save-via-extension': {
      isAvailable: async (page) => {
        if (!authProgress.accountCreated) return false
        if (!progress.installedExtension) return false
        if (progress.savedViaExtension) return false
        return (await page.locator('[data-test-onboarding-step="save-via-extension"][data-test-onboarding-complete="false"]').count()) > 0
      },
      execute: async (page) => {
        const step = page.locator('[data-test-onboarding-step="save-via-extension"]')
        await expect(step).toHaveAttribute('data-test-onboarding-complete', 'false')

        const origin = new URL(page.url()).origin
        const redirectUri = 'http://127.0.0.1:3000/oauth/callback'
        const { codeVerifier, codeChallenge } = generatePKCE()

        const authRes = await page.request.post(`${origin}/oauth/authorize`, {
          form: {
            client_id: 'hutch-firefox-extension',
            redirect_uri: redirectUri,
            response_type: 'code',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            state: 'e2e',
          },
          maxRedirects: 0,
        })
        const location = authRes.headers().location
        expect(location).toContain('code=')
        const code = new URL(location).searchParams.get('code')
        expect(code).toBeTruthy()

        const tokenRes = await page.request.post(`${origin}/oauth/token`, {
          form: {
            grant_type: 'authorization_code',
            code: code as string,
            code_verifier: codeVerifier,
            client_id: 'hutch-firefox-extension',
            redirect_uri: redirectUri,
          },
        })
        const tokenData = await tokenRes.json()
        expect(tokenData.access_token).toBeTruthy()

        const saveRes = await page.request.post(`${origin}/queue`, {
          headers: {
            'Accept': 'application/vnd.siren+json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokenData.access_token}`,
          },
          data: { url: config.sirenSaveUrl },
        })
        expect(saveRes.status()).toBe(201)

        await page.reload({ waitUntil: 'domcontentloaded' })

        const container = page.locator('[data-test-onboarding]')
        await expect(container).toHaveClass(/onboarding--complete/)

        const success = page.locator('[data-test-onboarding-success]')
        await expect(success).toBeVisible()

        progress.savedViaExtension = true
      },
    },

    'onboarding-persisted-after-login': {
      isAvailable: async (page) => {
        if (!authProgress.loggedIn) return false
        if (progress.persistedAfterLogin) return false
        return (await page.locator('[data-test-onboarding].onboarding--complete').count()) > 0
      },
      execute: async (page) => {
        const container = page.locator('[data-test-onboarding]')
        await expect(container).toHaveClass(/onboarding--complete/)

        const success = page.locator('[data-test-onboarding-success]')
        await expect(success).toBeVisible()

        progress.persistedAfterLogin = true
      },
    },
  })
}
