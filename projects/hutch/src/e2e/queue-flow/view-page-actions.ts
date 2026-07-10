import { expect } from '@playwright/test'
import type { PageAction } from '../hateoas/navigation-handler.types'
import type { ViewPageActionKey } from './action-catalog'
import { clickAndWaitForPageReload, isOnPage } from '../page-interactions'
import type { AuthProgress } from './auth-actions'

export type ViewPageProgress = {
	visitedAnonymously: boolean
	visitedCrawlFailure: boolean
}

export function createAnonymousViewPageActions(
	config: { baseUrl: string; testUrl: string; unfetchableUrl?: string },
	progress: ViewPageProgress,
): (authProgress: AuthProgress) => Record<ViewPageActionKey, PageAction> {
	return (authProgress) => ({
		'anonymous-visit-view-page-crawl-fails': {
			isAvailable: async (page) => {
				if (authProgress.accountCreated) return false
				if (progress.visitedCrawlFailure) return false
				if (!config.unfetchableUrl) return false
				return isOnPage(page, 'page-home')
			},
			execute: async (page) => {
				// Unique per-run query param so the crawl always hits the fixture
				// (bypasses any cached-article short-circuit). The `unfetchableUrl`
				// is a bare path with no query string of its own.
				const target = `${config.unfetchableUrl}?e2e=${Date.now()}`
				await page.goto(
					`${config.baseUrl}/view/${encodeURIComponent(target)}`,
					{ waitUntil: 'domcontentloaded' },
				)
				await expect(page.locator('body.page-view')).toHaveCount(1)

				// Reader slot must reach crawl-failed terminal state. With the
				// in-memory test fixture applyParseResult marks failure
				// synchronously, so the SSR response already carries the failed
				// status and no HTMX poll wait is required.
				await expect(
					page.locator('[data-test-reader-slot][data-reader-status="failed"]'),
				).toHaveCount(1)

				// Regression guard: when the crawl fails, the summary slot must
				// collapse to skipped (hidden) rather than sit on "Generating
				// summary…" indefinitely. Without this check the bug that stuck
				// the hex.ooo row at summaryStatus=pending would re-emerge unseen.
				const summarySlot = page.locator('[data-test-reader-summary]')
				await expect(summarySlot).toHaveAttribute('data-summary-status', 'skipped')

				// Return to the guest homepage. A guest hitting `/` runs the client-side
				// A/B split redirect to a byte-identical landing arm (same body.page-home).
				// `goto` resolves at commit (before the deferred redirect can interrupt
				// it); the body.page-home assertion retries across the redirect until the
				// terminal document lands. We assert the terminal body.page-home rather
				// than the arm URL so the documented kill switch stays honest: flipping
				// HOMEPAGE_SPLIT.active off keeps the guest on `/` (also body.page-home),
				// so this unrelated flow stays green instead of hanging until timeout on
				// a redirect that never fires.
				await page.goto(`${config.baseUrl}/`, { waitUntil: 'commit' })
				await expect(page.locator('body.page-home')).toHaveCount(1, { timeout: 15000 })
				progress.visitedCrawlFailure = true
			},
		},
		'anonymous-visit-view-page': {
			isAvailable: async (page) => {
				if (authProgress.accountCreated) return false
				if (progress.visitedAnonymously) return false
				return isOnPage(page, 'page-home')
			},
			execute: async (page) => {
				// Force a URL the staging DB hasn't seen before, so the crawl + summary
				// actually go through pending → ready. Reusing a cached URL would miss
				// the specific regression this flow guards against (summary slot never
				// reaching the DOM until a full page refresh).
				const separator = config.testUrl.includes('?') ? '&' : '?'
				const freshTestUrl = `${config.testUrl}${separator}e2e=${Date.now()}`
				await page.goto(
					`${config.baseUrl}/view/${encodeURIComponent(freshTestUrl)}`,
					{ waitUntil: 'domcontentloaded' },
				)

				const saveAction = page.getByRole('link', { name: 'Save to My Queue' })
				await expect(page.locator('body.page-view')).toHaveCount(1)
				await expect(page.locator('[data-test-reader-title]')).toBeVisible()
				await expect(saveAction).toBeVisible()

				// Summary slot must render in the SSR HTML from t=0 (even while the
				// crawl is still pending) so its own HTMX poll is already attached to
				// the DOM. The reader-slot poll only swaps its own <div>; without the
				// summary slot rendered up-front, the summary would only appear after
				// a full page refresh. Regression guard for that specific UX bug.
				const summarySlot = page.locator('[data-test-reader-summary]')
				await expect(summarySlot).toHaveCount(1)
				// Transition out of pending via the summary slot's own HTMX poll —
				// no navigation, no reload. Staging hits the real Deepseek API (slow);
				// locally test-app fakes the same pending → ready transition with a
				// short setTimeout so this assertion works end-to-end in both envs.
				await expect(summarySlot).toHaveAttribute(
					'data-summary-status',
					/^(ready|skipped|failed)$/,
					{ timeout: 180_000 },
				)

				// Share balloon: scroll past the threshold, wait for it to animate in,
				// dismiss it, and confirm localStorage persists the dismiss so the
				// balloon stays closed across the reload below.
				//
				// Summary polls OOB-swap the reader-slot, replacing the iframe.
				// A client script re-sizes it on load, but there is a
				// window between the swap and the load event where the iframe has
				// no explicit height. If we scroll during that window, the article
				// body is short and scrollTo falls short of the 50 % threshold.
				// Wait for the iframe to be sized before scrolling.
				await expect(page.locator('iframe[data-reader-iframe]')).toHaveAttribute(
					'style', /height:\s*\d+px/, { timeout: 5000 },
				)
				const shareWrap = page.locator('[data-test-share-balloon-wrap]')
				await expect(shareWrap).toHaveCount(1)
				await expect(shareWrap).not.toHaveClass(/share-balloon__wrap--open/)
				await expect(async () => {
					await page.evaluate(() => {
						const article = document.querySelector<HTMLElement>('[data-article-body]')
						const height = article ? article.offsetHeight : 0
						window.scrollTo(0, Math.ceil(height * 0.5) + 1)
					})
					await expect(shareWrap).toHaveClass(/share-balloon__wrap--open/, { timeout: 2000 })
				}).toPass({ timeout: 10000 })
				await page.locator('[data-test-share-balloon-close]').click()
				await expect(shareWrap).not.toHaveClass(/share-balloon__wrap--open/)
				const dismissed = await page.evaluate(() =>
					window.localStorage.getItem('readplace.share-dismissed'),
				)
				expect(dismissed).toBe('1')

				// Reload the /view/<encoded-url> permalink. First visit primes the
				// global article cache via saveArticleGlobally; refresh then re-reads
				// it through findArticleByUrl. Regression guard for the ZodError that
				// surfaced when the DynamoDB projection omitted `url` while the row
				// schema required it — the first load succeeded (item absent, no
				// parse) but the refresh 500'd (item present, parse failed).
				await page.reload({ waitUntil: 'domcontentloaded' })
				await expect(page.locator('body.page-view')).toHaveCount(1)
				await expect(page.locator('[data-test-reader-title]')).toBeVisible()
				await expect(saveAction).toBeVisible()

				// Share dismiss persists across reload: scrolling past the threshold
				// again must NOT re-open the balloon. Wait past the 1s OPEN_DELAY_MS
				// so a would-be setTimeout has had its chance to fire.
				await page.evaluate(() => {
					const article = document.querySelector<HTMLElement>('[data-article-body]')
					const height = article ? article.offsetHeight : 0
					window.scrollTo(0, Math.ceil(height * 0.5) + 1)
				})
				await page.waitForTimeout(1500)
				await expect(shareWrap).not.toHaveClass(/share-balloon__wrap--open/)

				// Click Save as anonymous — /save redirects to /signup?return=/save?url=...
				// (account creation converts an anonymous saver far better than the
				// sign-in page), so submit-signup-form picks up directly from page-signup.
				await clickAndWaitForPageReload(page, saveAction)
				await expect(page.locator('body.page-signup')).toHaveCount(1)

				progress.visitedAnonymously = true
			},
		},
	})
}
