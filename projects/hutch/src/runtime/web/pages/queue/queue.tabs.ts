import type { ArticleStatus } from "@packages/domain/article";
import type { SortField, SortOrder } from "@packages/test-fixtures/providers/article-store";

export type TabId = "queue" | "done";

interface TabQuery {
	status: ArticleStatus;
	sort: SortField;
	defaultOrder: SortOrder;
}

const tabs: Record<TabId, TabQuery> = {
	queue: { status: "unread", sort: "savedAt", defaultOrder: "desc" },
	done: { status: "read", sort: "readAt", defaultOrder: "desc" },
};

export function tabQuery(tab: TabId): TabQuery {
	return tabs[tab];
}
