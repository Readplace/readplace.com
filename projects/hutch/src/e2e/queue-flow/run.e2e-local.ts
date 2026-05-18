import assert from 'node:assert'
import { test } from '@playwright/test'
import { createBannerOnReaderActions, type BannerOnReaderProgress } from './banner-on-reader-actions'
import { createCleanupActions, type CleanupProgress } from './cleanup-actions'
import { createOnboardingActions, type OnboardingProgress } from './onboarding-actions'
import { createPasswordResetActions, type PasswordResetProgress } from './password-reset-actions'
import { createSavePermalinkActions, type SavePermalinkProgress } from './save-permalink-actions'
import { createSeedActions, type SeedProgress } from './seed-actions'
import { createAnonymousViewPageActions, type ViewPageProgress } from './view-page-actions'
import { createLocalTestArticles } from './queue-actions'
import { runQueueFlow } from './queue-flow'

assert(process.env.E2E_PORT, "E2E_PORT is required")
const BASE_URL = `http://localhost:${process.env.E2E_PORT}`

test.describe('Queue management flow (local)', () => {
  test('signup, logout, reset password, login, add articles, pagination, sort, read, delete, verify tabs', async ({ page }) => {

    const authData = {
      email: 'e2e-test@example.com',
      password: 'test-password-123',
    }

    const seedProgress: SeedProgress = {
      articlesSeeded: false,
    }

    const cleanupProgress: CleanupProgress = {
      previousArticlesDeleted: false,
    }

    const passwordResetProgress: PasswordResetProgress = {
      navigatedToForgotPassword: false,
      submittedForgotPassword: false,
      navigatedToResetPassword: false,
      submittedResetPassword: false,
      loggedInWithNewPassword: false,
    }

    const onboardingProgress: OnboardingProgress = {
      installedExtension: false,
      savedFirstArticle: false,
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
      visitedCrawlFailure: false,
    }

    await runQueueFlow(page, {
      baseURL: BASE_URL,
      testArticles: createLocalTestArticles(BASE_URL),
      authData,
      passwordResetProgress,
      preQueueActionFactories: {
        anonymousView: createAnonymousViewPageActions(
          { baseUrl: BASE_URL, testUrl: `${BASE_URL}/privacy?view=1`, unfetchableUrl: `${BASE_URL}/e2e/unfetchable` },
          viewPageProgress,
        ),
        onboarding: createOnboardingActions(onboardingProgress),
        seed: createSeedActions(seedProgress, [`${BASE_URL}/privacy?seed=1`, `${BASE_URL}/privacy?seed=2`]),
        cleanup: createCleanupActions(cleanupProgress),
        passwordReset: createPasswordResetActions(
          { email: authData.email, oldPassword: authData.password, newPassword: 'reset-password-456', baseUrl: BASE_URL },
          authData,
          passwordResetProgress,
        ),
        savePermalink: createSavePermalinkActions(
          { baseUrl: BASE_URL, testUrl: `${BASE_URL}/privacy?permalink=1` },
          cleanupProgress,
          savePermalinkProgress,
        ),
        bannerOnReader: createBannerOnReaderActions(
          {
            baseUrl: BASE_URL,
            publicViewTestUrl: `${BASE_URL}/privacy?banner-on-public-view=${Date.now()}`,
            privateReaderTestUrl: `${BASE_URL}/privacy?banner-on-private-reader=${Date.now()}`,
          },
          cleanupProgress,
          bannerOnReaderProgress,
        ),
      },
      preQueueProgressObjects: [viewPageProgress, seedProgress, cleanupProgress, passwordResetProgress, onboardingProgress, savePermalinkProgress, bannerOnReaderProgress],
      maxNavigations: 100,
    })
  })
})
