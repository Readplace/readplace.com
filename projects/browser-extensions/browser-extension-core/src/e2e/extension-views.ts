export const EXTENSION_VIEW_IDS = [
	"login-view",
	"saved-view",
	"list-view",
	"saving-view",
] as const;

export type ExtensionViewId = (typeof EXTENSION_VIEW_IDS)[number];

export const SERVER_PAGES = [
	{ className: "page-login", view: "server-login" },
	{ className: "page-oauth-authorize", view: "oauth-authorize" },
] as const;

export const TRANSITIONING_VIEW = "transitioning";

export const ELEMENT_IDS = {
	loginButton: "login-button",
	loginError: "login-error",
	viewQueueButton: "view-queue-button",
	logoutButton: "logout-button",
	filterInput: "filter-input",
	linkList: "link-list",
	pagination: "pagination",
	emptyList: "empty-list",
	noMatches: "no-matches",
	listError: "list-error",
	emailInput: "email",
	passwordInput: "password",
} as const;

export const CSS_SELECTORS = {
	/** Scoped to the login form by `data-test-form="login"` so it never picks
	 * up other submit buttons on the page (the SSR header now renders every
	 * nav item as a `<form method="…"><button type="submit">…</button></form>`,
	 * so the bare `button[type="submit"]` selector resolved to the first nav
	 * button on /login and silently navigated the page away). */
	submitButton: '[data-test-form="login"] button[type="submit"]',
	approveButton: 'button[value="approve"]',
	listItem: "#link-list .list-view__item",
	listItemTitle: "#link-list .list-view__item-title",
	deleteButton: "#link-list .list-view__delete",
} as const;

/** Reader permalink (readUrl) shape, `/queue/:id/view`: a saved-article link
 * resolves to this, never the original article URL, which is what distinguishes
 * the private reader permalink from an arbitrary saved URL. */
export const READER_PERMALINK_PATTERN = /\/queue\/[a-f0-9]+\/view$/;
