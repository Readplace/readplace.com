import assert from "node:assert/strict";
import { decideReadlistDelete } from "./readlist-delete";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "./readlist-name.schema";

const slug = (value: string) => ReadlistSlugSchema.parse(value);
const readlists = [
	{ slug: DEFAULT_READLIST_SLUG, label: "All" },
	{ slug: slug("a1b2c3d4"), label: "Work" },
];

describe("decideReadlistDelete", () => {
	it("takes a readlist the reader owns", () => {
		assert.deepEqual(decideReadlistDelete({ slug: slug("a1b2c3d4"), readlists }), {
			ok: true,
			slug: "a1b2c3d4",
		});
	});

	it("refuses the readlist every reader is given, which holds no row to delete", () => {
		assert.deepEqual(decideReadlistDelete({ slug: DEFAULT_READLIST_SLUG, readlists }), {
			ok: false,
			reason: "unknown-readlist",
		});
	});

	it("refuses a readlist the reader does not own", () => {
		assert.deepEqual(decideReadlistDelete({ slug: slug("ffffffff"), readlists }), {
			ok: false,
			reason: "unknown-readlist",
		});
	});
});
