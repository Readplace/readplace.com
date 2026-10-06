export const OFFLINE_CACHE_PREFIX = "readplace-offline-";
export const OFFLINE_CACHE_NAME = `${OFFLINE_CACHE_PREFIX}v1`;

export const OFFLINE_READER_SCOPE = "/queue";

export const READER_SOURCE_MESSAGE_TYPE = "readplace:reader-source";
export const READER_SOURCE = {
	network: "network",
	offlineCopy: "offline-copy",
} as const;
export type ReaderSource = (typeof READER_SOURCE)[keyof typeof READER_SOURCE];

export type ReaderSourceMessage =
	| { type: typeof READER_SOURCE_MESSAGE_TYPE; source: typeof READER_SOURCE.network; path: string }
	| {
			type: typeof READER_SOURCE_MESSAGE_TYPE;
			source: typeof READER_SOURCE.offlineCopy;
			path: string;
			savedAt: string;
			version: string | null;
		};

export const READER_VERSION_MESSAGE_TYPE = "readplace:reader-version";
export const READER_VERSION = {
	same: "same",
	newer: "newer",
} as const;
type ReaderVersion = (typeof READER_VERSION)[keyof typeof READER_VERSION];

export interface ReaderVersionMessage {
	type: typeof READER_VERSION_MESSAGE_TYPE;
	path: string;
	version: ReaderVersion;
}

export const REVALIDATE_READER_MESSAGE_TYPE = "readplace:revalidate-reader";

export const OFFLINE_COPY_PATH_ATTRIBUTE = "data-offline-copy-path";
export const OFFLINE_COPY_SAVED_AT_ATTRIBUTE = "data-offline-copy-saved-at";

export const OFFLINE_SAVED_AT_HEADER = "Readplace-Offline-Saved-At";
export const OFFLINE_SOURCE_HEADER = "Readplace-Offline-Source";
export const ARTICLE_VERSION_HEADER = "Readplace-Article-Version";
export const OFFLINE_COPY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface OfflineCopyHeaders {
	get(name: string): string | null;
}

export function isFreshOfflineCopy(copy: { headers: OfflineCopyHeaders }, now: number): boolean {
	return now - Date.parse(String(copy.headers.get(OFFLINE_SAVED_AT_HEADER))) <= OFFLINE_COPY_MAX_AGE_MS;
}

export function stampOfflineCopy(response: Response, savedAt: number): Response {
	const headers = new Headers(response.headers);
	headers.set(OFFLINE_SAVED_AT_HEADER, new Date(savedAt).toISOString());
	if (response.url !== "") headers.set(OFFLINE_SOURCE_HEADER, response.url);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export type OfflinePageKind = "listing" | "reader";

const READER_PATH = new RegExp(`^${OFFLINE_READER_SCOPE}/[^/]+/view$`);
const CAMPAIGN_PARAM_PREFIX = "utm_";

export function offlinePageKind(url: URL): OfflinePageKind | undefined {
	if (url.pathname === OFFLINE_READER_SCOPE) return "listing";
	if (READER_PATH.test(url.pathname)) return "reader";
	return undefined;
}

function campaignFree(params: URLSearchParams): URLSearchParams {
	return new URLSearchParams(
		Array.from(params).filter(([name]) => !name.startsWith(CAMPAIGN_PARAM_PREFIX)),
	);
}

function listingQuery(params: URLSearchParams): string {
	const kept = campaignFree(params);
	kept.sort();
	return kept.toString();
}

export function withoutCampaignParams(url: URL): URL {
	const untracked = new URL(url.href);
	untracked.search = campaignFree(url.searchParams).toString();
	return untracked;
}

export function offlineCacheKey(url: URL): string {
	const page = `${url.origin}${url.pathname}`;
	if (offlinePageKind(url) !== "listing") return page;
	const query = listingQuery(url.searchParams);
	return query === "" ? page : `${page}?${query}`;
}
