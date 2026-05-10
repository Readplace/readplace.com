/** Legacy cookie. Still written by the published extension's content script
 * via `markExtensionInstalled()` on every Readplace page load (the bundled
 * copy of this package shipped with each extension version). The server no
 * longer reads it for onboarding — that signal moved to ALIVE_COOKIE_NAME,
 * which is httpOnly so a stale or forged client-side write can't keep the
 * onboarding ticked after the extension is uninstalled. */
export const COOKIE_NAME = "hutch_ext_installed";
export const COOKIE_VALUE = "1";

/** Set by the server on every Siren request (Accept: application/vnd.siren+json),
 * which only the extension makes. httpOnly so the client cannot forge or
 * renew it; ~30-day TTL so an uninstalled extension stops renewing the
 * cookie and the onboarding "install" step flips back to incomplete within
 * a month. */
export const ALIVE_COOKIE_NAME = "hutch_ext_alive";
export const ALIVE_COOKIE_VALUE = "1";

/** Set by the server on successful saves through the extension's Siren save
 * endpoints (POST /queue, POST /queue/save-html). The onboarding "save your
 * first article" step uses this cookie so that only saves that came from the
 * browser extension count — saves through the web form on /queue do not.
 * Renewed on every Siren request while present so it tracks extension
 * liveness rather than persisting for a year past uninstall. */
export const SAVE_COOKIE_NAME = "hutch_ext_saved";
export const SAVE_COOKIE_VALUE = "1";

export const DISMISS_COOKIE_NAME = "hutch_onboarding_dismissed";

/** Called by the browser extension content script on Readplace pages. The
 * cookie it writes is no longer used by the server for onboarding (see
 * ALIVE_COOKIE_NAME); kept for compatibility with deployed extension
 * versions that bundle this function. */
export function markExtensionInstalled(): void {
	// biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API is unavailable in Firefox/Safari content scripts; document.cookie is the cross-browser path
	document.cookie = `${COOKIE_NAME}=${COOKIE_VALUE}; path=/; max-age=31536000; SameSite=Lax`;
}
