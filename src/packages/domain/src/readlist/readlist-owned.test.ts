import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "./readlist-name.schema";
import { decideOwnedCustomReadlist } from "./readlist-owned";

const slug = (value: string) => ReadlistSlugSchema.parse(value);
const readlists = [
	{ slug: DEFAULT_READLIST_SLUG },
	{ slug: slug("a1b2c3d4") },
	{ slug: slug("e5f6a7b8") },
];

describe("decideOwnedCustomReadlist", () => {
	it("takes a readlist the reader made", () => {
		assert.deepEqual(decideOwnedCustomReadlist({ slug: slug("e5f6a7b8"), readlists }), {
			ok: true,
			slug: "e5f6a7b8",
		});
	});

	it("refuses the built-in readlist every reader is given", () => {
		assert.deepEqual(decideOwnedCustomReadlist({ slug: DEFAULT_READLIST_SLUG, readlists }), {
			ok: false,
			reason: "unknown-readlist",
		});
	});

	it("refuses a readlist the reader does not have", () => {
		assert.deepEqual(decideOwnedCustomReadlist({ slug: slug("ffffffff"), readlists }), {
			ok: false,
			reason: "unknown-readlist",
		});
	});
});
