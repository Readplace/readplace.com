import { z } from "zod";
import {
	READ_TIME_BUCKETS,
	SAVED_WINDOWS,
	UNTOPICED_FACET,
	resolveArticleDiscovery,
	toArticleTopics,
	type ArticleDiscoveryQuery,
	type ArticleTopic,
	type ArticleTopicFacet,
	type ReadTimeBucketId,
	type SavedWindowId,
} from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import type { SortOrder } from "@packages/provider-contracts/article-store";
import { TAB_IDS, type TabId, tabQuery } from "./readlist.tabs";

/** Single source of truth for where the readlist router is mounted. Its redirects,
 * links and analytics paths — plus the skipped-import cookie scope and the
 * query strings built here — all derive from this constant so they can't drift
 * from the mount point. */
export const READLIST_PATH = "/queue";

export type LinkParams = readonly (readonly [string, string])[];

export interface ReadlistDiscovery {
	q?: string;
	time: ReadTimeBucketId[];
	saved: SavedWindowId[];
	topic: ArticleTopicFacet[];
}

export interface ReadlistUrlState {
	readlist: ReadlistSlug;
	tab: TabId;
	order?: SortOrder;
	discovery?: ReadlistDiscovery;
	page: number;
}

const MAX_SEARCH_LENGTH = 200;

const RepeatableParam = z.union([z.string(), z.array(z.string())]).optional().catch(undefined);

const ReadlistQuerySchema = z.looseObject({
	queue: ReadlistSlugSchema.optional().catch(undefined),
	tab: z.enum(TAB_IDS).optional().catch(undefined),
	status: z.enum(["unread", "read"]).optional().catch(undefined),
	order: z.enum(["asc", "desc"]).optional().catch(undefined),
	q: z.string().optional().catch(undefined),
	time: RepeatableParam,
	saved: RepeatableParam,
	topic: RepeatableParam,
	page: z.coerce.number().int().min(1).optional().catch(undefined),
});

function listOf(value: string | string[] | undefined): string[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

function searchQueryOf(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const q = raw.replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH_LENGTH).trimEnd();
	return q === "" ? undefined : q;
}

function topicFacetsOf(raw: readonly string[]): ArticleTopicFacet[] {
	const topics: ArticleTopic[] = [];
	for (const value of raw) {
		if (value === UNTOPICED_FACET) continue;
		const [topic] = toArticleTopics([value]);
		if (topic === undefined) continue;
		if (topics.some((kept) => kept.toLowerCase() === topic.toLowerCase())) continue;
		topics.push(topic);
	}
	topics.sort((a, b) => a.localeCompare(b));
	return raw.includes(UNTOPICED_FACET) ? [...topics, UNTOPICED_FACET] : topics;
}

function discoveryOf(parsed: z.infer<typeof ReadlistQuerySchema>): ReadlistDiscovery | undefined {
	const time = listOf(parsed.time);
	const saved = listOf(parsed.saved);
	const discovery: ReadlistDiscovery = {
		q: searchQueryOf(parsed.q),
		time: READ_TIME_BUCKETS.map((bucket) => bucket.id).filter((id) => time.includes(id)),
		saved: SAVED_WINDOWS.map((window) => window.id).filter((id) => saved.includes(id)),
		topic: topicFacetsOf(listOf(parsed.topic)),
	};
	const active =
		discovery.q !== undefined ||
		discovery.time.length > 0 ||
		discovery.saved.length > 0 ||
		discovery.topic.length > 0;
	return active ? discovery : undefined;
}

export function parseReadlistUrl(query: Record<string, unknown>): ReadlistUrlState {
	const parsed = ReadlistQuerySchema.parse(query);
	const tab = parsed.tab ?? (parsed.status === "read" ? "done" : "queue");
	return {
		readlist: parsed.queue ?? DEFAULT_READLIST_SLUG,
		tab,
		order: parsed.order,
		discovery: discoveryOf(parsed),
		page: parsed.page ?? 1,
	};
}

