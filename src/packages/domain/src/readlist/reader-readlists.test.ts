import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "./readlist-name.schema";
import {
	DEFAULT_READLIST,
	type ReadlistRef,
	readerReadlists,
	readlistsHoldingArticle,
} from "./reader-readlists";

const WORK: ReadlistRef = { slug: ReadlistSlugSchema.parse("work"), label: "Work" };
const RUST: ReadlistRef = { slug: ReadlistSlugSchema.parse("rust"), label: "Rust" };

describe("readerReadlists", () => {
	it("puts the built-in readlist first, then the reader's own in the order given", () => {
		assert.deepEqual(readerReadlists([WORK, RUST]), [DEFAULT_READLIST, WORK, RUST]);
	});

	it("is just the built-in readlist when the reader has created none", () => {
		assert.deepEqual(readerReadlists([]), [DEFAULT_READLIST]);
	});

	it("carries only slug and label, dropping any extra fields on the definitions", () => {
		const withExtras = { slug: WORK.slug, label: WORK.label, createdAt: new Date(0) };
		assert.deepEqual(readerReadlists([withExtras]), [DEFAULT_READLIST, WORK]);
	});
});

describe("readlistsHoldingArticle", () => {
	const readlists = readerReadlists([WORK, RUST]);

	it("names every readlist a save sits in, in reader order", () => {
		assert.deepEqual(
			readlistsHoldingArticle({
				saves: [{ readlist: RUST.slug }, { readlist: undefined }, { readlist: WORK.slug }],
				readlists,
			}),
			[DEFAULT_READLIST, WORK, RUST],
		);
	});

	it("maps an undefined save to the built-in readlist", () => {
		assert.deepEqual(
			readlistsHoldingArticle({ saves: [{ readlist: undefined }], readlists }),
			[DEFAULT_READLIST],
		);
	});

	it("omits the built-in readlist when the article was deleted from it", () => {
		assert.deepEqual(
			readlistsHoldingArticle({ saves: [{ readlist: WORK.slug }], readlists }),
			[WORK],
		);
	});

	it("drops a save whose slug has no matching readlist definition", () => {
		assert.deepEqual(
			readlistsHoldingArticle({
				saves: [{ readlist: ReadlistSlugSchema.parse("orphan") }, { readlist: WORK.slug }],
				readlists,
			}),
			[WORK],
		);
	});

	it("returns nothing for an article with no saves", () => {
		assert.deepEqual(readlistsHoldingArticle({ saves: [], readlists }), []);
	});

	it("uses the built-in slug constant for the default mapping", () => {
		assert.equal(DEFAULT_READLIST.slug, DEFAULT_READLIST_SLUG);
	});
});
