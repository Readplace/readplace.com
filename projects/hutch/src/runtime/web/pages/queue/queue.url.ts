import { z } from "zod";
import type { SortOrder } from "@packages/provider-contracts/article-store";
import { type TabId, tabQuery } from "./queue.tabs";

/** Single source of truth for where the queue router is mounted. Its redirects,
 * links and analytics paths — plus the skipped-import cookie scope and the
 * query strings built here — all derive from this constant so they can't drift
 * from the mount point. */
export const QUEUE_PATH = "/queue";

export interface QueueUrlState {
	tab: TabId;
	order?: SortOrder;
	page: number;
}

const QueueQuerySchema = z.object({
	tab: z.enum(["queue", "done"]).optional().catch(undefined),
	status: z.enum(["unread", "read"]).optional().catch(undefined),
	order: z.enum(["asc", "desc"]).optional().catch(undefined),
	page: z.coerce.number().int().min(1).optional().catch(undefined),
}).passthrough();

export function parseQueueUrl(query: Record<string, unknown>): QueueUrlState {
	const parsed = QueueQuerySchema.parse(query);
	const tab = parsed.tab ?? (parsed.status === "read" ? "done" : "queue");
	return {
		tab,
		order: parsed.order,
		page: parsed.page ?? 1,
	};
}

export function buildQueueUrl(
	state: Partial<QueueUrlState>,
	extraParams: readonly (readonly [string, string])[] = [],
): string {
	const params = new URLSearchParams();
	const tab = state.tab ?? "queue";
	const { defaultOrder } = tabQuery(tab);

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

	const qs = params.toString();
	return qs ? `${QUEUE_PATH}?${qs}` : QUEUE_PATH;
}

/** This read-boundary clamp must compute the last page the same way the
 * rendered pagination does, so they agree on where the list ends and can't
 * diverge. */
export function canonicalQueuePageRedirect(input: {
	state: QueueUrlState;
	total: number;
	pageSize: number;
	extraParams?: readonly (readonly [string, string])[];
}): string | undefined {
	const totalPages = Math.max(1, Math.ceil(input.total / input.pageSize));
	if (input.state.page <= totalPages) return undefined;
	return buildQueueUrl({ ...input.state, page: totalPages }, input.extraParams);
}
