import { expect } from '@playwright/test'
import {
  COOKIE_NAME,
  COOKIE_VALUE,
  SAVE_COOKIE_NAME,
  SAVE_COOKIE_VALUE,
} from '@packages/onboarding-extension-signal'
import type { PageAction } from '../hateoas/navigation-handler.types'
import type { OnboardingActionKey } from './action-catalog'
import type { AuthProgress } from './auth-actions'

export type OnboardingProgress = {
  installedExtension: boolean
  savedFirstArticle: boolean
}

/** TODO: Once Chrome extension v1.0.108+ is published and the bypass in
 * onboarding.steps.ts is removed, restore the per-step `data-test-onboarding-complete`
 * checks in isAvailable and the post-reload assertion in execute (see git
 * history for the pre-bypass implementation). Playwright runs as Chromium so
 * under the bypass the install/save step elements never render — gating on
 * `[data-test-onboarding]` instead lets the cookie-set + reload path work
 * unchanged for both bypass and non-bypass.
 * https://chromewebstore.google.com/detail/hutch-%E2%80%94-save-articles-rea/klblengmhlfnmjoagchagfcdbpbocgbf
 */
export function createOnboardingActions(
  progress: OnboardingProgress,
): (authProgress: AuthProgress) => Record<OnboardingActionKey, PageAction> {
  return (authProgress) => ({
    'onboarding-install-extension-incomplete': {
      isAvailable: async (page) => {
        if (!authProgress.accountCreated) return false
        if (progress.installedExtension) return false
        return (await page.locator('[data-test-onboarding]').count()) > 0
      },
      execute: async (page) => {
        await page.context().addCookies([{
          name: COOKIE_NAME,
          value: COOKIE_VALUE,
          path: '/',
          domain: new URL(page.url()).hostname,
        }])
        await page.reload({ waitUntil: 'domcontentloaded' })
        progress.installedExtension = true
      },
    },

    'onboarding-save-first-article': {
      isAvailable: async (page) => {
        if (!authProgress.accountCreated) return false
        if (!progress.installedExtension) return false
        if (progress.savedFirstArticle) return false
        return (await page.locator('[data-test-onboarding]').count()) > 0
      },
      execute: async (page) => {
        // Stand in for the extension calling POST /queue: in production the
        // server sets SAVE_COOKIE_NAME on the Siren save response. Adding it
        // here directly avoids running the full extension stack in this flow.
        await page.context().addCookies([{
          name: SAVE_COOKIE_NAME,
          value: SAVE_COOKIE_VALUE,
          path: '/',
          domain: new URL(page.url()).hostname,
        }])
        await page.reload({ waitUntil: 'domcontentloaded' })

        const container = page.locator('[data-test-onboarding]')
        await expect(container).toHaveClass(/onboarding--complete/)

        const success = page.locator('[data-test-onboarding-success]')
        await expect(success).toBeVisible()

        progress.savedFirstArticle = true
      },
    },
  })
}
