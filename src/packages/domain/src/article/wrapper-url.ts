export type WrapperFamily = "newsletter-tracker" | "apple-news" | "archive-snapshot";

export type WrapperResolution = "none" | "syntactic" | "network";

export type UnwrappedUrl = { url: string; contentSourceUrl?: string };

const WAYBACK_ORIGIN = "https://web.archive.org";
const WAYBACK_HOSTS: ReadonlySet<string> = new Set(["web.archive.org", "wayback.archive.org", "www.web.archive.org"]);
const ARCHIVE_TODAY_HOSTS: ReadonlySet<string> = new Set([
	"archive.ph",
	"archive.is",
	"archive.today",
	"archive.md",
	"archive.li",
	"archive.fo",
	"archive.vn",
]);
const ARCHIVE_HOSTS: ReadonlySet<string> = new Set([...WAYBACK_HOSTS, ...ARCHIVE_TODAY_HOSTS]);
const ARCHIVE_TODAY_RESERVED_SEGMENTS: ReadonlySet<string> = new Set(["newest", "oldest", "wip", "o", "timemap", "timegate"]);
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

const WAYBACK_STAMPED_PATH = /^\/web\/([^/]+)\/(.+)$/;
const WAYBACK_UNSTAMPED_PATH = /^\/(?:web|save)\/(.+)$/;
const WAYBACK_CAPTURE_TIMESTAMP = /^\d{1,14}(?:id_)?$/;
const WAYBACK_ASSET_TIMESTAMP = /^\d{1,14}[a-z]{2}_$/;
const WAYBACK_CALENDAR_TIMESTAMP = /^\d*(?:\*|%2a)$/i;

const ARCHIVE_TODAY_SCREENSHOT = /^\/([A-Za-z0-9]+)\/[0-9a-f]+\/scr\.png$/;
const ARCHIVE_TODAY_WIP = /^\/wip\/([A-Za-z0-9]+)$/;
const ARCHIVE_TODAY_OUTBOUND = /^\/o\/([A-Za-z0-9]+)\/(.+)$/;
const ARCHIVE_TODAY_SELECTOR = /^\/(?:newest|oldest)\/(.+)$/;
const ARCHIVE_TODAY_SNAPSHOT = /^\/(?:\d{14}|\d{4}\.\d{2}\.\d{2}-\d{6})\/(.+)$/;
const ARCHIVE_TODAY_PARTIAL_TIMESTAMP = /^\/\d{1,13}\/(.+)$/;
const ARCHIVE_TODAY_LISTING = /^\/(.+)$/;

const COLLAPSED_SCHEME = /^(https?:)\/(?!\/)/i;
const ENCODED_SCHEME = /^https?%3a/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const PREFIX_WILDCARD = /(?:\*|%2a)$/i;

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

function decodeEncodedScheme(raw: string): string | undefined {
	if (!ENCODED_SCHEME.test(raw)) return raw;
	try {
		return decodeURIComponent(raw);
	} catch {
		return undefined;
	}
}

