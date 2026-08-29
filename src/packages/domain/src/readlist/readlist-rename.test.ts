import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, READLIST_LABEL_MAX_LENGTH, ReadlistSlugSchema } from "./readlist-name.schema";
import { decideReadlistRename } from "./readlist-rename";

const slug = (value: string) => ReadlistSlugSchema.parse(value);
const readlists = [
	{ slug: DEFAULT_READLIST_SLUG, label: "All" },
	{ slug: slug("a1b2c3d4"), label: "Work" },
	{ slug: slug("e5f6a7b8"), label: "Deep Work" },
];

describe("decideReadlistRename", () => {
	it("keeps the readlist's own id and takes the trimmed name", () => {
		assert.deepEqual(
			decideReadlistRename({ slug: slug("a1b2c3d4"), label: "  Weekend Reads  ", readlists }),
			{ ok: true, slug: "a1b2c3d4", label: "Weekend Reads" },
		);
	});

	it("numbers a name another readlist already carries", () => {
		assert.deepEqual(decideReadlistRename({ slug: slug("e5f6a7b8"), label: "Work", readlists }), {
			ok: true,
			slug: "e5f6a7b8",
			label: "Work 2",
		});
	});

	it("lets a readlist keep the name it already carries, rather than numbering it against itself", () => {
		assert.deepEqual(decideReadlistRename({ slug: slug("a1b2c3d4"), label: "Work", readlists }), {
			ok: true,
			slug: "a1b2c3d4",
			label: "Work",
		});
	});

	it("lets a reader recase their own readlist's name", () => {
		assert.deepEqual(decideReadlistRename({ slug: slug("a1b2c3d4"), label: "WORK", readlists }), {
			ok: true,
			slug: "a1b2c3d4",
			label: "WORK",
		});
	});

	it("matches a taken name whatever it was capitalised as, and keeps the casing the reader typed", () => {
		assert.deepEqual(decideReadlistRename({ slug: slug("e5f6a7b8"), label: "work", readlists }), {
			ok: true,
			slug: "e5f6a7b8",
			label: "work 2",
		});
	});

	it("numbers a name the built-in readlist carries", () => {
		assert.deepEqual(decideReadlistRename({ slug: slug("a1b2c3d4"), label: "All", readlists }), {
			ok: true,
			slug: "a1b2c3d4",
			label: "All 2",
		});
	});

	it("refuses a name with no room left for the number that tells it apart", () => {
		const longest = "a".repeat(READLIST_LABEL_MAX_LENGTH);

		assert.deepEqual(
			decideReadlistRename({
				slug: slug("a1b2c3d4"),
				label: longest,
				readlists: [...readlists, { slug: slug("ccccdddd"), label: longest }],
			}),
			{ ok: false, reason: "name-taken" },
		);
	});

	it("refuses a name too long to render in full", () => {
		assert.deepEqual(
			decideReadlistRename({
				slug: slug("a1b2c3d4"),
				label: "a".repeat(READLIST_LABEL_MAX_LENGTH + 1),
				readlists,
			}),
			{ ok: false, reason: "invalid-name" },
		);
	});

	it("refuses a name emptied of everything but spaces", () => {
		assert.deepEqual(decideReadlistRename({ slug: slug("a1b2c3d4"), label: "   ", readlists }), {
			ok: false,
			reason: "invalid-name",
		});
	});

	it("refuses to rename the built-in readlist, which has no stored name to change", () => {
		assert.deepEqual(decideReadlistRename({ slug: slug("default"), label: "Everything", readlists }), {
			ok: false,
			reason: "unknown-readlist",
		});
	});

	it("refuses a readlist the reader does not have", () => {
		assert.deepEqual(decideReadlistRename({ slug: slug("ffffffff"), label: "Mine", readlists }), {
			ok: false,
			reason: "unknown-readlist",
		});
	});
});
