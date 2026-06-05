import { z } from "zod";
import type { SortOrder } from "@packages/provider-contracts/article-store";
import { type TabId, tabQuery } from "./queue.tabs";

/** Mount path of the queue router (`app.use(QUEUE_PATH, …)` in server.ts). The
 * queue router builds its redirects, links and analytics paths — plus the
 * skipped-import cookie scope and the query strings `buildQueueUrl` produces —
 * from this constant so they can't drift from where the router is mounted. */
export const QUEUE_PATH = "/queue";

export interface QueueUrlState {
	tab: TabId;
	order?: SortOrder;
	page: number;
}

const QueueQuerySchema = z.object({
	tab: z.enum(["queue", "done", "resurfaced"]).optional().catch(undefined),
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

	if (tab !== "queue") {
		params.set("tab", tab);
	}
	/** The resurfaced tab is relevance-ordered and single-page, so it carries
	 * neither an order nor a page parameter. */
	if (tab !== "resurfaced") {
		const { defaultOrder } = tabQuery(tab);
		if (state.order && state.order !== defaultOrder) {
			params.set("order", state.order);
		}
		if (state.page && state.page > 1) {
			params.set("page", String(state.page));
		}
	}
	for (const [key, value] of extraParams) {
		params.append(key, value);
	}

	const qs = params.toString();
	return qs ? `${QUEUE_PATH}?${qs}` : QUEUE_PATH;
}
