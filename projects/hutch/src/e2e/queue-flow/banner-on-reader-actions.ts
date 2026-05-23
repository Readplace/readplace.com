import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import type { PageAction } from '../hateoas/navigation-handler.types'
import type { BannerOnReaderActionKey } from './action-catalog'
import { isOnPage, clickAndWaitForPageReload } from '../page-interactions'
import type { AuthProgress } from './auth-actions'
import type { CleanupProgress } from './cleanup-actions'

export type BannerOnReaderProgress = {
	bannerVerifiedOnPublicView: boolean
	bannerVerifiedOnPrivateReader: boolean
	bannerTestArticleDeleted: boolean
}

/** Exercises both reader-view triggers for the extension-suggestion banner
 * from an *authenticated* session:
 *
 *   1. Public reader `/view/<url>` — anonymous and authenticated users share
 *      the same route; the existing anonymous flow covers it logged-out, so
 *      this proves the logged-in path also triggers the banner.
 *   2. Owner reader `/queue/:id/view` — the only authenticated-only trigger.
 *
 * The banner's visibility class is applied by the client script after
 * DOMContentLoaded, so only a real browser proves the SSR data attribute,
 * the client wiring, and the close-button affordance all line up. Route
 * tests cover the SSR side; this file covers the rendered state. */
export function createBannerOnReaderActions(
	config: { baseUrl: string; publicViewTestUrl: string; privateReaderTestUrl: string },
	cleanupProgress: CleanupProgress,
	progress: BannerOnReaderProgress,
): (authProgress: AuthProgress) => Record<BannerOnReaderActionKey, PageAction> {
	return (authProgress) => ({
		'verify-banner-on-public-view': {
			isAvailable: async (page) => {
				try {
					assert.ok(authProgress.loggedIn, 'user must be logged in')
					assert.ok(
						cleanupProgress.previousArticlesDeleted,
						'queue must be clean so we are at a known entry state',
					)
					assert.ok(!progress.bannerVerifiedOnPublicView, 'public-view banner already verified')
					const onQueue = await isOnPage(page, 'page-queue')
					assert.ok(onQueue, 'must be on /queue')
					return true
				} catch {
					return false
				}
			},
			execute: async (page) => {
				// Use the per-run unique URL the callsite supplies. API Gateway on
				// staging strips arbitrary query strings, so a `?ts=${Date.now()}`
				// trick collapses every run back to the same path and the cached
				// row pins `summaryStatus='ready'` → banner never shows. The /e2e
				// fixture URL pattern (used in run.e2e-staging.ts) avoids this by
				// embedding the runId in the path itself.
				await page.goto(
					`${config.baseUrl}/view/${encodeURIComponent(config.publicViewTestUrl)}`,
					{ waitUntil: 'domcontentloaded' },
				)
				const onPublicView = await isOnPage(page, 'page-view')
				assert.ok(onPublicView, '/view/<url> must render the public reader page')

				// Anchored to a body-direct child because saved Readplace-hosted
				// HTML keeps the entire `<div class="banner-area"><banner></div>`
				// chrome wrapper inside the article reader slot; a descendant
				// selector would still match both copies. The outer banner-area
				// is body's first DOM child per base.template.html.
				const banner = page.locator('body > .banner-area [data-test-extension-suggestion-banner]')
				await expect(banner).toHaveAttribute('data-show-extension-suggestion', 'true')
				await expect(banner).toHaveClass(/extension-suggestion-banner--visible/)

				// Return to /queue so subsequent actions see the default entry state.
				await page.goto(`${config.baseUrl}/queue`, { waitUntil: 'domcontentloaded' })

				progress.bannerVerifiedOnPublicView = true
			},
		},

		'save-and-verify-banner-on-private-reader': {
			isAvailable: async (page) => {
				try {
					assert.ok(authProgress.loggedIn, 'user must be logged in')
					assert.ok(
						cleanupProgress.previousArticlesDeleted,
						'queue must be empty before saving the banner-test article',
					)
					assert.ok(
						progress.bannerVerifiedOnPublicView,
						'public-view banner check should run first',
					)
					assert.ok(!progress.bannerVerifiedOnPrivateReader, 'private-reader banner check already done')
					const onQueue = await isOnPage(page, 'page-queue')
					assert.ok(onQueue, 'must be on /queue')
					return true
				} catch {
					return false
				}
			},
			execute: async (page) => {
				const input = page.locator('[data-test-form="save-article"] input[name="url"]')
				await input.fill(config.privateReaderTestUrl)
				await clickAndWaitForPageReload(
					page,
					page.locator('[data-test-form="save-article"] button[type="submit"]'),
				)

				const card = page.locator('[data-test-article]').first()
				await expect(card).toBeVisible()

				await clickAndWaitForPageReload(
					page,
					page.locator('[data-test-article-title]').first(),
				)

				const onReader = await isOnPage(page, 'page-reader')
				assert.ok(onReader, 'clicking the saved article must navigate to the owner reader')

				// Same body-direct-child anchor as verify-banner-on-public-view —
				// the saved article's reader slot replays the chrome wrapper too.
				const banner = page.locator('body > .banner-area [data-test-extension-suggestion-banner]')
				await expect(banner).toHaveAttribute('data-show-extension-suggestion', 'true')
				await expect(banner).toHaveClass(/extension-suggestion-banner--visible/)

				// Verify the banner stays put until the user dismisses it, then
				// confirm the close button removes it and persists the dismiss
				// flag so it doesn't re-appear on subsequent visits.
				await banner.locator('[data-extension-suggestion-close]').click()
				await expect(banner).not.toHaveClass(/extension-suggestion-banner--visible/)
				const dismissed = await page.evaluate(() =>
					window.localStorage.getItem('readplace.extension-suggestion-dismissed'),
				)
				assert.equal(dismissed, '1', 'close button must persist the dismiss flag')

				// Return to /queue so the cleanup action can find the delete button.
				await page.goto(`${config.baseUrl}/queue`, { waitUntil: 'domcontentloaded' })

				progress.bannerVerifiedOnPrivateReader = true
			},
		},

		'cleanup-banner-test-article': {
			isAvailable: async (page) => {
				try {
					assert.ok(
						progress.bannerVerifiedOnPrivateReader,
						'private-reader banner must be verified before cleanup',
					)
					assert.ok(!progress.bannerTestArticleDeleted, 'already cleaned up')
					const onQueue = await isOnPage(page, 'page-queue')
					assert.ok(onQueue, 'must be on /queue')
					return true
				} catch {
					return false
				}
			},
			execute: async (page) => {
				// The reader no longer auto-marks articles as read, so the
				// article is still in the default unread tab — delete directly.
				await clickAndWaitForPageReload(
					page,
					page.locator('[data-test-action="delete"]').first(),
				)
				progress.bannerTestArticleDeleted = true
			},
		},
	})
}
