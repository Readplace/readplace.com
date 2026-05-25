const REDDIT_WEB_HOSTS: ReadonlySet<string> = new Set([
	"www.reddit.com",
	"m.reddit.com",
	"np.reddit.com",
	"reddit.com",
]);

const SHORTLINK_PATH = /^\/r\/[^/]+\/s\/[A-Za-z0-9_-]+\/?$/;

const RESOLVE_TIMEOUT_MS = 5000;

export type RedditPreprocessor = (url: string) => Promise<string>;

type RedditPreprocessorDeps = {
	fetch: typeof globalThis.fetch;
	logError: (message: string, error?: Error) => void;
};

/**
 * www.reddit.com serves a JavaScript challenge or 403 to crawler-shaped
 * traffic from AWS Lambda's outbound IPs. old.reddit.com (the legacy
 * interface) returns full article HTML on the same canonical /comments/<id>
 * paths, and keeps the `<link rel="canonical">` pointing at www.reddit.com so
 * downstream consumers still get the public canonical URL. Rewriting is the
 * cheapest bypass: no extra fetch, no persona variation needed.
 *
 * /r/<sub>/s/<id> shortlinks are www-only — old.reddit.com 302s them to a
 * submit/login flow. The preprocessor first resolves the shortlink to its
 * canonical /comments/<id>/<slug>/ form via a redirect:manual fetch (one
 * request, 301 + Location), then rewrites the resolved URL to old.reddit.com.
 * If resolution fails the original URL passes through unchanged.
 */
export function initRedditPreprocessor(deps: RedditPreprocessorDeps): RedditPreprocessor {
	return async (url) => {
		const parsed = parseUrl(url);
		if (!parsed || !REDDIT_WEB_HOSTS.has(parsed.hostname)) return url;
		if (SHORTLINK_PATH.test(parsed.pathname)) {
			const canonical = await resolveShortlink(deps, parsed);
			if (!canonical || !REDDIT_WEB_HOSTS.has(canonical.hostname)) return url;
			return toOldReddit(canonical).href;
		}
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

async function resolveShortlink(deps: RedditPreprocessorDeps, url: URL): Promise<URL | null> {
	try {
		const response = await deps.fetch(url.href, {
			redirect: "manual",
			signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
		});
		if (response.status < 300 || response.status >= 400) return null;
		const location = response.headers.get("location");
		if (!location) return null;
		return new URL(location, url);
	} catch (error) {
		deps.logError(
			`[reddit-preprocessor] shortlink resolution failed for ${url.href}`,
			error instanceof Error ? error : undefined,
		);
		return null;
	}
}
