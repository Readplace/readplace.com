import { CONTENT_CLASSES } from "./events";

export type ContentClass = (typeof CONTENT_CLASSES)[keyof typeof CONTENT_CLASSES];

/**
 * The apex domains whose articles are *our own* published content rather than
 * a third party's. Classification keys off the saved article's own domain (the
 * host of the URL being saved) — never the referrer or traffic source — so a
 * visitor who arrives from our own site to save a third-party article is still
 * a third-party save. A host matches when it equals one of these or is a
 * subdomain of it, so `www.readplace.com` and `blog.fagnerbrack.com` count as
 * own without being listed separately. The deployment host (the app's own
 * origin) is intentionally absent: people save articles, not the app shell.
 */
export const OWN_CONTENT_DOMAINS: readonly string[] = ["readplace.com", "fagnerbrack.com"];

/**
 * The article's own domain. `new URL().hostname` already lowercases the host,
 * so `view_opened` and `view_save_intent` carry an identically-normalized
 * `article_host` and the two events join without a normalization mismatch.
 */
export function articleHostFrom(url: string): string {
	return new URL(url).hostname;
}

/**
 * The article's own host, tolerant of unparseable input. Save surfaces emit
 * `view_save_intent` even for URL-validation failures, where the submitted
 * string may not parse as a URL — this returns `null` for those so the event
 * can still record the failure with `article_host`/`content_class` unset,
 * rather than throwing and losing the emission.
 */
export function articleHostFromSubmitted(url: string): string | null {
	try {
		const host = new URL(url).hostname;
		return host.length > 0 ? host : null;
	} catch {
		return null;
	}
}

export function classifyContentSource(articleHost: string): ContentClass {
	const host = articleHost.toLowerCase();
	const owned = OWN_CONTENT_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
	return owned ? CONTENT_CLASSES.own : CONTENT_CLASSES.thirdParty;
}
