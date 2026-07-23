import assert from 'node:assert'
import type { PageAction } from '../hateoas/navigation-handler.types'
import type { SeedActionKey } from './action-catalog'
import { SEED_ARTICLE_COUNT } from './action-catalog'
import { isOnPage, clickAndWaitForPageReload } from '../page-interactions'
import type { AuthProgress } from './auth-actions'

export type SeedProgress = {
	articlesSeeded: boolean
}

export function createSeedActions(
	seedProgress: SeedProgress,
	seedUrls: string[],
): (authProgress: AuthProgress) => Record<SeedActionKey, PageAction> {
	assert.equal(
		seedUrls.length,
		SEED_ARTICLE_COUNT,
		`seedUrls.length must equal SEED_ARTICLE_COUNT (${SEED_ARTICLE_COUNT}) to match SeedActionKey`,
	)
	return (authProgress) => {
		let articlesSeeded = 0

		const makeAction = (i: number): PageAction => ({
			isAvailable: async (page) => {
				if (!authProgress.accountCreated) return false
				if (authProgress.loggedOut) return false
				if (articlesSeeded !== i) return false
				return isOnPage(page, 'page-queue')
			},
			execute: async (page) => {
				const input = page.locator('[data-test-form="save-article"] input[name="url"]')
				await input.fill(seedUrls[i])
				await clickAndWaitForPageReload(
					page,
					page.locator('[data-test-form="save-article"] button[type="submit"]'),
				)
				articlesSeeded = i + 1
				if (articlesSeeded === seedUrls.length) {
					seedProgress.articlesSeeded = true
				}
			},
		})

		return {
			'seed-article-1': makeAction(0),
			'seed-article-2': makeAction(1),
		}
	}
}
