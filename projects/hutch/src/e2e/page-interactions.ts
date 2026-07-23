import type { Page } from '@playwright/test'

export function isOnPage(page: Page, bodyClass: string): Promise<boolean> {
	return page.locator(`body.${bodyClass}`).count().then(count => count > 0).catch(() => false)
}

export async function clickAndWaitForPageReload(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
	const loadEvent = page.waitForEvent('load')
	await locator.click()
	await Promise.race([
		// Full page navigation (non-HTMX links, standard form submits)
		loadEvent,
		// HTMX: wait for htmx-request to appear then disappear, then wait for
		// network to go idle. HTMX may schedule the DOM swap asynchronously after
		// removing htmx-request; networkidle ensures the swap and any follow-up
		// requests (e.g. redirects) have fully completed before we return.
		page.waitForSelector('.htmx-request', { state: 'attached', timeout: 5000 })
			.then(() => page.waitForSelector('.htmx-request', { state: 'detached', timeout: 60000 }))
			.then(() => page.waitForLoadState('networkidle'))
			.catch(() => page.waitForLoadState('networkidle')),
	])
}
