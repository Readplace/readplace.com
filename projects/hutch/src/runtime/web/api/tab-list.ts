import type { ArticleStatus } from "@packages/domain/article";

export type TabRel = "current" | "tab";

export interface StatusTab {
	readonly label: string;
	readonly status: ArticleStatus;
}

export interface TabListEntry {
	readonly label: string;
	readonly rel: TabRel;
	readonly href: string;
}

export function buildTabList(input: {
	tabs: readonly StatusTab[];
	currentStatus: ArticleStatus | undefined;
	hrefForStatus: (status: ArticleStatus) => string;
}): TabListEntry[] {
	return input.tabs.map((tab) => ({
		label: tab.label,
		rel: tab.status === input.currentStatus ? "current" : "tab",
		href: input.hrefForStatus(tab.status),
	}));
}
