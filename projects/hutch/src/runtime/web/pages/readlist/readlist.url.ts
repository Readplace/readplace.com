import { z } from "zod";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import type { SortOrder } from "@packages/provider-contracts/article-store";
import { TAB_IDS, type TabId, tabQuery } from "./readlist.tabs";

/** Single source of truth for where the readlist router is mounted. Its redirects,
 * links and analytics paths — plus the skipped-import cookie scope and the
 * query strings built here — all derive from this constant so they can't drift
 * from the mount point. */
export const READLIST_PATH = "/queue";

export type LinkParams = readonly (readonly [string, string])[];

export interface ReadlistUrlState {
	readlist: ReadlistSlug;
	tab: TabId;
	order?: SortOrder;
	page: number;
}

const ReadlistQuerySchema = z.looseObject({
	queue: ReadlistSlugSchema.optional().catch(undefined),
	tab: z.enum(TAB_IDS).optional().catch(undefined),
	status: z.enum(["unread", "read"]).optional().catch(undefined),
	order: z.enum(["asc", "desc"]).optional().catch(undefined),
	page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export function parseReadlistUrl(query: Record<string, unknown>): ReadlistUrlState {
	const parsed = ReadlistQuerySchema.parse(query);
	const tab = parsed.tab ?? (parsed.status === "read" ? "done" : "queue");
	return {
		readlist: parsed.queue ?? DEFAULT_READLIST_SLUG,
		tab,
		order: parsed.order,
		page: parsed.page ?? 1,
	};
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

export function readlistRenamePath(readlist: ReadlistSlug): string {
	return `${READLIST_CREATE_PATH}/${readlist}/rename`;
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
