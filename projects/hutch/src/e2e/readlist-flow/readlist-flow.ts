import { type Page, expect } from '@playwright/test'
import { HATEOASClient, PageNavigationHandler, withActionCompleted, type NavigationConfig, type OnActionComplete } from '../hateoas'
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
	ReadlistFlowActionKey,
} from './action-catalog'
import { createAuthActions, type AuthData, type AuthProgress } from './auth-actions'
import { createReadlistActions, type ReadlistProgress, type TestArticleData } from './readlist-actions'
import type { PasswordResetProgress } from './password-reset-actions'
import type { PageAction } from '../hateoas/navigation-handler.types'

export type PreReadlistActionFactories = {
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

export interface ReadlistFlowConfig {
	baseURL: string
	testArticles: TestArticleData
	authData: AuthData
	passwordResetProgress: PasswordResetProgress
	readlistProgress: ReadlistProgress
	preReadlistActionFactories: PreReadlistActionFactories
	preReadlistProgressObjects: Record<string, boolean>[]
	onActionComplete: OnActionComplete
	maxNavigations?: number
}

export async function runReadlistFlow(page: Page, config: ReadlistFlowConfig): Promise<void> {
	const authProgress: AuthProgress = {
		accountCreated: false,
		loggedOut: false,
		loggedIn: false,
	}

	const readlistProgress = config.readlistProgress

	const { anonymousView, onboarding, seed, cleanup, passwordReset, savePermalink, bannerOnReader, importActions, importFromUrlActions } = config.preReadlistActionFactories

	const allActions: Record<ReadlistFlowActionKey, PageAction> = {
		...anonymousView(authProgress),
		...onboarding(authProgress),
		...seed(authProgress),
		...cleanup(authProgress),
		...passwordReset(authProgress),
		...savePermalink(authProgress),
		...bannerOnReader(authProgress),
		...createAuthActions(config.authData, authProgress, config.passwordResetProgress),
		...createReadlistActions(authProgress, readlistProgress, config.testArticles),
		...importActions(authProgress),
		...importFromUrlActions(authProgress),
	}

	const allProgressObjects: Record<string, boolean>[] = [
		authProgress,
		...config.preReadlistProgressObjects,
		readlistProgress,
	]

	const actionsMap = new Map<string, PageAction>(Object.entries(allActions))

	const navigationHandler = withActionCompleted(
		new PageNavigationHandler(
			page,
			{
				successDetector: async () =>
					allProgressObjects.every(p => Object.values(p).every(Boolean)),
			},
			actionsMap,
		),
		config.onActionComplete,
	)

	const client = new HATEOASClient(page, navigationHandler)
	const navConfig: NavigationConfig = { maxNavigations: config.maxNavigations ?? 75 }

	const startURL = `${config.baseURL.replace(/\/+$/, '')}/`
	const result = await client.navigate(startURL, navConfig)

	expect(result.success).toBe(true)
}
