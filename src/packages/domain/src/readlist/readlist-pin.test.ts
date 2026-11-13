import assert from "node:assert/strict";
import { DEFAULT_READLIST } from "./reader-readlists";
import { DEFAULT_READLIST_SLUG, READLIST_PINNED_MAX, ReadlistSlugSchema } from "./readlist-name.schema";
import { decideReadlistPin, pinnedReadlistSlugs } from "./readlist-pin";

const slug = (value: string) => ReadlistSlugSchema.parse(value);
const readlists = [
	DEFAULT_READLIST,
	...["r1", "r2", "r3", "r4", "r5", "r6"].map((value) => ({ slug: slug(value), label: value })),
];

describe("pinnedReadlistSlugs", () => {
	it("lists only pinned readlists, earliest pin first", () => {
		assert.deepEqual(
			pinnedReadlistSlugs([
				{ slug: slug("r1") },
				{ slug: slug("r2"), pinnedAt: new Date("2026-11-03T00:00:00Z") },
				{ slug: slug("r3"), pinnedAt: new Date("2026-11-01T00:00:00Z") },
			]),
			["r3", "r2"],
		);
	});

	it("orders readlists pinned at the same moment by id", () => {
		const pinnedAt = new Date("2026-11-01T00:00:00Z");
		assert.deepEqual(
			pinnedReadlistSlugs([
				{ slug: slug("r5"), pinnedAt },
				{ slug: slug("r2"), pinnedAt },
			]),
			["r2", "r5"],
		);
	});
});

describe("decideReadlistPin", () => {
	it("pins a readlist the reader owns while a slot is free", () => {
		assert.deepEqual(decideReadlistPin({ slug: slug("r1"), readlists, pinned: [slug("r2")] }), {
			ok: true,
			slug: "r1",
		});
	});

	it("refuses the built-in readlist, which is always on the rail", () => {
		assert.deepEqual(decideReadlistPin({ slug: DEFAULT_READLIST_SLUG, readlists, pinned: [] }), {
			ok: false,
			reason: "unknown-readlist",
		});
	});

	it("refuses a readlist the reader does not own", () => {
		assert.deepEqual(decideReadlistPin({ slug: slug("gone"), readlists, pinned: [] }), {
			ok: false,
			reason: "unknown-readlist",
		});
	});

	it("refuses a pin once every slot is taken", () => {
		const pinned = [slug("r1"), slug("r2"), slug("r3"), slug("r4")];
		assert.equal(pinned.length, READLIST_PINNED_MAX);
		assert.deepEqual(decideReadlistPin({ slug: slug("r5"), readlists, pinned }), {
			ok: false,
			reason: "limit-reached",
		});
	});

	it("accepts pinning an already pinned readlist when every slot is taken", () => {
		const pinned = [slug("r1"), slug("r2"), slug("r3"), slug("r4")];
		assert.deepEqual(decideReadlistPin({ slug: slug("r3"), readlists, pinned }), { ok: true, slug: "r3" });
	});
});
