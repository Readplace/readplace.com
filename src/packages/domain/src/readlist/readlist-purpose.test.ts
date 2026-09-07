import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "./readlist-name.schema";
import { decideReadlistPurpose } from "./readlist-purpose";
import { READLIST_PURPOSE_MAX_LENGTH } from "./readlist-purpose.schema";

const slug = (value: string) => ReadlistSlugSchema.parse(value);
const readlists = [
	{ slug: DEFAULT_READLIST_SLUG },
	{ slug: slug("a1b2c3d4") },
	{ slug: slug("e5f6a7b8") },
];

describe("decideReadlistPurpose", () => {
	it("keeps the readlist's own id and takes the trimmed purpose", () => {
		assert.deepEqual(
			decideReadlistPurpose({
				slug: slug("a1b2c3d4"),
				purpose: "  Long-form essays I want to reread.  ",
				readlists,
			}),
			{ ok: true, slug: "a1b2c3d4", purpose: "Long-form essays I want to reread." },
		);
	});

	it("takes a purpose that fills the whole allowance", () => {
		const longest = "a".repeat(READLIST_PURPOSE_MAX_LENGTH);

		assert.deepEqual(
			decideReadlistPurpose({ slug: slug("e5f6a7b8"), purpose: longest, readlists }),
			{ ok: true, slug: "e5f6a7b8", purpose: longest },
		);
	});

	it("refuses a purpose too long to store", () => {
		assert.deepEqual(
			decideReadlistPurpose({
				slug: slug("a1b2c3d4"),
				purpose: "a".repeat(READLIST_PURPOSE_MAX_LENGTH + 1),
				readlists,
			}),
			{ ok: false, reason: "invalid-purpose" },
		);
	});

	it("refuses a purpose emptied of everything but spaces", () => {
		assert.deepEqual(
			decideReadlistPurpose({ slug: slug("a1b2c3d4"), purpose: "   ", readlists }),
			{ ok: false, reason: "invalid-purpose" },
		);
	});

	it("refuses to describe the built-in readlist, which has no row to describe", () => {
		assert.deepEqual(
			decideReadlistPurpose({ slug: DEFAULT_READLIST_SLUG, purpose: "Everything", readlists }),
			{ ok: false, reason: "unknown-readlist" },
		);
	});

	it("refuses a readlist the reader does not have", () => {
		assert.deepEqual(
			decideReadlistPurpose({ slug: slug("ffffffff"), purpose: "Mine", readlists }),
			{ ok: false, reason: "unknown-readlist" },
		);
	});
});
