import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { readlistHref, readlistsAtHrefs } from "./readlist-href";

const ALL = { slug: DEFAULT_READLIST_SLUG, label: "All" };
const WORK = { slug: ReadlistSlugSchema.parse("work"), label: "Work" };
const RECIPES = { slug: ReadlistSlugSchema.parse("recipes"), label: "Recipes" };

describe("readlistHref", () => {
	it("addresses the mainline readlist with the bare collection and every other by its own query", () => {
		expect([readlistHref(ALL.slug), readlistHref(WORK.slug)]).toEqual(["/queue", "/queue?queue=work"]);
	});
});

describe("readlistsAtHrefs", () => {
	it("resolves the hrefs the collection advertised back to the reader's own readlists, in the order they were sent", () => {
		expect(
			readlistsAtHrefs({
				hrefs: [readlistHref(RECIPES.slug), readlistHref(WORK.slug)],
				readlists: [ALL, WORK, RECIPES],
			}),
		).toEqual([RECIPES, WORK]);
	});

	it("resolves the mainline readlist's bare href too, so the caller decides what it means", () => {
		expect(readlistsAtHrefs({ hrefs: [readlistHref(ALL.slug)], readlists: [ALL, WORK] })).toEqual([
			ALL,
		]);
	});

	it("ignores an href that names no readlist at all", () => {
		expect(
			readlistsAtHrefs({
				hrefs: ["/help/add-links", readlistHref(WORK.slug)],
				readlists: [ALL, WORK],
			}),
		).toEqual([WORK]);
	});

	it("ignores an href for a readlist the reader does not own", () => {
		expect(
			readlistsAtHrefs({
				hrefs: [readlistHref(RECIPES.slug), readlistHref(WORK.slug)],
				readlists: [ALL, WORK],
			}),
		).toEqual([WORK]);
	});

	it("resolves a duplicated href to a single readlist", () => {
		expect(
			readlistsAtHrefs({
				hrefs: [readlistHref(WORK.slug), readlistHref(WORK.slug)],
				readlists: [ALL, WORK],
			}),
		).toEqual([WORK]);
	});
});
