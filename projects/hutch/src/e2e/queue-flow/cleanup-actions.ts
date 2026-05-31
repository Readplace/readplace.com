import type { Page } from '@playwright/test'
import type { PageAction } from '../hateoas/navigation-handler.types'
import type { CleanupActionKey } from './action-catalog'
import { isOnPage, clickAndWaitForPageReload } from '../page-interactions'
import type { AuthProgress } from './auth-actions'

export type CleanupProgress = {
  previousArticlesDeleted: boolean
}

/** The queue lists from the eventually-consistent userId-savedAt-index GSI, so a
 * save can still be propagating when the queue is first read — a queue that
 * reads as empty here may be stale. Settle past the propagation window before
 * the confirming re-read so a just-saved article is not left behind. */
const GSI_PROPAGATION_SETTLE_MS = 2000

async function deleteAllVisibleArticles(page: Page): Promise<void> {
  let count = await page.locator('[data-test-action="delete"]').count()
  while (count > 0) {
    await clickAndWaitForPageReload(page, page.locator('[data-test-action="delete"]').first())
    count = await page.locator('[data-test-action="delete"]').count()
  }
}

async function clearCurrentTab(page: Page): Promise<void> {
  await deleteAllVisibleArticles(page)
  await page.waitForTimeout(GSI_PROPAGATION_SETTLE_MS)
  await page.reload()
  await deleteAllVisibleArticles(page)
}

export function createCleanupActions(
  cleanupProgress: CleanupProgress,
): (authProgress: AuthProgress) => Record<CleanupActionKey, PageAction> {
  return (authProgress) => ({
    'cleanup-previous-articles': {
      isAvailable: async (page) => {
        if (!authProgress.loggedIn) return false
        if (cleanupProgress.previousArticlesDeleted) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        await clearCurrentTab(page)

        await page.goto('/queue?tab=done', { waitUntil: 'domcontentloaded' })
        await clearCurrentTab(page)

        cleanupProgress.previousArticlesDeleted = true
      },
    },
  })
}
