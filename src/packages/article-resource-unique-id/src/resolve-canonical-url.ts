import { ArticleResourceUniqueId } from "./index";

export type CanonicalSignals = {
	requestedUrl: string;
	/** Where the fetch actually resolved after following redirects — the server
	 * passes `response.url`; the extension's `location.href` is already the
	 * post-redirect URL, so it may leave this unset. A server-issued redirect is
	 * authoritative even across hosts (e.g. medium.com/p/<id> → a custom domain). */
	finalUrl?: string;
	/** href of the fetched page's <link rel="canonical">. */
	linkCanonicalHref?: string;
	/** content of the fetched page's <meta property="og:url">. */
	ogUrl?: string;
};

export function resolveCanonicalUrl(signals: CanonicalSignals): string {
	const requestedId = ArticleResourceUniqueId.parse(signals.requestedUrl).value;

	const declared = declaredCanonical(signals, requestedId);
	if (declared !== undefined) return declared;

	const redirected = redirectedCanonical(signals, requestedId);
	if (redirected !== undefined) return redirected;

	return signals.requestedUrl;
}

function declaredCanonical(signals: CanonicalSignals, requestedId: string): string | undefined {
	const href = firstNonEmpty(signals.linkCanonicalHref, signals.ogUrl);
	if (href === undefined) return undefined;
	const base = signals.finalUrl ?? signals.requestedUrl;
	if (!URL.canParse(href, base)) return undefined;
	const canonical = new URL(href, base);
	if (canonical.hostname !== new URL(base).hostname) return undefined;
	return acceptCanonical(canonical, signals.requestedUrl, requestedId);
}

function redirectedCanonical(signals: CanonicalSignals, requestedId: string): string | undefined {
	if (signals.finalUrl === undefined) return undefined;
	if (!URL.canParse(signals.finalUrl)) return undefined;
	return acceptCanonical(new URL(signals.finalUrl), signals.requestedUrl, requestedId);
}

function acceptCanonical(candidate: URL, requestedUrl: string, requestedId: string): string | undefined {
	if (candidate.pathname === "/") {
		if (new URL(requestedUrl).pathname !== "/") return undefined;
	}
	if (ArticleResourceUniqueId.parse(candidate.href).value === requestedId) return undefined;
	return candidate.href;
}

function firstNonEmpty(a: string | undefined, b: string | undefined): string | undefined {
	const trimmedA = a?.trim();
	if (trimmedA) return trimmedA;
	const trimmedB = b?.trim();
	if (trimmedB) return trimmedB;
	return undefined;
}
