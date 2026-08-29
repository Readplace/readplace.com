import assert from "node:assert/strict";
import { decideReadlistMigration } from "./readlist-migration";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "./readlist-name.schema";

const slug = (value: string) => ReadlistSlugSchema.parse(value);
const readlists = [
	{ slug: DEFAULT_READLIST_SLUG, label: "All" },
	{ slug: slug("a1b2c3d4"), label: "Work" },
	{ slug: slug("e5f6a7b8"), label: "Personal" },
];

describe("decideReadlistMigration", () => {
	it("hands one readlist's articles to another the reader owns", () => {
		assert.deepEqual(
			decideReadlistMigration({ from: slug("a1b2c3d4"), to: slug("e5f6a7b8"), readlists }),
			{ ok: true, from: "a1b2c3d4", to: "e5f6a7b8" },
		);
	});

	it("refuses the readlist every reader is given as a destination, which already holds every article", () => {
		assert.deepEqual(
			decideReadlistMigration({ from: slug("a1b2c3d4"), to: DEFAULT_READLIST_SLUG, readlists }),
			{ ok: false, reason: "unknown-readlist" },
		);
	});

	it("refuses to empty the readlist every reader is given", () => {
		assert.deepEqual(
			decideReadlistMigration({ from: DEFAULT_READLIST_SLUG, to: slug("a1b2c3d4"), readlists }),
			{ ok: false, reason: "unknown-readlist" },
		);
	});

	it("refuses a readlist handing its articles to itself", () => {
		assert.deepEqual(
			decideReadlistMigration({ from: slug("a1b2c3d4"), to: slug("a1b2c3d4"), readlists }),
			{ ok: false, reason: "same-readlist" },
		);
	});

	it("refuses a source the reader does not own", () => {
		assert.deepEqual(
			decideReadlistMigration({ from: slug("ffffffff"), to: slug("a1b2c3d4"), readlists }),
			{ ok: false, reason: "unknown-readlist" },
		);
	});

	it("refuses a destination the reader does not own", () => {
		assert.deepEqual(
			decideReadlistMigration({ from: slug("a1b2c3d4"), to: slug("ffffffff"), readlists }),
			{ ok: false, reason: "unknown-readlist" },
		);
	});
});
