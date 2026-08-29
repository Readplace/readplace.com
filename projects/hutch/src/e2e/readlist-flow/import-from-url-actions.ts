import assert from 'node:assert/strict'
import { expect, type Page } from '@playwright/test'
import type { PageAction } from '../hateoas/navigation-handler.types'
import type { ImportFromUrlActionKey } from './action-catalog'
import { isOnPage, clickAndWaitForPageReload, deleteArticleWithConfirmation } from '../page-interactions'
import type { AuthProgress } from './auth-actions'
import type { ReadlistProgress } from './readlist-actions'

export type ImportFromUrlProgress = {
	happyPathImported: boolean
	pageError500Surfaced: boolean
	pageWithoutLinksSurfaced: boolean
}

export type ImportFromUrlActionsConfig = { baseUrl: string }

async function openFromUrlPanel(page: Page, config: ImportFromUrlActionsConfig): Promise<void> {
	await page.goto(`${config.baseUrl}/import`, { waitUntil: 'domcontentloaded' })
}

async function submitUrl(page: Page, url: string): Promise<void> {
	// The anonymous view action proceeds through /save, which records the save
	// tip; without that this fill would open it over the box.
	await expect(page.locator('[data-test-form="import-from-url"]')).toHaveAttribute(
		'data-save-tip',
		'seen',
	)
	await page.locator('[data-test-import-from-url-input]').fill(url)
	await clickAndWaitForPageReload(page, page.locator('[data-test-action="import-from-url-submit"]'))
}

async function commitAndAssertOnReadlist(page: Page): Promise<void> {
	await clickAndWaitForPageReload(page, page.locator('[data-test-action="import-commit"]'))
	const onReadlist = await isOnPage(page, 'page-readlist')
	assert.ok(onReadlist, 'commit must redirect to /queue')
}

async function deleteAllOnReadlist(page: Page): Promise<void> {
	let count = await page.locator('[data-test-action="delete"]').count()
	while (count > 0) {
		await deleteArticleWithConfirmation(page, page.locator('[data-test-action="delete"]').first())
		count = await page.locator('[data-test-action="delete"]').count()
	}
}

export function createImportFromUrlActions(
	config: ImportFromUrlActionsConfig,
	readlistProgress: ReadlistProgress,
	importFromUrlProgress: ImportFromUrlProgress,
): (authProgress: AuthProgress) => Record<ImportFromUrlActionKey, PageAction> {
	return (authProgress) => ({
		'import-from-url-happy-path': {
			isAvailable: async (page) => {
				if (!authProgress.loggedIn) return false
				if (!readlistProgress.cleanupDeleted) return false
				if (importFromUrlProgress.happyPathImported) return false
				return isOnPage(page, 'page-readlist')
			},
			execute: async (page) => {
				await openFromUrlPanel(page, config)
				await submitUrl(page, `${config.baseUrl}/e2e/fixtures/links-page/happy`)
				const summary = page.locator('[data-test-import-summary] .import__summary-count')
				await expect(summary).toHaveText('3')
				await commitAndAssertOnReadlist(page)
				const flash = page.locator('[data-test-import-flash]')
				await expect(flash).toContainText('Imported 3')
				await deleteAllOnReadlist(page)
				importFromUrlProgress.happyPathImported = true
			},
		},

		'import-from-url-page-returns-500': {
			isAvailable: async (page) => {
				if (!authProgress.loggedIn) return false
				if (!readlistProgress.cleanupDeleted) return false
				if (!importFromUrlProgress.happyPathImported) return false
				if (importFromUrlProgress.pageError500Surfaced) return false
				return isOnPage(page, 'page-readlist')
			},
			execute: async (page) => {
				await openFromUrlPanel(page, config)
				await submitUrl(page, `${config.baseUrl}/e2e/fixtures/links-page-error`)
				const error = page.locator('[data-test-import-error]')
				await expect(error).toContainText("couldn't fetch")
				await page.goto(`${config.baseUrl}/queue`, { waitUntil: 'domcontentloaded' })
				importFromUrlProgress.pageError500Surfaced = true
			},
		},

		'import-from-url-page-has-no-links': {
			isAvailable: async (page) => {
				if (!authProgress.loggedIn) return false
				if (!readlistProgress.cleanupDeleted) return false
				if (!importFromUrlProgress.pageError500Surfaced) return false
				if (importFromUrlProgress.pageWithoutLinksSurfaced) return false
				return isOnPage(page, 'page-readlist')
			},
			execute: async (page) => {
				await openFromUrlPanel(page, config)
				await submitUrl(page, `${config.baseUrl}/e2e/fixtures/links-page-empty`)
				const error = page.locator('[data-test-import-error]')
				await expect(error).toContainText("outbound links")
				await page.goto(`${config.baseUrl}/queue`, { waitUntil: 'domcontentloaded' })
				importFromUrlProgress.pageWithoutLinksSurfaced = true
			},
		},
	})
}
