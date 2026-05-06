export const COOKIE_NAME = "hutch_ext_installed";
export const COOKIE_VALUE = "1";

/** Set by the server on successful saves through the extension's Siren save
 * endpoints (POST /queue, POST /queue/save-html). The onboarding "save your
 * first article" step uses this cookie so that only saves that came from the
 * browser extension count — saves through the web form on /queue do not. */
export const SAVE_COOKIE_NAME = "hutch_ext_saved";
export const SAVE_COOKIE_VALUE = "1";

export const DISMISS_COOKIE_NAME = "hutch_onboarding_dismissed";

/** Called by the browser extension content script on Readplace pages. */
export function markExtensionInstalled(): void {
	// biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API is unavailable in Firefox/Safari content scripts; document.cookie is the cross-browser path
	document.cookie = `${COOKIE_NAME}=${COOKIE_VALUE}; path=/; max-age=31536000; SameSite=Lax`;
}
