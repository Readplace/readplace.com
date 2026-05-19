import assert from 'node:assert/strict'
import { expect, type Page } from '@playwright/test'
import type { PageAction } from '../hateoas/navigation-handler.types'
import type { QueueActionKey, SaveArticleKey, PaginationArticleKey } from './action-catalog'
import { TEST_ARTICLE_COUNT, PAGINATION_ARTICLE_COUNT } from './action-catalog'
import { isOnPage, clickAndWaitForPageReload } from '../page-interactions'
import { retriable } from '../../retriable'
import type { AuthProgress } from './auth-actions'

export type QueueProgress = {
  allArticlesAdded: boolean
  paginationArticlesAdded: boolean
  verifiedPage1HasNext: boolean
  navigatedToPage2: boolean
  verifiedPage2: boolean
  navigatedBackToPage1: boolean
  verifiedBackOnPage1: boolean
  refreshedExistingArticle: boolean
  paginationArticlesDeleted: boolean
  verifiedNewestFirst: boolean
  sortedOldestFirst: boolean
  verifiedOldestFirst: boolean
  openedFirstArticle: boolean
  backFromReader: boolean
  verifiedReadStatus: boolean
  deletedLastArticle: boolean
  checkedReadTab: boolean
  checkedUnreadTab: boolean
  cleanupDeleted: boolean
}

export function createLocalTestArticles(baseUrl: string): TestArticleData {
  return {
    urls: [
      `${baseUrl}/blog/pocket-migration`,
      `${baseUrl}/blog/omnivore-alternative`,
      `${baseUrl}/blog/newsletter-overload`,
      `${baseUrl}/blog/ai-reading-assistant`,
    ],
    titles: [
      "Pocket Shut Down in 2025. Here's How to Recover and Move Your Reading List.",
      "Omnivore Shut Down. Here's a Read-It-Later App That Won't.",
      "You're Subscribed to 30 Newsletters. You Read 3. Here's a Better System.",
      "Readplace: An AI Reading Assistant That Helps You Read More, Not Less",
    ],
    paginationUrls: Array.from({ length: PAGINATION_ARTICLE_COUNT }, (_, i) => `${baseUrl}/privacy?p=${i + 1}`),
  }
}

export type TestArticleData = {
  urls: string[]
  titles: string[]
  paginationUrls: string[]
}

async function getArticleCount(page: Page): Promise<number> {
  return page.locator('[data-test-article]').count()
}

async function getArticleTitles(page: Page): Promise<string[]> {
  return page.locator('[data-test-article-title]').allTextContents()
}

