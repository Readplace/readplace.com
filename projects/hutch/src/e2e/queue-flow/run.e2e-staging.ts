/* c8 ignore start -- staging E2E test, only run in CI */
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { test } from '@playwright/test'
import type { PageAction } from '../hateoas/navigation-handler.types'
import {
  IMPORT_ACTION_KEYS,
  ONBOARDING_ACTION_KEYS,
  PASSWORD_RESET_ACTION_KEYS,
  SEED_ACTION_KEYS,
} from './action-catalog'
import { createBannerOnReaderActions, type BannerOnReaderProgress } from './banner-on-reader-actions'
import { createCleanupActions, type CleanupProgress } from './cleanup-actions'
import type { ImportProgress } from './import-actions'
import { createSavePermalinkActions, type SavePermalinkProgress } from './save-permalink-actions'
import { createAnonymousViewPageActions, type ViewPageProgress } from './view-page-actions'
import type { OnboardingProgress } from './onboarding-actions'
import type { PasswordResetProgress } from './password-reset-actions'
import type { SeedProgress } from './seed-actions'
import type { QueueProgress, TestArticleData } from './queue-actions'
import { runQueueFlow } from './queue-flow'

// No-op factory for action groups that staging legitimately cannot exercise
// (e.g. password reset needs /e2e/sent-emails, onboarding needs an extension
// cookie signal). Declaring the same keys as local preserves action-key
// parity at compile time via the exhaustive *_ACTION_KEYS tuples.
const SKIP_ACTION: PageAction = {
  isAvailable: async () => false,
  execute: async () => { /* staging-skipped action, never runs */ },
}
function skipFactory<K extends string>(
  keys: readonly K[],
): () => Record<K, PageAction> {
  return () => {
    const result = {} as Record<K, PageAction>
    for (const key of keys) {
      result[key] = SKIP_ACTION
    }
    return result
  }
}

test.describe('Queue management flow (staging)', () => {
  test('signup, logout, login, add articles, pagination, sort, read, delete, verify tabs', async ({ page, baseURL }) => {
    assert(baseURL, "baseURL must be defined — set STAGING_URL env var")

    // Each CI run gets its own runId so every article URL the test feeds into
    // /save and /view is unique. Reusing a shared URL across runs (e.g.
    // ${baseURL}/privacy?view=1, which API Gateway strips back to
    // ${baseURL}/privacy) would let one broken run strand the row at
    // summaryStatus=pending and brick every subsequent run on the cached state.
    // The /e2e/article/:id route on hutch returns the same fixture body for
    // every :id, so unique paths produce unique articles without needing a
    // separate static page per slot. randomUUID over Date.now() so two runs
    // scheduled in the same millisecond cannot collide.
    const runId = randomUUID()
    const fixtureUrl = (slug: string): string => `${baseURL}/e2e/article/${runId}-${slug}`
    const FIXTURE_TITLE = 'Readplace E2E test fixture article'

    const cleanupProgress: CleanupProgress = {
      previousArticlesDeleted: false,
    }

    const savePermalinkProgress: SavePermalinkProgress = {
      savedViaPermalink: false,
      deletedPermalinkArticle: false,
    }

    const bannerOnReaderProgress: BannerOnReaderProgress = {
      bannerVerifiedOnPublicView: false,
      bannerVerifiedOnPrivateReader: false,
      bannerTestArticleDeleted: false,
    }

    const viewPageProgress: ViewPageProgress = {
      visitedAnonymously: false,
      // Staging has no deterministic crawl-failure endpoint (/e2e/unfetchable
      // is local-only), so mark the crawl-failure leg complete up front. Its
      // action skips itself via the missing `unfetchableUrl` config option.
      visitedCrawlFailure: true,
    }

    // All-true stubs: staging skips these flows (no /e2e/sent-emails endpoint,
    // no seed URLs, no extension cookie signal), so mark their progress as
    // complete up front. The paired skipFactory below keeps action-key parity
    // with local by registering no-op actions under the same keys.
    const onboardingProgress: OnboardingProgress = {
      installedExtension: true,
      savedFirstArticle: true,
    }

    const seedProgress: SeedProgress = {
      articlesSeeded: true,
    }

    const passwordResetProgress: PasswordResetProgress = {
      navigatedToForgotPassword: true,
      submittedForgotPassword: true,
      navigatedToResetPassword: true,
      submittedResetPassword: true,
      loggedInWithNewPassword: true,
    }

    const importProgress: ImportProgress = {
      allThreeImported: true,
      middleUncheckedImported: true,
      selectAllDeselectSomeImported: true,
      deselectAllSelectSomeImported: true,
      paginatedSelectAllSpansPagesImported: true,
    }

    const queueProgress: QueueProgress = {
      allArticlesAdded: false,
      paginationArticlesAdded: false,
      verifiedPage1HasNext: false,
      navigatedToPage2: false,
      verifiedPage2: false,
      navigatedBackToPage1: false,
      verifiedBackOnPage1: false,
      refreshedExistingArticle: false,
      paginationArticlesDeleted: false,
      verifiedNewestFirst: false,
      sortedOldestFirst: false,
      verifiedOldestFirst: false,
      openedFirstArticle: false,
      backFromReader: false,
      verifiedReadStatus: false,
      deletedLastArticle: false,
      checkedReadTab: false,
      checkedUnreadTab: false,
      cleanupDeleted: false,
    }

    const stagingArticles: TestArticleData = {
      urls: [
        fixtureUrl('queue-1'),
        fixtureUrl('queue-2'),
        fixtureUrl('queue-3'),
        fixtureUrl('queue-4'),
      ],
      titles: [FIXTURE_TITLE, FIXTURE_TITLE, FIXTURE_TITLE, FIXTURE_TITLE],
      paginationUrls: Array.from({ length: 17 }, (_, i) => fixtureUrl(`pagi-${i + 1}`)),
    }

    await runQueueFlow(page, {
      baseURL,
      testArticles: stagingArticles,
      authData: {
        email: 'e2e-test@example.com',
        password: 'test-password-123',
      },
      passwordResetProgress,
      queueProgress,
      preQueueActionFactories: {
        anonymousView: createAnonymousViewPageActions(
          { baseUrl: baseURL, testUrl: fixtureUrl('anon-view') },
          viewPageProgress,
        ),
        onboarding: skipFactory(ONBOARDING_ACTION_KEYS),
        seed: skipFactory(SEED_ACTION_KEYS),
        cleanup: createCleanupActions(cleanupProgress),
        passwordReset: skipFactory(PASSWORD_RESET_ACTION_KEYS),
        savePermalink: createSavePermalinkActions(
          { baseUrl: baseURL, testUrl: fixtureUrl('permalink') },
          cleanupProgress,
          savePermalinkProgress,
        ),
        bannerOnReader: createBannerOnReaderActions(
          {
            baseUrl: baseURL,
            publicViewTestUrl: fixtureUrl('banner-on-public-view'),
            privateReaderTestUrl: fixtureUrl('banner-on-private-reader'),
          },
          cleanupProgress,
          bannerOnReaderProgress,
        ),
        importActions: skipFactory(IMPORT_ACTION_KEYS),
      },
      preQueueProgressObjects: [
        viewPageProgress,
        cleanupProgress,
        savePermalinkProgress,
        bannerOnReaderProgress,
        onboardingProgress,
        seedProgress,
        passwordResetProgress,
        importProgress,
      ],
      maxNavigations: 100,
    })
  })
})
/* c8 ignore stop */
