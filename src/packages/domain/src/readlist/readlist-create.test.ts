import assert from "node:assert/strict";
import { decideReadlistCreate } from "./readlist-create";
import { DEFAULT_READLIST_SLUG, READLIST_LABEL_MAX_LENGTH, ReadlistSlugSchema } from "./readlist-name.schema";

const slug = (value: string) => ReadlistSlugSchema.parse(value);
const readlists = [
	{ slug: DEFAULT_READLIST_SLUG, label: "All" },
	{ slug: slug("a1b2c3d4"), label: "Work" },
	{ slug: slug("e5f6a7b8"), label: "Deep Work" },
];
const NEW_SLUG = slug("11112222");

describe("decideReadlistCreate", () => {
	it("mints a readlist on the pre-minted id, keeping the trimmed name the reader typed", () => {
		assert.deepEqual(decideReadlistCreate({ label: "  Weekend Reads  ", slug: NEW_SLUG, readlists }), {
			ok: true,
			slug: NEW_SLUG,
			create: { label: "Weekend Reads" },
		});
	});

	it("files into the readlist that already carries the name, whatever its casing, rather than duplicating it", () => {
		assert.deepEqual(decideReadlistCreate({ label: "work", slug: NEW_SLUG, readlists }), {
			ok: true,
			slug: slug("a1b2c3d4"),
			create: undefined,
		});
	});

	it("refuses the built-in readlist's name, which is not a legal filing target", () => {
		assert.deepEqual(decideReadlistCreate({ label: "all", slug: NEW_SLUG, readlists }), {
			ok: false,
			reason: "reserved-name",
		});
	});

	it("refuses a name emptied of everything but spaces", () => {
		assert.deepEqual(decideReadlistCreate({ label: "   ", slug: NEW_SLUG, readlists }), {
			ok: false,
			reason: "invalid-name",
		});
	});

	it("refuses a name too long to render in full", () => {
		assert.deepEqual(
			decideReadlistCreate({
				label: "a".repeat(READLIST_LABEL_MAX_LENGTH + 1),
				slug: NEW_SLUG,
				readlists,
			}),
			{ ok: false, reason: "invalid-name" },
		);
	});
});
