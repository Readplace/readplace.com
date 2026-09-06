import assert from "node:assert/strict";
import { decideReadlistDelete, readlistAfterDelete } from "./readlist-delete";
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

describe("readlistAfterDelete", () => {
	it("keeps the reader on the readlist they were viewing when another one goes", () => {
		assert.equal(
			readlistAfterDelete({ viewed: slug("a1b2c3d4"), deleted: slug("e5f6a7b8") }),
			"a1b2c3d4",
		);
	});

	it("sends the reader to the default readlist when the one they were viewing is the one deleted", () => {
		assert.equal(
			readlistAfterDelete({ viewed: slug("a1b2c3d4"), deleted: slug("a1b2c3d4") }),
			DEFAULT_READLIST_SLUG,
		);
	});
});
