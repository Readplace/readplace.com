import { z } from "zod";
import type { SortOrder } from "@packages/test-fixtures/providers/article-store";
import { type TabId, tabQuery } from "./queue.tabs";

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

export function buildQueueUrl(state: Partial<QueueUrlState>): string {
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

	const qs = params.toString();
	return qs ? `/queue?${qs}` : "/queue";
}