export function createQueueActions(
  authProgress: AuthProgress,
  progress: QueueProgress,
  testData: TestArticleData,
): Record<QueueActionKey, PageAction> {
  assert.equal(
    testData.urls.length,
    TEST_ARTICLE_COUNT,
    `testData.urls.length must equal TEST_ARTICLE_COUNT (${TEST_ARTICLE_COUNT}) to match SaveArticleKey`,
  )
  assert.equal(
    testData.paginationUrls.length,
    PAGINATION_ARTICLE_COUNT,
    `testData.paginationUrls.length must equal PAGINATION_ARTICLE_COUNT (${PAGINATION_ARTICLE_COUNT}) to match PaginationArticleKey`,
  )

  const TEST_URLS = testData.urls
  const TEST_TITLES = testData.titles
  const TITLES_NEWEST_FIRST = [...TEST_TITLES].reverse()
  const TITLES_OLDEST_FIRST = [...TEST_TITLES]

  let articlesAdded = 0

  const makeSaveArticle = (i: number): PageAction => ({
    isAvailable: async (page) => {
      if (!authProgress.loggedIn) return false
      if (articlesAdded !== i) return false
      const onQueue = await isOnPage(page, 'page-queue')
      if (!onQueue) return false
      const saveForm = page.locator('[data-test-form="save-article"]')
      return saveForm.isVisible().catch(() => false)
    },
    execute: async (page) => {
      const input = page.locator('[data-test-form="save-article"] input[name="url"]')
      await input.fill(TEST_URLS[i])
      await clickAndWaitForPageReload(
        page,
        page.locator('[data-test-form="save-article"] button[type="submit"]'),
      )
      articlesAdded = i + 1
      if (articlesAdded === TEST_URLS.length) {
        progress.allArticlesAdded = true
      }
    },
  })

  const saveArticleEntries: Record<SaveArticleKey, PageAction> = {
    'save-article-1': makeSaveArticle(0),
    'save-article-2': makeSaveArticle(1),
    'save-article-3': makeSaveArticle(2),
    'save-article-4': makeSaveArticle(3),
  }

  let paginationArticlesAdded = 0

  const makePaginationSave = (i: number): PageAction => ({
    isAvailable: async (page) => {
      if (!progress.allArticlesAdded) return false
      if (paginationArticlesAdded !== i) return false
      const onQueue = await isOnPage(page, 'page-queue')
      if (!onQueue) return false
      const saveForm = page.locator('[data-test-form="save-article"]')
      return saveForm.isVisible().catch(() => false)
    },
    execute: async (page) => {
      const url = testData.paginationUrls[i]
      const slug = url.split('/').pop()
      assert.ok(slug, `pagination URL must have a trailing path segment: ${url}`)
      const submitAndVerify = retriable(
        async (p: Page): Promise<boolean> => {
          const input = p.locator('[data-test-form="save-article"] input[name="url"]')
          await input.fill(url)
          await clickAndWaitForPageReload(
            p,
            p.locator('[data-test-form="save-article"] button[type="submit"]'),
          )
          const latestHref = await p
            .locator('#latest-saved .queue-article__url')
            .first()
            .getAttribute('href')
            .catch(/* c8 ignore next */ () => null)
          return latestHref?.includes(slug) === true
        },
        {
          maxAttempts: 3,
          retryDelayMs: 2000,
          shouldRetry: (saved: boolean) => !saved,
        },
      )
      const saved = await submitAndVerify(page)
      assert.ok(saved, `pagination save did not land for ${url} after 3 attempts`)
      paginationArticlesAdded = i + 1
      if (paginationArticlesAdded === testData.paginationUrls.length) {
        progress.paginationArticlesAdded = true
      }
    },
  })

  const paginationEntries: Record<PaginationArticleKey, PageAction> = {
    'save-pagination-article-1': makePaginationSave(0),
    'save-pagination-article-2': makePaginationSave(1),
    'save-pagination-article-3': makePaginationSave(2),
    'save-pagination-article-4': makePaginationSave(3),
    'save-pagination-article-5': makePaginationSave(4),
    'save-pagination-article-6': makePaginationSave(5),
    'save-pagination-article-7': makePaginationSave(6),
    'save-pagination-article-8': makePaginationSave(7),
    'save-pagination-article-9': makePaginationSave(8),
    'save-pagination-article-10': makePaginationSave(9),
    'save-pagination-article-11': makePaginationSave(10),
    'save-pagination-article-12': makePaginationSave(11),
    'save-pagination-article-13': makePaginationSave(12),
    'save-pagination-article-14': makePaginationSave(13),
    'save-pagination-article-15': makePaginationSave(14),
    'save-pagination-article-16': makePaginationSave(15),
    'save-pagination-article-17': makePaginationSave(16),
  }

  return {
    ...saveArticleEntries,
    ...paginationEntries,

    'verify-page1-has-next': {
      isAvailable: async (page) => {
        if (!progress.paginationArticlesAdded) return false
        if (progress.verifiedPage1HasNext) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        const pagination = page.locator('[data-test-pagination]')
        await expect(pagination).toBeVisible()

        const info = page.locator('[data-test-pagination-info]')
        const infoText = await info.textContent()
        assert.ok(infoText?.includes('Page 1'), `Expected page info to include "Page 1", got "${infoText}"`)

        const nextLink = page.locator('[data-test-pagination-next]')
        await expect(nextLink).toBeVisible()

        const articleCount = await getArticleCount(page)
        assert.equal(articleCount, 20, 'Page 1 should show 20 articles')

        progress.verifiedPage1HasNext = true
      },
    },

    'navigate-to-page2': {
      isAvailable: async (page) => {
        if (!progress.verifiedPage1HasNext) return false
        if (progress.navigatedToPage2) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        await clickAndWaitForPageReload(page, page.locator('[data-test-pagination-next]'))
        progress.navigatedToPage2 = true
      },
    },

    'verify-page2': {
      isAvailable: async (page) => {
        if (!progress.navigatedToPage2) return false
        if (progress.verifiedPage2) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        const info = page.locator('[data-test-pagination-info]')
        const infoText = await info.textContent()
        assert.ok(infoText?.includes('Page 2'), `Expected page info to include "Page 2", got "${infoText}"`)

        const prevLink = page.locator('[data-test-pagination-prev]')
        await expect(prevLink).toBeVisible()

        const articleCount = await getArticleCount(page)
        assert.equal(articleCount, 1, 'Page 2 should show exactly 1 article (21 total, 20 per page)')

        progress.verifiedPage2 = true
      },
    },

    'navigate-back-to-page1': {
      isAvailable: async (page) => {
        if (!progress.verifiedPage2) return false
        if (progress.navigatedBackToPage1) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        await clickAndWaitForPageReload(page, page.locator('[data-test-pagination-prev]'))
        progress.navigatedBackToPage1 = true
      },
    },

    'verify-back-on-page1': {
      isAvailable: async (page) => {
        if (!progress.navigatedBackToPage1) return false
        if (progress.verifiedBackOnPage1) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        const info = page.locator('[data-test-pagination-info]')
        const infoText = await info.textContent()
        assert.ok(infoText?.includes('Page 1'), `Expected page info to include "Page 1", got "${infoText}"`)

        const articleCount = await getArticleCount(page)
        assert.equal(articleCount, 20, 'Page 1 should show 20 articles after navigating back')

        progress.verifiedBackOnPage1 = true
      },
    },

    'resave-existing-article-triggers-refresh': {
      isAvailable: async (page) => {
        if (!progress.verifiedBackOnPage1) return false
        if (progress.refreshedExistingArticle) return false
        if (!(await isOnPage(page, 'page-queue'))) return false
        const saveForm = page.locator('[data-test-form="save-article"]')
        return saveForm.isVisible().catch(() => false)
      },
      execute: async (page) => {
        const cardsBefore = await page.locator('.queue-article').count()

        // Re-save an already-saved URL so refreshArticleIfStale takes the
        // handleFullFetch branch and publishes publishRefreshArticleContent.
        // Pagination URLs point to the local server, so the fetch is deterministic.
        const input = page.locator('[data-test-form="save-article"] input[name="url"]')
        await input.fill(testData.paginationUrls[0])
        await clickAndWaitForPageReload(
          page,
          page.locator('[data-test-form="save-article"] button[type="submit"]'),
        )

        const cardsAfter = await page.locator('.queue-article').count()
        assert.equal(cardsAfter, cardsBefore, 'Re-saving an existing URL must not duplicate the article')

        progress.refreshedExistingArticle = true
      },
    },

    'delete-pagination-articles': {
      isAvailable: async (page) => {
        if (!progress.verifiedBackOnPage1) return false
        if (!progress.refreshedExistingArticle) return false
        if (progress.paginationArticlesDeleted) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        const targetCount = TEST_URLS.length
        let cards = await page.locator('.queue-article').count()

        while (cards > targetCount) {
          await clickAndWaitForPageReload(page, page.locator('[data-test-action="delete"]').first())
          cards = await page.locator('.queue-article').count()
        }

        progress.paginationArticlesDeleted = true
      },
    },

    'verify-newest-first-order': {
      isAvailable: async (page) => {
        if (!progress.paginationArticlesDeleted) return false
        if (progress.verifiedNewestFirst) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        const titles = await retriable(getArticleTitles, {
          maxAttempts: 5,
          retryDelayMs: 3000,
          shouldRetry: (result) => result.length !== TITLES_NEWEST_FIRST.length,
          // c8 ignore: beforeRetry only executes on CI when article parsing is slow
          beforeRetry: /* c8 ignore next */ async (p) => { await p.reload({ waitUntil: 'domcontentloaded' }) },
        })(page)
        expect(titles).toEqual(TITLES_NEWEST_FIRST)
        progress.verifiedNewestFirst = true
      },
    },

    'sort-oldest-first': {
      isAvailable: async (page) => {
        if (!progress.verifiedNewestFirst) return false
        if (progress.sortedOldestFirst) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        await clickAndWaitForPageReload(page, page.locator('[data-test-sort]'))
        progress.sortedOldestFirst = true
      },
    },

    'verify-oldest-first-order': {
      isAvailable: async (page) => {
        if (!progress.sortedOldestFirst) return false
        if (progress.verifiedOldestFirst) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        const titles = await getArticleTitles(page)
        expect(titles).toEqual(TITLES_OLDEST_FIRST)
        progress.verifiedOldestFirst = true
      },
    },

    'read-first-article': {
      isAvailable: async (page) => {
        if (!progress.verifiedOldestFirst) return false
        if (progress.openedFirstArticle) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        const firstArticle = page.locator('[data-test-article]').first()
        const hasUnreadClass = await firstArticle.evaluate(
          el => el.classList.contains('queue-article--unread'),
        )
        expect(hasUnreadClass).toBe(true)

        await page.locator('[data-test-article-title]').first().click()
        await page.waitForLoadState('domcontentloaded')

        const onReader = await isOnPage(page, 'page-reader')
        expect(onReader).toBe(true)

        progress.openedFirstArticle = true
      },
    },

    'go-back-to-queue': {
      isAvailable: async (page) => {
        if (!progress.openedFirstArticle) return false
        if (progress.backFromReader) return false
        return isOnPage(page, 'page-reader')
      },
      execute: async (page) => {
        await page.goto('/queue?order=asc', { waitUntil: 'domcontentloaded' })
        progress.backFromReader = true
      },
    },

    'verify-first-is-read': {
      isAvailable: async (page) => {
        if (!progress.backFromReader) return false
        if (progress.verifiedReadStatus) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        const articleCount = await getArticleCount(page)
        expect(articleCount).toBe(3)

        progress.verifiedReadStatus = true
      },
    },

    'delete-last-article': {
      isAvailable: async (page) => {
        if (!progress.verifiedReadStatus) return false
        if (progress.deletedLastArticle) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        const deleteButtons = page.locator('[data-test-action="delete"]')
        const count = await deleteButtons.count()
        await clickAndWaitForPageReload(page, deleteButtons.nth(count - 1))
        progress.deletedLastArticle = true
      },
    },

    'check-read-tab': {
      isAvailable: async (page) => {
        if (!progress.deletedLastArticle) return false
        if (progress.checkedReadTab) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        await clickAndWaitForPageReload(page, page.locator('[data-test-filter="read"]'))

        const count = await getArticleCount(page)
        expect(count).toBe(1)

        const titles = await getArticleTitles(page)
        expect(titles).toEqual([TEST_TITLES[0]])

        progress.checkedReadTab = true
      },
    },

    'check-unread-tab': {
      isAvailable: async (page) => {
        if (!progress.checkedReadTab) return false
        if (progress.checkedUnreadTab) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
        await clickAndWaitForPageReload(page, page.locator('[data-test-filter="unread"]'))

        const count = await getArticleCount(page)
        expect(count).toBe(2)

        const titles = await getArticleTitles(page)
        expect(titles).toEqual([TEST_TITLES[1], TEST_TITLES[2]])

        progress.checkedUnreadTab = true
      },
    },

    'cleanup-delete-all': {
      isAvailable: async (page) => {
        if (!progress.checkedUnreadTab) return false
        if (progress.cleanupDeleted) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
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

        progress.cleanupDeleted = true
      },
    },
  }
}
