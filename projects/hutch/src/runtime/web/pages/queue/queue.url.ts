import { z } from "zod";
import type { SortOrder } from "@packages/provider-contracts/article-store";
import { type TabId, tabQuery } from "./queue.tabs";

/** Mount path of the queue router (`app.use(QUEUE_PATH, …)` in server.ts) and
 * the single source every queue URL derives from — analytics paths, redirects,
 * links, the skipped-import cookie scope, and the query strings `buildQueueUrl`
 * produces — so none can drift from where the router is actually mounted. */
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
