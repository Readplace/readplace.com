import assert from 'node:assert/strict'
import { expect, type Locator, type Page } from '@playwright/test'

export function isOnPage(page: Page, bodyClass: string): Promise<boolean> {
	return page.locator(`body.${bodyClass}`).count().then(count => count > 0).catch(() => false)
}

/** A queue card re-fetches itself every 3s until its crawl is terminal, so with
 * several pending cards the page never gets the 500ms of silence networkidle
 * needs and the wait never returns. Give up on the quiet and carry on: callers
 * re-poll their own state, whereas an unbounded wait ends the whole run. */
function settleQuietly(page: Page): Promise<void> {
	return page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined)
}

export async function clickAndWaitForPageReload(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
	const loadEvent = page.waitForEvent('load')
	await locator.click()
	await Promise.race([
		// Full page navigation (non-HTMX links, standard form submits)
		loadEvent,
		// HTMX: wait for htmx-request to appear then disappear, then let the
		// network settle. HTMX may schedule the DOM swap asynchronously after
		// removing htmx-request, so the settle covers the swap and any follow-up
		// requests (e.g. redirects) before we return.
		page.waitForSelector('.htmx-request', { state: 'attached', timeout: 750 })
			.then(() => page.waitForSelector('.htmx-request', { state: 'detached', timeout: 15000 }))
			.then(() => settleQuietly(page))
			.catch(() => settleQuietly(page)),
	])
}

/**
 * Deleting takes two clicks now. Opening the confirmation navigates nothing and
 * issues no htmx request, so clickAndWaitForPageReload would burn its
 * fallback and return with the popover still open — and because
 * popovertargetaction defaults to Toggle, the caller's next click would close it
 * again and nothing would ever be deleted.
 *
 * The confirm control is scoped to this trigger's own popover: every article
 * renders one, so an unscoped locator matches them all, and `.first()` would
 * silently confirm the wrong article. `[id="…"]` rather than `#…` because an
 * article hash may start with a digit, which is not a legal CSS ident.
 */
export async function deleteArticleWithConfirmation(page: Page, trigger: Locator): Promise<void> {
	const popoverId = await trigger.getAttribute('popovertarget')
	assert.ok(popoverId, 'the delete trigger must reference its confirmation popover')
	const confirm = page.locator(`[id="${popoverId}"] [data-test-action="delete-confirm"]`)
	// Explicit timeout: the suite sets no actionTimeout, so the default is 0 and
	// an unactionable trigger would hang to the whole test's budget.
	await trigger.click({ timeout: 15000 })
	await expect(confirm).toBeVisible()
	await clickAndWaitForPageReload(page, confirm)
	await expect(page.locator(`[id="${popoverId}"]`)).toHaveCount(0, { timeout: 15000 })
}
