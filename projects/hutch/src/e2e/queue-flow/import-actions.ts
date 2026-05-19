import assert from 'node:assert/strict'
import { expect, type Page } from '@playwright/test'
import type { PageAction } from '../hateoas/navigation-handler.types'
import type { ImportActionKey } from './action-catalog'
import { isOnPage, clickAndWaitForPageReload } from '../page-interactions'
import type { AuthProgress } from './auth-actions'
import type { QueueProgress } from './queue-actions'

export type ImportProgress = {
	allThreeImported: boolean
	middleUncheckedImported: boolean
	selectAllDeselectSomeImported: boolean
	deselectAllSelectSomeImported: boolean
	paginatedSelectAllSpansPagesImported: boolean
}

export type ImportActionsConfig = { baseUrl: string }

async function uploadUrlsAndOpenReview(
	page: Page,
	config: ImportActionsConfig,
	urls: string[],
): Promise<void> {
	await page.goto(`${config.baseUrl}/import`, { waitUntil: 'domcontentloaded' })
	await page.locator('[data-test-import-file-input]').setInputFiles({
		name: 'links.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from(urls.join('\n'), 'utf-8'),
	})
	await page.waitForSelector('[data-test-import-list]')
}

async function expectSummary(page: Page, expected: string): Promise<void> {
	const summary = page.locator('[data-test-import-summary] .import__summary-count')
	await expect(summary).toHaveText(expected)
}

async function commitAndAssertOnQueue(page: Page): Promise<void> {
	await clickAndWaitForPageReload(page, page.locator('[data-test-action="import-commit"]'))
	const onQueue = await isOnPage(page, 'page-queue')
	assert.ok(onQueue, 'commit must redirect to /queue')
}

async function deleteAllOnQueue(page: Page): Promise<void> {
	let count = await page.locator('[data-test-action="delete"]').count()
	while (count > 0) {
		await clickAndWaitForPageReload(page, page.locator('[data-test-action="delete"]').first())
		count = await page.locator('[data-test-action="delete"]').count()
	}
	await clickAndWaitForPageReload(page, page.locator('[data-test-filter="read"]'))
	count = await page.locator('[data-test-action="delete"]').count()
	while (count > 0) {
		await clickAndWaitForPageReload(page, page.locator('[data-test-action="delete"]').first())
		count = await page.locator('[data-test-action="delete"]').count()
	}
}

function threeUrls(baseUrl: string, label: string): string[] {
	return [1, 2, 3].map((i) => `${baseUrl}/privacy?import-${label}-${i}`)
}

function fourUrls(baseUrl: string, label: string): string[] {
	return [1, 2, 3, 4].map((i) => `${baseUrl}/privacy?import-${label}-${i}`)
}

function paginationUrls(baseUrl: string): string[] {
	return Array.from({ length: 75 }, (_, i) => `${baseUrl}/privacy?import-s5-${i + 1}`)
}