export function discoveryParams(discovery: ReadlistDiscovery | undefined): LinkParams {
	if (discovery === undefined) return [];
	return [
		...(discovery.q === undefined ? [] : [["q", discovery.q] as const]),
		...discovery.time.map((value) => ["time", value] as const),
		...discovery.saved.map((value) => ["saved", value] as const),
		...discovery.topic.map((value) => ["topic", value] as const),
	];
}

export function toArticleDiscoveryQuery(discovery: ReadlistDiscovery, now: Date): ArticleDiscoveryQuery {
	return resolveArticleDiscovery({ ...discovery, now });
}

function readlistQueryString(state: Partial<ReadlistUrlState>, extraParams: LinkParams = []): string {
	const params = new URLSearchParams();
	const tab = state.tab ?? "queue";
	const { defaultOrder } = tabQuery(tab);

	if (state.readlist && state.readlist !== DEFAULT_READLIST_SLUG) {
		params.set("queue", state.readlist);
	}
	if (tab !== "queue") {
		params.set("tab", tab);
	}
	if (state.order && state.order !== defaultOrder) {
		params.set("order", state.order);
	}
	for (const [key, value] of discoveryParams(state.discovery)) {
		params.append(key, value);
	}
	if (state.page && state.page > 1) {
		params.set("page", String(state.page));
	}
	for (const [key, value] of extraParams) {
		params.append(key, value);
	}

	return params.toString();
}

export function buildReadlistUrl(state: Partial<ReadlistUrlState>, extraParams: LinkParams = []): string {
	const qs = readlistQueryString(state, extraParams);
	return qs ? `${READLIST_PATH}?${qs}` : READLIST_PATH;
}

export function readlistReturnQuery(state: Partial<ReadlistUrlState>): string {
	const qs = readlistQueryString(state);
	return qs ? `?${qs}` : "";
}

export const READLIST_COUNTS_PATH = `${READLIST_PATH}/counts`;

export const READLIST_SAVE_PATH = `${READLIST_PATH}/save`;

export const READLIST_CREATE_PATH = `${READLIST_PATH}/queues`;

export const READLIST_DISMISS_ONBOARDING_PATH = `${READLIST_PATH}/dismiss-onboarding`;

export const READLIST_EMAIL_STEP_DONE_PATH = `${READLIST_PATH}/onboarding/email/done`;

export const READLIST_GMAIL_STEP_DISMISS_PATH = `${READLIST_PATH}/onboarding/gmail/dismiss`;

export function readlistRenamePath(readlist: ReadlistSlug): string {
	return `${READLIST_CREATE_PATH}/${readlist}/rename`;
}

export function readlistPreferencesPath(readlist: ReadlistSlug): string {
	return `${READLIST_CREATE_PATH}/${readlist}/preferences`;
}

export function readlistPreferencesInboxesPath(readlist: ReadlistSlug): string {
	return `${readlistPreferencesPath(readlist)}/inboxes`;
}

export function readlistPurposeDeletePath(readlist: ReadlistSlug): string {
	return `${readlistPreferencesPath(readlist)}/purpose/delete`;
}

export function readlistDeletePath(readlist: ReadlistSlug): string {
	return `${READLIST_CREATE_PATH}/${readlist}/delete`;
}

export function buildReadlistCountsUrl(state: Partial<ReadlistUrlState>): string {
	const qs = readlistQueryString(state);
	return qs ? `${READLIST_COUNTS_PATH}?${qs}` : READLIST_COUNTS_PATH;
}

export function canonicalReadlistPageRedirect(input: {
	state: ReadlistUrlState;
	total: number;
	pageSize: number;
	extraParams?: LinkParams;
}): string | undefined {
	const totalPages = Math.max(1, Math.ceil(input.total / input.pageSize));
	if (input.state.page <= totalPages) return undefined;
	return buildReadlistUrl({ ...input.state, page: totalPages }, input.extraParams);
}
