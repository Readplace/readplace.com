const REDDIT_WEB_HOSTS: ReadonlySet<string> = new Set([
	"www.reddit.com",
	"m.reddit.com",
	"np.reddit.com",
	"reddit.com",
]);

const SHORTLINK_PATH = /^\/r\/[^/]+\/s\/[A-Za-z0-9_-]+\/?$/;

export type RedditPreprocessor = (url: string) => Promise<string>;

/**
 * www.reddit.com serves a JavaScript challenge or 403 to crawler-shaped
 * traffic from AWS Lambda's outbound IPs. old.reddit.com (the legacy
 * interface) returns full article HTML on the same canonical /comments/<id>
 * paths and keeps the `<link rel="canonical">` pointing at www.reddit.com so
 * downstream consumers still get the public canonical URL. Rewriting is the
 * cheapest bypass: no extra fetch, no persona variation needed.
 *
 * Known limitation: /r/<sub>/s/<id> shortlinks are NOT supported from AWS
 * Lambda. Resolving them requires fetching www.reddit.com to read the 301
 * Location header, and Reddit IP-blocks AWS Lambda egress on that endpoint
 * regardless of TLS fingerprint (undici and curl-impersonate both get 403).
 * Pre-resolution must happen on a non-AWS IP (the browser extension's
 * residential IP, or an external resolver service) before the URL reaches
 * the crawler. /s/ shortlinks that hit the crawler will fail with 403.
 */
export function initRedditPreprocessor(): RedditPreprocessor {
	return async (url) => {
		const parsed = parseUrl(url);
		if (!parsed || !REDDIT_WEB_HOSTS.has(parsed.hostname)) return url;
		if (SHORTLINK_PATH.test(parsed.pathname)) return url;
		return toOldReddit(parsed).href;
	};
}

function parseUrl(url: string): URL | null {
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

function toOldReddit(url: URL): URL {
	const next = new URL(url.href);
	next.hostname = "old.reddit.com";
	return next;
}