export function createImportActions(
	config: ImportActionsConfig,
	queueProgress: QueueProgress,
	importProgress: ImportProgress,
): (authProgress: AuthProgress) => Record<ImportActionKey, PageAction> {
	return (authProgress) => ({
		'import-all-three-checked': {
			isAvailable: async (page) => {
				if (!authProgress.loggedIn) return false
				if (!queueProgress.cleanupDeleted) return false
				if (importProgress.allThreeImported) return false
				return isOnPage(page, 'page-queue')
			},
			execute: async (page) => {
				const urls = threeUrls(config.baseUrl, 's1')
				await uploadUrlsAndOpenReview(page, config, urls)
				await expectSummary(page, '3')
				await commitAndAssertOnQueue(page)
				const cards = await page.locator('[data-test-article]').count()
				assert.equal(cards, 3, 'all-three-checked: expected 3 cards on /queue')
				await deleteAllOnQueue(page)
				importProgress.allThreeImported = true
			},
		},

		'import-middle-unchecked': {
			isAvailable: async (page) => {
				if (!authProgress.loggedIn) return false
				if (!queueProgress.cleanupDeleted) return false
				if (!importProgress.allThreeImported) return false
				if (importProgress.middleUncheckedImported) return false
				return isOnPage(page, 'page-queue')
			},
			execute: async (page) => {
				const urls = threeUrls(config.baseUrl, 's2')
				await uploadUrlsAndOpenReview(page, config, urls)
				await expectSummary(page, '3')
				await clickAndWaitForPageReload(page, page.locator('[data-test-import-checkbox="1"]'))
				await expectSummary(page, '2')
				const middleHasChecked = await page
					.locator('[data-test-import-row="1"]')
					.evaluate((el) => el.classList.contains('import__row--checked'))
				assert.equal(middleHasChecked, false, 'middle row must lose import__row--checked after uncheck')
				await commitAndAssertOnQueue(page)
				const cards = await page.locator('[data-test-article]').count()
				assert.equal(cards, 2, 'middle-unchecked: expected 2 cards on /queue')
				await deleteAllOnQueue(page)
				importProgress.middleUncheckedImported = true
			},
		},

		'import-select-all-deselect-some': {
			isAvailable: async (page) => {
				if (!authProgress.loggedIn) return false
				if (!queueProgress.cleanupDeleted) return false
				if (!importProgress.middleUncheckedImported) return false
				if (importProgress.selectAllDeselectSomeImported) return false
				return isOnPage(page, 'page-queue')
			},
			execute: async (page) => {
				const urls = fourUrls(config.baseUrl, 's3')
				await uploadUrlsAndOpenReview(page, config, urls)
				await expectSummary(page, '4')
				await clickAndWaitForPageReload(page, page.locator('[data-test-import-select-all]'))
				await expectSummary(page, '0')
				await clickAndWaitForPageReload(page, page.locator('[data-test-import-select-all]'))
				await expectSummary(page, '4')
				await clickAndWaitForPageReload(page, page.locator('[data-test-import-checkbox="0"]'))
				await expectSummary(page, '3')
				await clickAndWaitForPageReload(page, page.locator('[data-test-import-checkbox="2"]'))
				await expectSummary(page, '2')
				await commitAndAssertOnQueue(page)
				const cards = await page.locator('[data-test-article]').count()
				assert.equal(cards, 2, 'select-all-deselect-some: expected 2 cards on /queue')
				await deleteAllOnQueue(page)
				importProgress.selectAllDeselectSomeImported = true
			},
		},

		'import-deselect-all-select-some': {
			isAvailable: async (page) => {
				if (!authProgress.loggedIn) return false
				if (!queueProgress.cleanupDeleted) return false
				if (!importProgress.selectAllDeselectSomeImported) return false
				if (importProgress.deselectAllSelectSomeImported) return false
				return isOnPage(page, 'page-queue')
			},
			execute: async (page) => {
				const urls = fourUrls(config.baseUrl, 's4')
				await uploadUrlsAndOpenReview(page, config, urls)
				await expectSummary(page, '4')
				await clickAndWaitForPageReload(page, page.locator('[data-test-import-select-all]'))
				await expectSummary(page, '0')
				await clickAndWaitForPageReload(page, page.locator('[data-test-import-checkbox="1"]'))
				await expectSummary(page, '1')
				await clickAndWaitForPageReload(page, page.locator('[data-test-import-checkbox="3"]'))
				await expectSummary(page, '2')
				await commitAndAssertOnQueue(page)
				const cards = await page.locator('[data-test-article]').count()
				assert.equal(cards, 2, 'deselect-all-select-some: expected 2 cards on /queue')
				await deleteAllOnQueue(page)
				importProgress.deselectAllSelectSomeImported = true
			},
		},

		'import-paginated-select-all-spans-pages': {
			isAvailable: async (page) => {
				if (!authProgress.loggedIn) return false
				if (!queueProgress.cleanupDeleted) return false
				if (!importProgress.deselectAllSelectSomeImported) return false
				if (importProgress.paginatedSelectAllSpansPagesImported) return false
				return isOnPage(page, 'page-queue')
			},
			execute: async (page) => {
				const urls = paginationUrls(config.baseUrl)
				await uploadUrlsAndOpenReview(page, config, urls)

				const paginationInfo = page.locator('.import__pagination-info')
				await expect(paginationInfo).toContainText('Page 1 of 2')
				const page1Checkboxes = page.locator('[data-test-import-checkbox]')
				await expect(page1Checkboxes).toHaveCount(50)
				await expectSummary(page, '75')

				await clickAndWaitForPageReload(page, page.locator('[data-test-import-select-all]'))
				await expectSummary(page, '0')
				for (let i = 0; i < 50; i++) {
					const checked = await page1Checkboxes.nth(i).isChecked()
					assert.equal(checked, false, `page 1 checkbox ${i} must be unchecked after toggle-all off`)
				}

				await clickAndWaitForPageReload(page, page.locator('[data-test-import-pagination-next]'))
				await expect(paginationInfo).toContainText('Page 2 of 2')
				const page2Checkboxes = page.locator('[data-test-import-checkbox]')
				await expect(page2Checkboxes).toHaveCount(25)
				await expectSummary(page, '0')
				for (let i = 0; i < 25; i++) {
					const checked = await page2Checkboxes.nth(i).isChecked()
					assert.equal(checked, false, `page 2 checkbox ${i} must be unchecked — toggle-all on page 1 must span pagination`)
				}

				await clickAndWaitForPageReload(page, page.locator('[data-test-import-select-all]'))
				await expectSummary(page, '75')
				for (let i = 0; i < 25; i++) {
					const checked = await page2Checkboxes.nth(i).isChecked()
					assert.equal(checked, true, `page 2 checkbox ${i} must be checked after toggle-all on`)
				}

				await clickAndWaitForPageReload(page, page.locator('[data-test-import-pagination-prev]'))
				await expect(paginationInfo).toContainText('Page 1 of 2')
				const page1AfterReturn = page.locator('[data-test-import-checkbox]')
				await expect(page1AfterReturn).toHaveCount(50)
				for (let i = 0; i < 50; i++) {
					const checked = await page1AfterReturn.nth(i).isChecked()
					assert.equal(checked, true, `page 1 checkbox ${i} must be checked after toggle-all on page 2 — must span pagination`)
				}

				await commitAndAssertOnQueue(page)
				const queueInfo = page.locator('[data-test-pagination-info]')
				await expect(queueInfo).toContainText('Page 1 of 4')
				const visibleCards = await page.locator('[data-test-article]').count()
				assert.equal(visibleCards, 20, 'paginated-import: /queue page 1 must show 20 cards (75 total ÷ 20/page)')

				importProgress.paginatedSelectAllSpansPagesImported = true
			},
		},
	})
}