function withAssumedScheme(raw: string): string {
	if (HAS_SCHEME.test(raw)) return raw;
	const [firstSegment] = raw.split(/[/?#]/);
	return firstSegment.includes(".") ? `https://${raw}` : raw;
}

function normaliseInnerUrl(raw: string): string | undefined {
	if (PREFIX_WILDCARD.test(raw)) return undefined;
	const decoded = decodeEncodedScheme(raw);
	if (decoded === undefined) return undefined;
	return parseHttpUrl(withAssumedScheme(decoded.replace(COLLAPSED_SCHEME, "$1//")))?.href;
}

function captureOf(params: { rawInner: string; contentSourceUrl: string }): UnwrappedUrl | undefined {
	const inner = normaliseInnerUrl(params.rawInner);
	return inner === undefined ? undefined : { url: inner, contentSourceUrl: params.contentSourceUrl };
}

function waybackLatestCaptureOf(rawInner: string): UnwrappedUrl | undefined {
	const inner = normaliseInnerUrl(rawInner);
	return inner === undefined ? undefined : { url: inner, contentSourceUrl: `${WAYBACK_ORIGIN}/web/${inner}` };
}

function unwrapWayback(parsed: URL): UnwrappedUrl | undefined {
	const path = pathWithQuery(parsed);
	const stamped = WAYBACK_STAMPED_PATH.exec(path);
	if (stamped !== null) {
		const [, timestamp, rawInner] = stamped;
		if (WAYBACK_CAPTURE_TIMESTAMP.test(timestamp)) {
			return captureOf({ rawInner, contentSourceUrl: `${WAYBACK_ORIGIN}${path}` });
		}
		if (WAYBACK_ASSET_TIMESTAMP.test(timestamp)) return undefined;
		if (WAYBACK_CALENDAR_TIMESTAMP.test(timestamp)) return waybackLatestCaptureOf(rawInner);
	}
	const unstamped = WAYBACK_UNSTAMPED_PATH.exec(path);
	return unstamped === null ? undefined : waybackLatestCaptureOf(unstamped[1]);
}

function archiveTodayNewestOf(params: { origin: string; rawInner: string }): UnwrappedUrl | undefined {
	const inner = normaliseInnerUrl(params.rawInner);
	return inner === undefined ? undefined : { url: inner, contentSourceUrl: `${params.origin}/newest/${inner}` };
}

function unwrapArchiveToday(parsed: URL): UnwrappedUrl | undefined {
	const { origin, pathname } = parsed;
	const path = pathWithQuery(parsed);
	const collapsed = ARCHIVE_TODAY_SCREENSHOT.exec(pathname) ?? ARCHIVE_TODAY_WIP.exec(pathname);
	if (collapsed !== null) return { url: `${origin}/${collapsed[1]}` };
	const outbound = ARCHIVE_TODAY_OUTBOUND.exec(path);
	if (outbound !== null) return captureOf({ rawInner: outbound[2], contentSourceUrl: `${origin}/${outbound[1]}` });
	const exact = ARCHIVE_TODAY_SELECTOR.exec(path) ?? ARCHIVE_TODAY_SNAPSHOT.exec(path);
	if (exact !== null) return captureOf({ rawInner: exact[1], contentSourceUrl: parsed.href });
	const listing = ARCHIVE_TODAY_PARTIAL_TIMESTAMP.exec(path) ?? ARCHIVE_TODAY_LISTING.exec(path);
	return listing === null ? undefined : archiveTodayNewestOf({ origin, rawInner: listing[1] });
}

function unwrapArchive(parsed: URL): UnwrappedUrl | undefined {
	const host = hostnameOf(parsed);
	if (WAYBACK_HOSTS.has(host)) return unwrapWayback(parsed);
	if (ARCHIVE_TODAY_HOSTS.has(host)) return unwrapArchiveToday(parsed);
	return undefined;
}

function isArchiveTodayShortId(parsed: URL): boolean {
	return (
		ARCHIVE_TODAY_HOSTS.has(hostnameOf(parsed)) &&
		OPAQUE_TOKEN_PATH.test(parsed.pathname) &&
		!ARCHIVE_TODAY_RESERVED_SEGMENTS.has(parsed.pathname.slice(1))
	);
}

export function wrapperFamilyOf(url: string): WrapperFamily | undefined {
	const parsed = parseHttpUrl(url);
	if (parsed === undefined) return undefined;
	const host = hostnameOf(parsed);
	if (NEWSLETTER_TRACKERS.some((rule) => matchesTracker(rule, host, parsed))) return "newsletter-tracker";
	if (APPLE_NEWS_HOSTS.has(host) && OPAQUE_TOKEN_PATH.test(parsed.pathname)) return "apple-news";
	if (unwrapArchive(parsed) !== undefined || isArchiveTodayShortId(parsed)) return "archive-snapshot";
	return undefined;
}

export function isArchiveHost(url: string): boolean {
	const parsed = parseHttpUrl(url);
	return parsed !== undefined && ARCHIVE_HOSTS.has(hostnameOf(parsed));
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
	const archived = unwrapArchive(parsed);
	if (archived !== undefined) return archived;
	if (TWEET_INTENT_HOSTS.has(hostnameOf(parsed)) && TWEET_INTENT_PATH.test(parsed.pathname)) {
		return unwrapTweetIntent(url, parsed);
	}
	return { url };
}

export function wrapperResolutionOf(url: string): WrapperResolution {
	if (wrapperFamilyOf(url) === undefined) return "none";
	const unwrapped = unwrapWrapperUrl(url).url;
	return unwrapped !== url && wrapperFamilyOf(unwrapped) === undefined ? "syntactic" : "network";
}

export function isUnresolvedArchiveCapture(url: string): boolean {
	return wrapperFamilyOf(url) === "archive-snapshot" && wrapperResolutionOf(url) === "network";
}

export function stripRedirectAddedParams(params: { wrapperUrl: string; targetUrl: string }): string {
	const wrapper = parseHttpUrl(params.wrapperUrl);
	if (wrapper === undefined || !SUBSTACK_HOSTS.has(hostnameOf(wrapper))) return params.targetUrl;
	const target = parseHttpUrl(params.targetUrl);
	if (target === undefined) return params.targetUrl;
	for (const name of SUBSTACK_REDIRECT_PARAMS) target.searchParams.delete(name);
	return target.href;
}
