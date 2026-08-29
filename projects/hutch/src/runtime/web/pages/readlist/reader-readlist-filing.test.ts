import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { buildReaderReadlistFiling } from "./reader-readlist-filing";

const WORK = ReadlistSlugSchema.parse("work");
const LATER = ReadlistSlugSchema.parse("later");

describe("buildReaderReadlistFiling", () => {
	it("offers nothing when the reader owns no readlists", () => {
		const filing = buildReaderReadlistFiling({
			articleId: "abc123",
			definitions: [],
			saves: [{}],
			returnTo: "/queue/abc123/view",
			markStatusConfirmGated: false,
		});

		expect(filing).toEqual({
			tags: undefined,
			picker: undefined,
			markStatusConfirmReadlistLabels: undefined,
		});
	});

	it("splits owned readlists into tags for memberships and picker options for the rest", () => {
		const filing = buildReaderReadlistFiling({
			articleId: "abc123",
			definitions: [
				{ slug: WORK, label: "Work", createdAt: new Date("2026-08-01T00:00:00.000Z") },
				{ slug: LATER, label: "Later", createdAt: new Date("2026-08-01T00:00:00.000Z") },
			],
			saves: [{}, { readlist: WORK }],
			returnTo: "/queue/abc123/view",
			markStatusConfirmGated: false,
		});

		expect(filing.tags).toEqual({
			unassignUrl: "/queue/abc123/unassign",
			returnTo: "/queue/abc123/view",
			tags: [{ slug: WORK, label: "Work" }],
		});
		expect(filing.picker).toEqual({
			assignUrl: "/queue/abc123/assign",
			returnTo: "/queue/abc123/view",
			options: [{ slug: LATER, label: "Later" }],
		});
	});

	it("retires the picker once every owned readlist holds the article", () => {
		const filing = buildReaderReadlistFiling({
			articleId: "abc123",
			definitions: [
				{ slug: WORK, label: "Work", createdAt: new Date("2026-08-01T00:00:00.000Z") },
				{ slug: LATER, label: "Later", createdAt: new Date("2026-08-01T00:00:00.000Z") },
			],
			saves: [{}, { readlist: WORK }, { readlist: LATER }],
			returnTo: "/queue/abc123/view",
			markStatusConfirmGated: false,
		});

		expect(filing.picker).toBeUndefined();
		expect(filing.tags?.tags).toEqual([
			{ slug: WORK, label: "Work" },
			{ slug: LATER, label: "Later" },
		]);
	});

	it("names every readlist the article sits in, default first, once the confirmation is gated on", () => {
		const filing = buildReaderReadlistFiling({
			articleId: "abc123",
			definitions: [
				{ slug: WORK, label: "Work", createdAt: new Date("2026-08-01T00:00:00.000Z") },
				{ slug: LATER, label: "Later", createdAt: new Date("2026-08-01T00:00:00.000Z") },
			],
			saves: [{}, { readlist: LATER }],
			returnTo: "/queue/abc123/view",
			markStatusConfirmGated: true,
		});

		expect(filing.markStatusConfirmReadlistLabels).toEqual(["All", "Later"]);
	});

	it("withholds the picker from an article with no default-readlist copy to assign from", () => {
		const filing = buildReaderReadlistFiling({
			articleId: "abc123",
			definitions: [
				{ slug: WORK, label: "Work", createdAt: new Date("2026-08-01T00:00:00.000Z") },
				{ slug: LATER, label: "Later", createdAt: new Date("2026-08-01T00:00:00.000Z") },
			],
			saves: [{ readlist: WORK }],
			returnTo: "/queue/abc123/view",
			markStatusConfirmGated: false,
		});

		expect(filing.picker).toBeUndefined();
		expect(filing.tags?.tags).toEqual([{ slug: WORK, label: "Work" }]);
	});
});
