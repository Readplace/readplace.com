import type { ArticleStatus } from "@packages/domain/article";
import type { SortField, SortOrder } from "@packages/provider-contracts/article-store";

/** "resurfaced" is a virtual tab: it has no DynamoDB status of its own — its
 * contents come from the resurface cookie, intersected with the user's saved
 * articles — so it is intentionally absent from the `tabs` map below. */
export type TabId = "queue" | "done" | "resurfaced";

export type DbTabId = "queue" | "done";

interface TabQuery {
	status: ArticleStatus;
	sort: SortField;
	defaultOrder: SortOrder;
}

const tabs: Record<DbTabId, TabQuery> = {
	queue: { status: "unread", sort: "savedAt", defaultOrder: "desc" },
	done: { status: "read", sort: "readAt", defaultOrder: "desc" },
};

export function tabQuery(tab: DbTabId): TabQuery {
	return tabs[tab];
}
