import { expect } from '@playwright/test'
import type { PageAction } from '../hateoas/navigation-handler.types'
import type { SavePermalinkActionKey } from './action-catalog'
import { isOnPage, clickAndWaitForPageReload } from '../page-interactions'
import type { AuthProgress } from './auth-actions'
import type { CleanupProgress } from './cleanup-actions'

export type SavePermalinkProgress = {
	savedViaPermalink: boolean
	deletedPermalinkArticle: boolean
}

export function createSavePermalinkActions(
	config: { baseUrl: string; testUrl: string },
	cleanupProgress: CleanupProgress,
	progress: SavePermalinkProgress,
): (authProgress: AuthProgress) => Record<SavePermalinkActionKey, PageAction> {
	return (authProgress) => ({
		'save-via-permalink': {
			isAvailable: async (page) => {
				if (!authProgress.loggedIn) return false
				if (!cleanupProgress.previousArticlesDeleted) return false
				if (progress.savedViaPermalink) return false
				return isOnPage(page, 'page-queue')
			},
			execute: async (page) => {
				const saveUrl = `${config.baseUrl}/save?url=${encodeURIComponent(config.testUrl)}`
				await page.goto(saveUrl)

				await page.waitForSelector('[data-test-article]', { timeout: 30000 })

				const count = await page.locator('[data-test-article]').count()
				expect(count).toBe(1)

				progress.savedViaPermalink = true
			},
		},

		'delete-permalink-article': {
			isAvailable: async (page) => {
				if (!progress.savedViaPermalink) return false
				if (progress.deletedPermalinkArticle) return false
				return isOnPage(page, 'page-queue')
			},
			execute: async (page) => {
				await clickAndWaitForPageReload(page, page.locator('[data-test-action="delete"]').first())

				// The delete propagates to the eventually-consistent queue GSI
				// asynchronously, so the first post-redirect render can still list the
				// article. Reload a fresh read until the empty-queue marker appears
				// rather than asserting once against a possibly-stale render.
				await expect(async () => {
					await page.reload()
					await expect(page.locator('[data-test-empty-queue]')).toBeVisible({ timeout: 2000 })
				}).toPass({ timeout: 30000 })

				progress.deletedPermalinkArticle = true
			},
		},
	})
}
