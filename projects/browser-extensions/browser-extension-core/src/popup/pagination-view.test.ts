import type { PageDescriptor, PageRel } from "../reading-list/reading-list.types";
import { buildPaginationView } from "./pagination-view";

function pageList(params: { total: number; current: number }): PageDescriptor[] {
	return Array.from({ length: params.total }, (_, index) => {
		const pageNumber = index + 1;
		const rel: PageRel =
			pageNumber < params.current ? "prev" : pageNumber === params.current ? "current" : "next";
		return { label: String(pageNumber), rel };
	});
}

function labels(view: ReturnType<typeof buildPaginationView>): string[] {
	return view.pages.map((page) => ("gap" in page ? "…" : page.label));
}

describe("buildPaginationView", () => {
	it("hides the pager when the whole list fits on one page", () => {
		expect(buildPaginationView(pageList({ total: 1, current: 1 }))).toEqual({
			hidden: true,
			previous: undefined,
			next: undefined,
			pages: [],
		});
	});

	it("hides the pager when the server advertised no pages at all", () => {
		expect(buildPaginationView([])).toEqual({
			hidden: true,
			previous: undefined,
			next: undefined,
			pages: [],
		});
	});

	it("shows every page while they still fit, marking the current one", () => {
		const view = buildPaginationView(pageList({ total: 3, current: 2 }));

		expect(view.hidden).toBe(false);
		expect(view.pages).toEqual([
			{ label: "1", index: 0, active: false },
			{ label: "2", index: 1, active: true },
			{ label: "3", index: 2, active: false },
		]);
	});

	it("steps to the pages either side of the current one", () => {
		const view = buildPaginationView(pageList({ total: 3, current: 2 }));

		expect(view.previous).toBe(0);
		expect(view.next).toBe(2);
	});

	it("offers no step back from the first page", () => {
		const view = buildPaginationView(pageList({ total: 3, current: 1 }));

		expect(view.previous).toBeUndefined();
		expect(view.next).toBe(1);
	});

	it("offers no step forward from the last page", () => {
		const view = buildPaginationView(pageList({ total: 3, current: 3 }));

		expect(view.previous).toBe(1);
		expect(view.next).toBeUndefined();
	});

	it("keeps the first and last pages in view around a window in the middle", () => {
		const view = buildPaginationView(pageList({ total: 50, current: 25 }));

		expect(labels(view)).toEqual(["1", "…", "23", "24", "25", "26", "27", "…", "50"]);
	});

	it("needs no gap where the window already reaches an end", () => {
		const view = buildPaginationView(pageList({ total: 50, current: 2 }));

		expect(labels(view)).toEqual(["1", "2", "3", "4", "5", "…", "50"]);
	});

	it("clamps the window against the last page", () => {
		const view = buildPaginationView(pageList({ total: 50, current: 49 }));

		expect(labels(view)).toEqual(["1", "…", "46", "47", "48", "49", "50"]);
	});

	it("renders the server's own labels, whatever they say", () => {
		const view = buildPaginationView([
			{ label: "Newest", rel: "current" },
			{ label: "Older", rel: "next" },
		]);

		expect(labels(view)).toEqual(["Newest", "Older"]);
	});

	it("still offers every page when the reader asked for one past the last", () => {
		const view = buildPaginationView([
			{ label: "1", rel: "prev" },
			{ label: "2", rel: "prev" },
		]);

		expect(view.pages).toEqual([
			{ label: "1", index: 0, active: false },
			{ label: "2", index: 1, active: false },
		]);
		expect(view.previous).toBeUndefined();
		expect(view.next).toBeUndefined();
	});
});
