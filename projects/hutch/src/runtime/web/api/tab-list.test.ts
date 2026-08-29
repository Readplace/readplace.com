import type { ArticleStatus } from "@packages/domain/article";
import { buildTabList } from "./tab-list";

const tabs = [
	{ label: "To Read", status: "unread" },
	{ label: "Read", status: "read" },
] as const satisfies readonly { label: string; status: ArticleStatus }[];

const hrefForStatus = (status: ArticleStatus) => `/queue?status=${status}`;

describe("buildTabList", () => {
	it("marks the unread tab current when the collection lists unread articles", () => {
		expect(buildTabList({ tabs, currentStatus: "unread", hrefForStatus })).toEqual([
			{ label: "To Read", rel: "current", href: "/queue?status=unread" },
			{ label: "Read", rel: "tab", href: "/queue?status=read" },
		]);
	});

	it("marks the read tab current when the collection lists read articles", () => {
		expect(buildTabList({ tabs, currentStatus: "read", hrefForStatus })).toEqual([
			{ label: "To Read", rel: "tab", href: "/queue?status=unread" },
			{ label: "Read", rel: "current", href: "/queue?status=read" },
		]);
	});

	it("marks no tab current when the collection is not filtered by status", () => {
		expect(buildTabList({ tabs, currentStatus: undefined, hrefForStatus })).toEqual([
			{ label: "To Read", rel: "tab", href: "/queue?status=unread" },
			{ label: "Read", rel: "tab", href: "/queue?status=read" },
		]);
	});

	it("takes each href from the caller so tab URLs stay server-built", () => {
		const entries = buildTabList({
			tabs,
			currentStatus: "unread",
			hrefForStatus: (status) => `/queue?status=${status}&order=asc`,
		});

		expect(entries.map((entry) => entry.href)).toEqual([
			"/queue?status=unread&order=asc",
			"/queue?status=read&order=asc",
		]);
	});
});
