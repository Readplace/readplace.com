export type ViewPageActionKey =
	| 'anonymous-visit-view-page'
	| 'anonymous-visit-view-page-crawl-fails'

export type AuthActionKey =
	| 'navigate-to-signup'
	| 'submit-signup-form'
	| 'click-logout'
	| 'navigate-to-login'
	| 'submit-login-form'

export type OnboardingActionKey =
	| 'onboarding-install-extension-incomplete'
	| 'onboarding-save-via-extension'
	| 'onboarding-persisted-after-login'

export type CleanupActionKey = 'cleanup-previous-articles'

export type PasswordResetActionKey =
	| 'navigate-to-forgot-password'
	| 'submit-forgot-password-form'
	| 'navigate-to-reset-password'
	| 'submit-reset-password-form'
	| 'login-with-new-password'

export type SavePermalinkActionKey =
	| 'save-via-permalink'
	| 'delete-permalink-article'

export const TEST_ARTICLE_COUNT = 4
export const PAGINATION_ARTICLE_COUNT = 17
export const SEED_ARTICLE_COUNT = 2

type TestArticleIndex = 1 | 2 | 3 | 4
type PaginationIndex =
	| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
	| 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17
type SeedIndex = 1 | 2

export type SaveArticleKey = `save-article-${TestArticleIndex}`
export type PaginationArticleKey = `save-pagination-article-${PaginationIndex}`
export type SeedActionKey = `seed-article-${SeedIndex}`

export type QueueActionKey =
	| SaveArticleKey
	| PaginationArticleKey
	| 'verify-page1-has-next'
	| 'navigate-to-page2'
	| 'verify-page2'
	| 'navigate-back-to-page1'
	| 'verify-back-on-page1'
	| 'resave-existing-article-triggers-refresh'
	| 'delete-pagination-articles'
	| 'verify-newest-first-order'
	| 'sort-oldest-first'
	| 'verify-oldest-first-order'
	| 'read-first-article'
	| 'go-back-to-queue'
	| 'verify-first-is-read'
	| 'delete-last-article'
	| 'check-read-tab'
	| 'check-unread-tab'
	| 'cleanup-delete-all'

export type QueueFlowActionKey =
	| ViewPageActionKey
	| AuthActionKey
	| OnboardingActionKey
	| CleanupActionKey
	| PasswordResetActionKey
	| SavePermalinkActionKey
	| SeedActionKey
	| QueueActionKey

// Fails to compile if the tuple omits any union member — keeps skipFactory
// callers in run.e2e-staging.ts from silently dropping a key the local test
// registers.
type AssertExhaustive<U, Tuple extends readonly U[]> =
	[Exclude<U, Tuple[number]>] extends [never] ? Tuple : ['missing keys', Exclude<U, Tuple[number]>]

export const ONBOARDING_ACTION_KEYS = [
	'onboarding-install-extension-incomplete',
	'onboarding-save-via-extension',
	'onboarding-persisted-after-login',
] as const satisfies AssertExhaustive<OnboardingActionKey, readonly OnboardingActionKey[]>

export const PASSWORD_RESET_ACTION_KEYS = [
	'navigate-to-forgot-password',
	'submit-forgot-password-form',
	'navigate-to-reset-password',
	'submit-reset-password-form',
	'login-with-new-password',
] as const satisfies AssertExhaustive<PasswordResetActionKey, readonly PasswordResetActionKey[]>

export const SEED_ACTION_KEYS = [
	'seed-article-1',
	'seed-article-2',
] as const satisfies AssertExhaustive<SeedActionKey, readonly SeedActionKey[]>
