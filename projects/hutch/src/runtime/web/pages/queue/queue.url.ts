import { z } from "zod";
import { DEFAULT_QUEUE_SLUG, QueueSlugSchema, type QueueSlug } from "@packages/domain/queue";
import type { SortOrder } from "@packages/provider-contracts/article-store";
import { TAB_IDS, type TabId, tabQuery } from "./queue.tabs";

/** Single source of truth for where the queue router is mounted. Its redirects,
 * links and analytics paths — plus the skipped-import cookie scope and the
 * query strings built here — all derive from this constant so they can't drift
 * from the mount point. */
export const QUEUE_PATH = "/queue";

export type LinkParams = readonly (readonly [string, string])[];

export interface QueueUrlState {
	queue: QueueSlug;
	tab: TabId;
	order?: SortOrder;
	page: number;
}

const QueueQuerySchema = z.looseObject({
	queue: QueueSlugSchema.optional().catch(undefined),
	tab: z.enum(TAB_IDS).optional().catch(undefined),
	status: z.enum(["unread", "read"]).optional().catch(undefined),
	order: z.enum(["asc", "desc"]).optional().catch(undefined),
	page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export function parseQueueUrl(query: Record<string, unknown>): QueueUrlState {
	const parsed = QueueQuerySchema.parse(query);
	const tab = parsed.tab ?? (parsed.status === "read" ? "done" : "queue");
	return {
		queue: parsed.queue ?? DEFAULT_QUEUE_SLUG,
		tab,
		order: parsed.order,
		page: parsed.page ?? 1,
	};
}

function queueQueryString(state: Partial<QueueUrlState>, extraParams: LinkParams = []): string {
	const params = new URLSearchParams();
	const tab = state.tab ?? "queue";
	const { defaultOrder } = tabQuery(tab);

	if (state.queue && state.queue !== DEFAULT_QUEUE_SLUG) {
		params.set("queue", state.queue);
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

export function buildQueueUrl(state: Partial<QueueUrlState>, extraParams: LinkParams = []): string {
	const qs = queueQueryString(state, extraParams);
	return qs ? `${QUEUE_PATH}?${qs}` : QUEUE_PATH;
}

export function queueReturnQuery(state: Partial<QueueUrlState>, extraParams: LinkParams = []): string {
	const qs = queueQueryString(state, extraParams);
	return qs ? `?${qs}` : "";
}

export const QUEUE_COUNTS_PATH = `${QUEUE_PATH}/counts`;

export const QUEUE_SAVE_PATH = `${QUEUE_PATH}/save`;

export const QUEUE_CREATE_PATH = `${QUEUE_PATH}/queues`;

export const QUEUE_DISMISS_ONBOARDING_PATH = `${QUEUE_PATH}/dismiss-onboarding`;

export function buildQueueCountsUrl(
	state: Partial<QueueUrlState>,
	extraParams: LinkParams = [],
): string {
	const qs = queueQueryString(state, extraParams);
	return qs ? `${QUEUE_COUNTS_PATH}?${qs}` : QUEUE_COUNTS_PATH;
}

export function canonicalQueuePageRedirect(input: {
	state: QueueUrlState;
	total: number;
	pageSize: number;
	extraParams?: LinkParams;
}): string | undefined {
	const totalPages = Math.max(1, Math.ceil(input.total / input.pageSize));
	if (input.state.page <= totalPages) return undefined;
	return buildQueueUrl({ ...input.state, page: totalPages }, input.extraParams);
}
