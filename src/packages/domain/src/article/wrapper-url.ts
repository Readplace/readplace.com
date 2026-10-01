export type WrapperFamily = "newsletter-tracker" | "apple-news" | "archive-snapshot";

export type UnwrappedUrl = { url: string; contentSourceUrl?: string };

const ARCHIVE_TODAY_HOSTS: ReadonlySet<string> = new Set(["archive.ph", "archive.is", "archive.today"]);
const WAYBACK_HOST = "web.archive.org";
const ARCHIVE_HOSTS: ReadonlySet<string> = new Set([WAYBACK_HOST, ...ARCHIVE_TODAY_HOSTS]);
const APPLE_NEWS_HOSTS: ReadonlySet<string> = new Set(["apple.news", "www.apple.news"]);
const TWEET_INTENT_HOSTS: ReadonlySet<string> = new Set(["twitter.com", "www.twitter.com", "x.com", "www.x.com"]);
const SUBSTACK_HOSTS: ReadonlySet<string> = new Set(["substack.com", "open.substack.com"]);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BONOBO_LINK_PATH = new RegExp(`^/links/\\d+/${UUID}(?:/|$)`, "i");
const COOPERPRESS_LINK_PATH = /^\/link\/\d+\/[^/]+$/;
const MAILCHIMP_HOST = /^us\d*\.list-manage\.com$/;
const MAILCHIMP_CLICK_PATH = /^\/track\/click$/;
const WEEKLYFILET_LINK_PATH = /^\/r\/[0-9a-f]+$/i;
const SUBSTACK_SHARE_PATH = /^\/pub\/[^/]+\/p\/[^/]+$/;
const SUBSTACK_REDIRECT_PATH = /^\/redirect\/[^/]+$/;
const OPAQUE_TOKEN_PATH = /^\/[A-Za-z0-9_-]+$/;
const GOOGLE_SHARE_HOP_PATH = /^\/share\.google$/;
const TWEET_INTENT_PATH = /^\/intent\/(?:tweet|post)$/;

const WAYBACK_SNAPSHOT = /^\/web\/\d{1,14}(?:[a-z]{2}_)?\/(.+)$/;
const ARCHIVE_TODAY_SNAPSHOT = /^\/(?:\d{14}|\d{4}\.\d{2}\.\d{2}-\d{6})\/(.+)$/;
const ARCHIVE_TODAY_SCREENSHOT = /^\/([A-Za-z0-9]+)\/[0-9a-f]+\/scr\.png$/;
const COLLAPSED_SCHEME = /^(https?:)\/(?!\/)/i;

const SUBSTACK_REDIRECT_PARAMS: readonly string[] = ["r", "publication_id", "post_id", "isFreemail", "triedRedirect"];

type TrackerRule = { host: string | RegExp; path: RegExp; requiresParam?: string };

const NEWSLETTER_TRACKERS: readonly TrackerRule[] = [
	{ host: "leadershipintech.com", path: BONOBO_LINK_PATH },
	{ host: "csharpdigest.net", path: BONOBO_LINK_PATH },
	{ host: "javascriptweekly.com", path: COOPERPRESS_LINK_PATH },
	{ host: MAILCHIMP_HOST, path: MAILCHIMP_CLICK_PATH },
	{ host: MAILCHIMP_HOST, path: OPAQUE_TOKEN_PATH, requiresParam: "c2id" },
	{ host: "newsletter.weeklyfilet.com", path: WEEKLYFILET_LINK_PATH },
	{ host: "open.substack.com", path: SUBSTACK_SHARE_PATH },
	{ host: "substack.com", path: SUBSTACK_REDIRECT_PATH },
	{ host: "share.google", path: OPAQUE_TOKEN_PATH },
	{ host: "www.google.com", path: GOOGLE_SHARE_HOP_PATH, requiresParam: "q" },
];

function parseHttpUrl(value: string): URL | undefined {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return undefined;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
	return parsed;
}

