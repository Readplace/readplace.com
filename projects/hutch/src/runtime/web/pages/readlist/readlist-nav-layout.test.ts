import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { composeReadlistNav } from "./readlist-nav-layout";
import { DEFAULT_READLIST } from "./readlist.nav";

const slug = (value: string) => ReadlistSlugSchema.parse(value);

function readlistsNamed(count: number) {
	return [
		DEFAULT_READLIST,
		...Array.from({ length: count }, (_, index) => ({ slug: slug(`r${index + 1}`), label: `R${index + 1}` })),
	];
}

const slugsOf = (entries: readonly { slug: string }[]) => entries.map((entry) => entry.slug);

describe("composeReadlistNav", () => {
	it("lists every readlist in today's nav at seven named readlists, whatever is pinned", () => {
		const readlists = readlistsNamed(7);

		const layout = composeReadlistNav({ readlists, pinned: [slug("r3")], currentSlug: slug("r1") });

		assert.equal(layout.mode, "today");
		assert.deepEqual(layout.railEntries, readlists);
		assert.deepEqual(layout.moreEntries, []);
		assert.equal(layout.moreCount, 0);
	});

	it("fills the rail with the earliest readlists when nothing is pinned", () => {
		const layout = composeReadlistNav({ readlists: readlistsNamed(8), pinned: [], currentSlug: DEFAULT_READLIST_SLUG });

		assert.equal(layout.mode, "pinned-rail");
		assert.deepEqual(slugsOf(layout.railEntries), [DEFAULT_READLIST_SLUG, "r1", "r2", "r3", "r4"]);
		assert.deepEqual(slugsOf(layout.moreEntries), ["r5", "r6", "r7", "r8"]);
		assert.equal(layout.moreCount, 4);
	});

	it("puts pinned readlists first in pin order, then the earliest", () => {
		const layout = composeReadlistNav({
			readlists: readlistsNamed(8),
			pinned: [slug("r6"), slug("r2")],
			currentSlug: slug("r2"),
		});

		assert.deepEqual(slugsOf(layout.railEntries), [DEFAULT_READLIST_SLUG, "r6", "r2", "r1", "r3"]);
		assert.deepEqual(slugsOf(layout.moreEntries), ["r4", "r5", "r7", "r8"]);
		assert.equal(layout.moreCount, 4);
	});

	it("adds the current readlist under All when it is not on the rail", () => {
		const layout = composeReadlistNav({ readlists: readlistsNamed(8), pinned: [], currentSlug: slug("r8") });

		assert.deepEqual(slugsOf(layout.railEntries), [DEFAULT_READLIST_SLUG, "r8", "r1", "r2", "r3", "r4"]);
		assert.deepEqual(slugsOf(layout.moreEntries), ["r5", "r6", "r7"]);
		assert.equal(layout.moreCount, 3);
	});

	it("shows only the first four pins when more are stored", () => {
		const pinned = ["r9", "r2", "r12", "r5", "r7"].map(slug);

		const layout = composeReadlistNav({ readlists: readlistsNamed(15), pinned, currentSlug: DEFAULT_READLIST_SLUG });

		assert.deepEqual(slugsOf(layout.railEntries), [DEFAULT_READLIST_SLUG, "r9", "r2", "r12", "r5"]);
		assert.equal(layout.moreCount, 11);
	});

	it("skips a pin whose readlist is gone", () => {
		const layout = composeReadlistNav({
			readlists: readlistsNamed(8),
			pinned: [slug("gone"), slug("r5")],
			currentSlug: DEFAULT_READLIST_SLUG,
		});

		assert.deepEqual(slugsOf(layout.railEntries), [DEFAULT_READLIST_SLUG, "r5", "r1", "r2", "r3"]);
	});
});
