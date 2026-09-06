import { READLIST_LABEL_MAX_LENGTH, READLIST_MAX_PER_USER, ReadlistSlugSchema } from "@packages/domain/readlist";
import { buildReaderReadlistFiling } from "./reader-readlist-filing";

const WORK = ReadlistSlugSchema.parse("work");
const LATER = ReadlistSlugSchema.parse("later");
const CREATE = {
	createUrl: "/queue/abc123/create-and-assign?utm_source=reader-readlists&utm_medium=internal&utm_content=create-and-assign",
	maxLength: READLIST_LABEL_MAX_LENGTH,
};

describe("buildReaderReadlistFiling", () => {
	it("offers just the create row when the reader owns no readlists yet", () => {
		const filing = buildReaderReadlistFiling({
			articleId: "abc123",
			definitions: [],
			saves: [{}],
			returnTo: "/queue/abc123/view",
			markStatusConfirmGated: false,
		});

		expect(filing.tags).toBeUndefined();
		expect(filing.picker).toEqual({
			assignUrl: "/queue/abc123/assign?utm_source=reader-readlists&utm_medium=internal&utm_content=assign",
			returnTo: "/queue/abc123/view",
			options: [],
			create: CREATE,
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
			unassignUrl: "/queue/abc123/unassign?utm_source=reader-readlists&utm_medium=internal&utm_content=unassign",
			returnTo: "/queue/abc123/view",
			tags: [{ slug: WORK, label: "Work" }],
		});
		expect(filing.picker).toEqual({
			assignUrl: "/queue/abc123/assign?utm_source=reader-readlists&utm_medium=internal&utm_content=assign",
			returnTo: "/queue/abc123/view",
			options: [{ slug: LATER, label: "Later" }],
			create: CREATE,
		});
	});

	it("keeps the create row once every owned readlist already holds the article", () => {
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

		expect(filing.picker).toEqual({
			assignUrl: "/queue/abc123/assign?utm_source=reader-readlists&utm_medium=internal&utm_content=assign",
			returnTo: "/queue/abc123/view",
			options: [],
			create: CREATE,
		});
		expect(filing.tags?.tags).toEqual([
			{ slug: WORK, label: "Work" },
			{ slug: LATER, label: "Later" },
		]);
	});

	it("drops the create row once the reader is at the readlist cap", () => {
		const definitions = Array.from({ length: READLIST_MAX_PER_USER }, (_unused, index) => ({
			slug: ReadlistSlugSchema.parse(`readlist${index}`),
			label: `Readlist ${index}`,
			createdAt: new Date("2026-08-01T00:00:00.000Z"),
		}));

		const filing = buildReaderReadlistFiling({
			articleId: "abc123",
			definitions,
			saves: [{}],
			returnTo: "/queue/abc123/view",
			markStatusConfirmGated: false,
		});

		expect(filing.picker?.create).toBeUndefined();
		expect(filing.picker?.options).toEqual(
			definitions.map(({ slug, label }) => ({ slug, label })),
		);
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
