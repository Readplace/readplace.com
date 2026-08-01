import { buildPageList } from "./page-list";

const hrefForPage = (pageNumber: number) => `/queue?page=${pageNumber}`;

describe("buildPageList", () => {
	it("describes a single page as the current one", () => {
		expect(buildPageList({ currentPage: 1, totalPages: 1, hrefForPage })).toEqual([
			{ label: "1", rel: "current", href: "/queue?page=1" },
		]);
	});

	it("describes an empty collection as one current page", () => {
		expect(buildPageList({ currentPage: 1, totalPages: 0, hrefForPage })).toEqual([
			{ label: "1", rel: "current", href: "/queue?page=1" },
		]);
	});

	it("repeats prev before the current page and next after it", () => {
		expect(buildPageList({ currentPage: 3, totalPages: 5, hrefForPage })).toEqual([
			{ label: "1", rel: "prev", href: "/queue?page=1" },
			{ label: "2", rel: "prev", href: "/queue?page=2" },
			{ label: "3", rel: "current", href: "/queue?page=3" },
			{ label: "4", rel: "next", href: "/queue?page=4" },
			{ label: "5", rel: "next", href: "/queue?page=5" },
		]);
	});

	it("marks every page after the first as next when the first is current", () => {
		expect(buildPageList({ currentPage: 1, totalPages: 3, hrefForPage })).toEqual([
			{ label: "1", rel: "current", href: "/queue?page=1" },
			{ label: "2", rel: "next", href: "/queue?page=2" },
			{ label: "3", rel: "next", href: "/queue?page=3" },
		]);
	});

	it("marks every page before the last as prev when the last is current", () => {
		expect(buildPageList({ currentPage: 3, totalPages: 3, hrefForPage })).toEqual([
			{ label: "1", rel: "prev", href: "/queue?page=1" },
			{ label: "2", rel: "prev", href: "/queue?page=2" },
			{ label: "3", rel: "current", href: "/queue?page=3" },
		]);
	});

	it("marks every page as prev when the requested page is past the last", () => {
		expect(buildPageList({ currentPage: 99, totalPages: 2, hrefForPage })).toEqual([
			{ label: "1", rel: "prev", href: "/queue?page=1" },
			{ label: "2", rel: "prev", href: "/queue?page=2" },
		]);
	});

	it("takes each href from the caller so page URLs stay server-built", () => {
		const entries = buildPageList({
			currentPage: 1,
			totalPages: 2,
			hrefForPage: (pageNumber) => `/queue?status=unread&page=${pageNumber}`,
		});

		expect(entries.map((entry) => entry.href)).toEqual([
			"/queue?status=unread&page=1",
			"/queue?status=unread&page=2",
		]);
	});
});
