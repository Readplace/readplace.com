import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import type { PageAction } from '../hateoas/navigation-handler.types'
import { clickAndWaitForPageReload, isOnPage } from '../page-interactions'

export type ExtendTrialActionKey =
	| 'login-as-admin'
	| 'open-extend-trial-page'
	| 'lookup-unknown-email'
	| 'lookup-founding-member'
	| 'lookup-target-user'
	| 'extend-target-trial'
	| 'override-extended-trial'

export type ExtendTrialProgress = {
	loggedInAsAdmin: boolean
	openedAdminPage: boolean
	unknownEmailReported: boolean
	foundingMemberRefused: boolean
	targetLookedUp: boolean
	trialExtended: boolean
	overrideVerified: boolean
}

export interface ExtendTrialConfig {
	baseURL: string
	admin: { email: string; password: string }
	target: { email: string }
	/** Zone-less datetime-local values the form posts, with the UTC ISO instants
	 * the re-read panel must echo back after the server commits them. */
	firstExtension: { input: string; iso: string }
	secondExtension: { input: string; iso: string }
}

async function submitLookup(page: Parameters<PageAction['execute']>[0], email: string): Promise<void> {
	await page.locator('#extend-trial-email').fill(email)
	await clickAndWaitForPageReload(page, page.locator('[data-test-extend-trial-lookup]'))
}

export function createExtendTrialActions(
	config: ExtendTrialConfig,
	progress: ExtendTrialProgress,
): Record<ExtendTrialActionKey, PageAction> {
	return {
		// The flow starts at /admin/extend-trial anonymously; the admin gate 303s
		// to /login, which is where this machine picks up.
		'login-as-admin': {
			isAvailable: async (page) => {
				if (progress.loggedInAsAdmin) return false
				return isOnPage(page, 'page-login')
			},
			execute: async (page) => {
				await page.locator('#email').fill(config.admin.email)
				await page.locator('#password').fill(config.admin.password)
				await clickAndWaitForPageReload(
					page,
					page.locator('[data-test-form="login"] button[type="submit"]'),
				)
				// The admin gate's redirect carries no ?return, so login lands on the
				// default /queue; the next action walks back to the admin page.
				await page.waitForSelector('body.page-queue')
				progress.loggedInAsAdmin = true
			},
		},

		'open-extend-trial-page': {
			isAvailable: async (page) => {
				if (!progress.loggedInAsAdmin) return false
				if (progress.openedAdminPage) return false
				return isOnPage(page, 'page-queue')
			},
			execute: async (page) => {
				await page.goto(`${config.baseURL}/admin/extend-trial`)
				await page.waitForSelector('body.page-admin-extend-trial')
				progress.openedAdminPage = true
			},
		},

		'lookup-unknown-email': {
			isAvailable: async (page) => {
				if (!progress.openedAdminPage) return false
				if (progress.unknownEmailReported) return false
				return isOnPage(page, 'page-admin-extend-trial')
			},
			execute: async (page) => {
				await submitLookup(page, 'nobody-e2e@example.com')
				await expect(page.locator('[data-test-extend-trial-not-found]')).toBeVisible()
				progress.unknownEmailReported = true
			},
		},

		// The admin account itself was created out-of-band (/e2e/users) and owns no
		// subscription row — a founding member, exactly what the page must refuse.
		'lookup-founding-member': {
			isAvailable: async (page) => {
				if (!progress.unknownEmailReported) return false
				if (progress.foundingMemberRefused) return false
				return isOnPage(page, 'page-admin-extend-trial')
			},
			execute: async (page) => {
				await submitLookup(page, config.admin.email)
				await expect(page.locator('[data-test-extend-trial-refusal]')).toContainText('founding member')
				progress.foundingMemberRefused = true
			},
		},

		// The target signed up through the real /signup handler, so the panel must
		// show the live trialing row that startTrial wrote (status + a real ISO
		// window) and prefill the picker from it.
		'lookup-target-user': {
			isAvailable: async (page) => {
				if (!progress.foundingMemberRefused) return false
				if (progress.targetLookedUp) return false
				return isOnPage(page, 'page-admin-extend-trial')
			},
			execute: async (page) => {
				await submitLookup(page, config.target.email)
				await expect(page.locator('[data-test-extend-trial-panel]')).toBeVisible()
				await expect(page.locator('[data-test-extend-trial-status]')).toHaveText('trialing')
				// Unanchored: regex matching does not normalize the template's
				// surrounding whitespace the way string matching does.
				await expect(page.locator('[data-test-extend-trial-current]')).toHaveText(
					/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
				)
				progress.targetLookedUp = true
			},
		},

		'extend-target-trial': {
			isAvailable: async (page) => {
				if (!progress.targetLookedUp) return false
				if (progress.trialExtended) return false
				try {
					const panel = await page.locator('[data-test-extend-trial-panel]').count()
					assert.ok(panel > 0, 'the extend form is only present once a user is looked up')
					return true
				} catch {
					return false
				}
			},
			execute: async (page) => {
				await page.locator('#extend-trial-ends-at').fill(config.firstExtension.input)
				await clickAndWaitForPageReload(page, page.locator('[data-test-extend-trial-submit]'))
				// POST → 303 → live re-read: the echoed window is the database row,
				// not the submitted form value.
				await expect(page.locator('[data-test-extend-trial-extended]')).toBeVisible()
				await expect(page.locator('[data-test-extend-trial-current]')).toHaveText(config.firstExtension.iso)
				progress.trialExtended = true
			},
		},

		// Submitting again with a different date must override, not conflict: the
		// in-memory scheduler rejects duplicate schedule names exactly like
		// EventBridge, so this only passes if the server deletes before it creates.
		'override-extended-trial': {
			isAvailable: async (page) => {
				if (!progress.trialExtended) return false
				if (progress.overrideVerified) return false
				try {
					const notice = await page.locator('[data-test-extend-trial-extended]').count()
					assert.ok(notice > 0, 'the override runs off the post-extension success page')
					return true
				} catch {
					return false
				}
			},
			execute: async (page) => {
				await page.locator('#extend-trial-ends-at').fill(config.secondExtension.input)
				await clickAndWaitForPageReload(page, page.locator('[data-test-extend-trial-submit]'))
				await expect(page.locator('[data-test-extend-trial-extended]')).toBeVisible()
				await expect(page.locator('[data-test-extend-trial-current]')).toHaveText(config.secondExtension.iso)
				progress.overrideVerified = true
			},
		},
	}
}
