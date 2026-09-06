import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import {
	renderReadlistSaveSkeleton,
	toReadlistSaveSkeletonDisplayModel,
} from "./readlist-save-skeleton.component";
import type { ReadlistUrlState } from "./readlist.url";

const DESTINATION_FILTERS: ReadlistUrlState = {
	readlist: DEFAULT_READLIST_SLUG,
	tab: "queue",
	page: 1,
};

function skeletonOf(input: {
	filters: ReadlistUrlState;
	accessIsReadOnly: boolean;
}): Element {
	const html = renderReadlistSaveSkeleton(toReadlistSaveSkeletonDisplayModel(input));
	const el = new JSDOM(html).window.document.querySelector("[data-test-save-skeleton]");
	assert(el, "the save skeleton must always render so htmx has something to reveal");
	return el;
}

describe("toReadlistSaveSkeletonDisplayModel", () => {
	it("arms the skeleton on the listing the save redirects to", () => {
		const skeleton = skeletonOf({ filters: DESTINATION_FILTERS, accessIsReadOnly: false });
		expect(skeleton.classList.contains("readlist-save-skeleton--armed")).toBe(true);
	});

	it("treats an explicit newest-first order as the same destination listing", () => {
		const skeleton = skeletonOf({
			filters: { ...DESTINATION_FILTERS, order: "desc" },
			accessIsReadOnly: false,
		});
		expect(skeleton.classList.contains("readlist-save-skeleton--armed")).toBe(true);
	});

	const inertCases: Array<{ name: string; filters: ReadlistUrlState; accessIsReadOnly: boolean }> = [
		{
			name: "a readlist the save bar does not post to",
			filters: { ...DESTINATION_FILTERS, readlist: ReadlistSlugSchema.parse("work") },
			accessIsReadOnly: false,
		},
		{ name: "the Read tab", filters: { ...DESTINATION_FILTERS, tab: "done" }, accessIsReadOnly: false },
		{ name: "oldest first", filters: { ...DESTINATION_FILTERS, order: "asc" }, accessIsReadOnly: false },
		{ name: "a later page", filters: { ...DESTINATION_FILTERS, page: 2 }, accessIsReadOnly: false },
		{ name: "read-only access", filters: DESTINATION_FILTERS, accessIsReadOnly: true },
	];

	for (const { name, filters, accessIsReadOnly } of inertCases) {
		it(`keeps the skeleton inert on ${name}`, () => {
			const skeleton = skeletonOf({ filters, accessIsReadOnly });
			expect(skeleton.classList.contains("readlist-save-skeleton--inert")).toBe(true);
		});
	}
});

describe("renderReadlistSaveSkeleton", () => {
	it("hides the skeleton from assistive tech, since the button already says Saving…", () => {
		const skeleton = skeletonOf({ filters: DESTINATION_FILTERS, accessIsReadOnly: false });
		expect(skeleton.getAttribute("aria-hidden")).toBe("true");
	});

	it("mirrors the stub card's four text bars and two action controls", () => {
		const skeleton = skeletonOf({ filters: DESTINATION_FILTERS, accessIsReadOnly: false });
		const bars = Array.from(skeleton.querySelectorAll(".readlist-save-skeleton__bar")).map((el) =>
			el.className.split(" ").filter((c) => c.startsWith("readlist-save-skeleton__bar--")).join(""),
		);
		expect(bars).toEqual([
			"readlist-save-skeleton__bar--site",
			"readlist-save-skeleton__bar--time",
			"readlist-save-skeleton__bar--title",
			"readlist-save-skeleton__bar--excerpt",
		]);
		expect(skeleton.querySelectorAll(".readlist-save-skeleton__action").length).toBe(2);
	});

	it("says Saving… so the skeleton reads as the save in flight", () => {
		const skeleton = skeletonOf({ filters: DESTINATION_FILTERS, accessIsReadOnly: false });
		const status = skeleton.querySelector(".readlist-save-skeleton__status");
		assert(status, "the skeleton must carry the Saving… status row");
		expect(status.textContent).toBe("Saving…");
	});
});
