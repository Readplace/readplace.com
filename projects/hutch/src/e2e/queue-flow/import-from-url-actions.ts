import assert from 'node:assert/strict'
import { expect, type Page } from '@playwright/test'
import type { PageAction } from '../hateoas/navigation-handler.types'
import type { ImportFromUrlActionKey } from './action-catalog'
import { isOnPage, clickAndWaitForPageReload } from '../page-interactions'
import type { AuthProgress } from './auth-actions'
import type { QueueProgress } from './queue-actions'

export type ImportFromUrlProgress = {
	happyPathImported: boolean
	pageError500Surfaced: boolean
	pageWithoutLinksSurfaced: boolean
}

export type ImportFromUrlActionsConfig = { baseUrl: string }

async function openFromUrlPanel(page: Page, config: ImportFromUrlActionsConfig): Promise<void> {
	await page.goto(`${config.baseUrl}/import?mode=from-url&feature=import-link-public`, { waitUntil: 'domcontentloaded' })
}

async function submitUrl(page: Page, url: string): Promise<void> {
	await page.locator('[data-test-import-from-url-input]').fill(url)
	await clickAndWaitForPageReload(page, page.locator('[data-test-action="import-from-url-submit"]'))
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
}

export function createImportFromUrlActions(
	config: ImportFromUrlActionsConfig,
	queueProgress: QueueProgress,
	importFromUrlProgress: ImportFromUrlProgress,
): (authProgress: AuthProgress) => Record<ImportFromUrlActionKey, PageAction> {
	return (authProgress) => ({
		'import-from-url-happy-path': {
			isAvailable: async (page) => {
				if (!authProgress.loggedIn) return false
				if (!queueProgress.cleanupDeleted) return false
				if (importFromUrlProgress.happyPathImported) return false
				return isOnPage(page, 'page-queue')
			},
			execute: async (page) => {
				await openFromUrlPanel(page, config)
				await submitUrl(page, `${config.baseUrl}/e2e/fixtures/links-page/happy`)
				const summary = page.locator('[data-test-import-summary] .import__summary-count')
				await expect(summary).toHaveText('3')
				await commitAndAssertOnQueue(page)
				const flash = page.locator('[data-test-import-flash]')
				await expect(flash).toContainText('Imported 3')
				await deleteAllOnQueue(page)
				importFromUrlProgress.happyPathImported = true
			},
		},

		'import-from-url-page-returns-500': {
			isAvailable: async (page) => {
				if (!authProgress.loggedIn) return false
				if (!queueProgress.cleanupDeleted) return false
				if (!importFromUrlProgress.happyPathImported) return false
				if (importFromUrlProgress.pageError500Surfaced) return false
				return isOnPage(page, 'page-queue')
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
				if (!queueProgress.cleanupDeleted) return false
				if (!importFromUrlProgress.pageError500Surfaced) return false
				if (importFromUrlProgress.pageWithoutLinksSurfaced) return false
				return isOnPage(page, 'page-queue')
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
