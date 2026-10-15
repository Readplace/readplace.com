import type { SortOrder } from "@packages/provider-contracts/article-store";
import { buildSortList } from "./sort-list";

const options = [
	{ label: "Newest first", order: "desc" },
	{ label: "Oldest first", order: "asc" },
] as const satisfies readonly { label: string; order: SortOrder }[];

const hrefForOrder = (order: SortOrder) => `/queue?order=${order}`;

describe("buildSortList", () => {
	it("marks newest first current when the collection is served newest first", () => {
		expect(buildSortList({ options, currentOrder: "desc", hrefForOrder })).toEqual([
			{ label: "Newest first", rel: "current", order: "desc", href: "/queue?order=desc" },
			{ label: "Oldest first", rel: "sort", order: "asc", href: "/queue?order=asc" },
		]);
	});

	it("marks oldest first current when the collection is served oldest first", () => {
		expect(buildSortList({ options, currentOrder: "asc", hrefForOrder })).toEqual([
			{ label: "Newest first", rel: "sort", order: "desc", href: "/queue?order=desc" },
			{ label: "Oldest first", rel: "current", order: "asc", href: "/queue?order=asc" },
		]);
	});

	it("takes each href from the caller so sort URLs stay server-built", () => {
		const entries = buildSortList({
			options,
			currentOrder: "desc",
			hrefForOrder: (order) => `/queue?status=unread&order=${order}`,
		});

		expect(entries.map((entry) => entry.href)).toEqual([
			"/queue?status=unread&order=desc",
			"/queue?status=unread&order=asc",
		]);
	});
});