function hostnameOf(parsed: URL): string {
	return parsed.hostname.endsWith(".") ? parsed.hostname.slice(0, -1) : parsed.hostname;
}

function pathWithQuery(parsed: URL): string {
	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function matchesTracker(rule: TrackerRule, host: string, parsed: URL): boolean {
	const hostMatches = typeof rule.host === "string" ? rule.host === host : rule.host.test(host);
	if (!hostMatches || !rule.path.test(parsed.pathname)) return false;
	return rule.requiresParam === undefined || parsed.searchParams.has(rule.requiresParam);
}

function isArchiveSnapshot(host: string, parsed: URL): boolean {
	if (host === WAYBACK_HOST) return WAYBACK_SNAPSHOT.test(pathWithQuery(parsed));
	if (!ARCHIVE_TODAY_HOSTS.has(host)) return false;
	return (
		OPAQUE_TOKEN_PATH.test(parsed.pathname) ||
		ARCHIVE_TODAY_SNAPSHOT.test(pathWithQuery(parsed)) ||
		ARCHIVE_TODAY_SCREENSHOT.test(parsed.pathname)
	);
}

export function wrapperFamilyOf(url: string): WrapperFamily | undefined {
	const parsed = parseHttpUrl(url);
	if (parsed === undefined) return undefined;
	const host = hostnameOf(parsed);
	if (NEWSLETTER_TRACKERS.some((rule) => matchesTracker(rule, host, parsed))) return "newsletter-tracker";
	if (APPLE_NEWS_HOSTS.has(host) && OPAQUE_TOKEN_PATH.test(parsed.pathname)) return "apple-news";
	if (isArchiveSnapshot(host, parsed)) return "archive-snapshot";
	return undefined;
}

export function isArchiveHost(url: string): boolean {
	const parsed = parseHttpUrl(url);
	return parsed !== undefined && ARCHIVE_HOSTS.has(hostnameOf(parsed));
}

function unwrapSnapshot(snapshotUrl: string, match: RegExpExecArray | null): UnwrappedUrl {
	if (match === null) return { url: snapshotUrl };
	const original = parseHttpUrl(match[1].replace(COLLAPSED_SCHEME, "$1//"));
	if (original === undefined) return { url: snapshotUrl };
	return { url: original.href, contentSourceUrl: snapshotUrl };
}

function unwrapTweetIntent(url: string, parsed: URL): UnwrappedUrl {
	const shared = parsed.searchParams.get("url");
	if (shared === null) return { url };
	const original = parseHttpUrl(shared);
	if (original === undefined) return { url };
	return { url: original.href };
}

export function unwrapWrapperUrl(url: string): UnwrappedUrl {
	const parsed = parseHttpUrl(url);
	if (parsed === undefined) return { url };
	const host = hostnameOf(parsed);
	if (host === WAYBACK_HOST) return unwrapSnapshot(url, WAYBACK_SNAPSHOT.exec(pathWithQuery(parsed)));
	if (ARCHIVE_TODAY_HOSTS.has(host)) {
		const screenshot = ARCHIVE_TODAY_SCREENSHOT.exec(parsed.pathname);
		if (screenshot !== null) return { url: `${parsed.origin}/${screenshot[1]}` };
		return unwrapSnapshot(url, ARCHIVE_TODAY_SNAPSHOT.exec(pathWithQuery(parsed)));
	}
	if (TWEET_INTENT_HOSTS.has(host) && TWEET_INTENT_PATH.test(parsed.pathname)) {
		return unwrapTweetIntent(url, parsed);
	}
	return { url };
}

export function stripRedirectAddedParams(params: { wrapperUrl: string; targetUrl: string }): string {
	const wrapper = parseHttpUrl(params.wrapperUrl);
	if (wrapper === undefined || !SUBSTACK_HOSTS.has(hostnameOf(wrapper))) return params.targetUrl;
	const target = parseHttpUrl(params.targetUrl);
	if (target === undefined) return params.targetUrl;
	for (const name of SUBSTACK_REDIRECT_PARAMS) target.searchParams.delete(name);
	return target.href;
}
