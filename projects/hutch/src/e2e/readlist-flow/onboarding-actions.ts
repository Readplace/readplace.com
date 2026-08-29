import { expect } from '@playwright/test'
import {
	ALIVE_COOKIE_NAME,
	ALIVE_COOKIE_VALUE,
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

export function createOnboardingActions(
	progress: OnboardingProgress,
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
					name: ALIVE_COOKIE_NAME,
					value: ALIVE_COOKIE_VALUE,
					path: '/',
					domain: new URL(page.url()).hostname,
				}])
				await page.reload({ waitUntil: 'domcontentloaded' })

				// After reload, install-extension is complete; save-first-article is
				// independently gated on a save through the extension's Siren endpoint,
				// which onboarding-save-first-article simulates next.
				const stillIncomplete = await page.locator(
					'[data-test-onboarding-step="install-extension"][data-test-onboarding-complete="false"]',
				).count()
				expect(stillIncomplete).toBe(0)

				const completedStep = page.locator('[data-test-onboarding-step="install-extension"]')
				await expect(completedStep).toBeAttached()
				await expect(completedStep).toBeHidden()
				await expect(
					page.locator('[data-test-onboarding-step="save-first-article-via-extension"]'),
				).toBeVisible()

				progress.installedExtension = true
			},
		},

		'onboarding-save-first-article': {
			isAvailable: async (page) => {
				if (!authProgress.accountCreated) return false
				if (!progress.installedExtension) return false
				if (progress.savedFirstArticle) return false
				const step = page.locator('[data-test-onboarding-step="save-first-article-via-extension"][data-test-onboarding-complete="false"]')
				return (await step.count()) > 0
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

				const savedStep = page.locator(
					'[data-test-onboarding-step="save-first-article-via-extension"]',
				)
				await expect(savedStep).toHaveAttribute('data-test-onboarding-complete', 'true')
				await expect(savedStep).toBeHidden()

				// The Next Read milestone needs a readlist this flow can't build in a
				// browser run, so the success card stays out of reach here; it is
				// covered by readlist-onboarding-next-read.route.test.ts instead.
				const milestoneStep = page.locator(
					'[data-test-onboarding-step="save-enough-for-next-read"]',
				)
				await expect(milestoneStep).toHaveAttribute('data-test-onboarding-complete', 'false')
				await expect(milestoneStep).toBeVisible()

				progress.savedFirstArticle = true
			},
		},
	})
}
