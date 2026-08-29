import type { ArticleStatus } from "@packages/domain/article";
import type { SortField, SortOrder } from "@packages/provider-contracts/article-store";

export const TAB_IDS = ["queue", "done"] as const;

export type TabId = (typeof TAB_IDS)[number];

export const UNREAD_LABEL_ID = "queue-unread-label";

interface TabQuery {
	status: ArticleStatus;
	sort: SortField;
	defaultOrder: SortOrder;
}

interface TabDefinition {
	label: string;
	testFilter: string;
	trackingContent: string;
	labelId?: string;
	query: TabQuery;
}

export interface QueueTab extends TabDefinition {
	id: TabId;
}

const TAB_DEFINITIONS: Record<TabId, TabDefinition> = {
	queue: {
		label: "To Read",
		testFilter: "unread",
		trackingContent: "filter-unread",
		labelId: UNREAD_LABEL_ID,
		query: { status: "unread", sort: "savedAt", defaultOrder: "desc" },
	},
	done: {
		label: "Read",
		testFilter: "read",
		trackingContent: "filter-read",
		query: { status: "read", sort: "readAt", defaultOrder: "desc" },
	},
};

export const QUEUE_TABS: readonly QueueTab[] = TAB_IDS.map((id) => ({
	id,
	...TAB_DEFINITIONS[id],
}));

export const QUEUE_TAB_STATUSES: readonly { label: string; status: ArticleStatus }[] =
	QUEUE_TABS.map((tab) => ({ label: tab.label, status: tab.query.status }));

export function tabQuery(tab: TabId): TabQuery {
	return TAB_DEFINITIONS[tab].query;
}

export function tabLabel(tab: TabId): string {
	return TAB_DEFINITIONS[tab].label;
}
