import { type Page, expect } from '@playwright/test'
import { HATEOASClient, PageNavigationHandler, type NavigationConfig } from '../hateoas'
import type {
  ViewPageActionKey,
  OnboardingActionKey,
  SeedActionKey,
  CleanupActionKey,
  PasswordResetActionKey,
  SavePermalinkActionKey,
  BannerOnReaderActionKey,
  ImportActionKey,
  ImportFromUrlActionKey,
  QueueFlowActionKey,
} from './action-catalog'
import { createAuthActions, type AuthData, type AuthProgress } from './auth-actions'
import { createQueueActions, type QueueProgress, type TestArticleData } from './queue-actions'
import type { PasswordResetProgress } from './password-reset-actions'
import type { PageAction } from '../hateoas/navigation-handler.types'

export type PreQueueActionFactories = {
  anonymousView: (authProgress: AuthProgress) => Record<ViewPageActionKey, PageAction>
  onboarding: (authProgress: AuthProgress) => Record<OnboardingActionKey, PageAction>
  seed: (authProgress: AuthProgress) => Record<SeedActionKey, PageAction>
  cleanup: (authProgress: AuthProgress) => Record<CleanupActionKey, PageAction>
  passwordReset: (authProgress: AuthProgress) => Record<PasswordResetActionKey, PageAction>
  savePermalink: (authProgress: AuthProgress) => Record<SavePermalinkActionKey, PageAction>
  bannerOnReader: (authProgress: AuthProgress) => Record<BannerOnReaderActionKey, PageAction>
  importActions: (authProgress: AuthProgress) => Record<ImportActionKey, PageAction>
  importFromUrlActions: (authProgress: AuthProgress) => Record<ImportFromUrlActionKey, PageAction>
}

export interface QueueFlowConfig {
  baseURL: string
  testArticles: TestArticleData
  authData: AuthData
  passwordResetProgress: PasswordResetProgress
  queueProgress: QueueProgress
  preQueueActionFactories: PreQueueActionFactories
  preQueueProgressObjects: Record<string, boolean>[]
  maxNavigations?: number
}

export async function runQueueFlow(page: Page, config: QueueFlowConfig): Promise<void> {
  const authProgress: AuthProgress = {
    accountCreated: false,
    loggedOut: false,
    loggedIn: false,
  }

  const queueProgress = config.queueProgress

  const { anonymousView, onboarding, seed, cleanup, passwordReset, savePermalink, bannerOnReader, importActions, importFromUrlActions } = config.preQueueActionFactories

  const allActions: Record<QueueFlowActionKey, PageAction> = {
    ...anonymousView(authProgress),
    ...onboarding(authProgress),
    ...seed(authProgress),
    ...cleanup(authProgress),
    ...passwordReset(authProgress),
    ...savePermalink(authProgress),
    ...bannerOnReader(authProgress),
    ...createAuthActions(config.authData, authProgress, config.passwordResetProgress),
    ...createQueueActions(authProgress, queueProgress, config.testArticles),
    ...importActions(authProgress),
    ...importFromUrlActions(authProgress),
  }

  const allProgressObjects: Record<string, boolean>[] = [
    authProgress,
    ...config.preQueueProgressObjects,
    queueProgress,
  ]

  const actionsMap = new Map<string, PageAction>(Object.entries(allActions))

  const navigationHandler = new PageNavigationHandler(
    page,
    {
      successDetector: async () =>
        allProgressObjects.every(p => Object.values(p).every(Boolean)),
    },
    actionsMap,
  )

  const client = new HATEOASClient(page, navigationHandler)
  const navConfig: NavigationConfig = { maxNavigations: config.maxNavigations ?? 75 }

  const startURL = `${config.baseURL.replace(/\/+$/, '')}/`
  const result = await client.navigate(startURL, navConfig)

  expect(result.success).toBe(true)
}
