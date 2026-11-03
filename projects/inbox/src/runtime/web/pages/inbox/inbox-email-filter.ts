import type { ReadlistSlug } from "@packages/domain/readlist";

export type InboxEmailFilter = { readlist: ReadlistSlug; show: "fit" | "rest" };

export function writeInboxEmailFilter(params: {
	search: URLSearchParams;
	filter: InboxEmailFilter | undefined;
}): void {
	if (params.filter === undefined) return;
	params.search.set("readlist", params.filter.readlist);
	params.search.set("show", params.filter.show);
}
