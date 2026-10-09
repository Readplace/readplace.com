import assert from "node:assert/strict";
import { decideReadlistArticleMove } from "./readlist-article-move";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "./readlist-name.schema";

const slug = (value: string) => ReadlistSlugSchema.parse(value);
const work = slug("a1b2c3d4");
const personal = slug("e5f6a7b8");
const readlists = [
	{ slug: DEFAULT_READLIST_SLUG, label: "All" },
	{ slug: work, label: "Work" },
	{ slug: personal, label: "Personal" },
];

describe("decideReadlistArticleMove", () => {
	it("copies an article into another custom readlist and takes it out of the one it was in", () => {
		assert.deepEqual(
			decideReadlistArticleMove({
				from: work,
				to: personal,
				readlists,
				saves: [{}, { readlist: work }],
			}),
			{ ok: true, from: work, to: personal, copyInto: personal, removeFrom: work },
		);
	});

	it("adds an article from All without taking it out of All", () => {
		assert.deepEqual(
			decideReadlistArticleMove({ from: DEFAULT_READLIST_SLUG, to: work, readlists, saves: [{}] }),
			{ ok: true, from: DEFAULT_READLIST_SLUG, to: work, copyInto: work },
		);
	});

	it("only takes an article out of a custom readlist when moving it back to All, which still holds it", () => {
		assert.deepEqual(
			decideReadlistArticleMove({
				from: work,
				to: DEFAULT_READLIST_SLUG,
				readlists,
				saves: [{}, { readlist: work }],
			}),
			{ ok: true, from: work, to: DEFAULT_READLIST_SLUG, removeFrom: work },
		);
	});

	it("copies an article back into All before taking it out of a custom readlist when its All copy is gone", () => {
		assert.deepEqual(
			decideReadlistArticleMove({
				from: work,
				to: DEFAULT_READLIST_SLUG,
				readlists,
				saves: [{ readlist: work }],
			}),
			{
				ok: true,
				from: work,
				to: DEFAULT_READLIST_SLUG,
				copyInto: DEFAULT_READLIST_SLUG,
				removeFrom: work,
			},
		);
	});

	it("refuses to move an article into the readlist it is moving from", () => {
		assert.deepEqual(
			decideReadlistArticleMove({ from: work, to: work, readlists, saves: [{ readlist: work }] }),
			{ ok: false, reason: "same-readlist" },
		);
	});

	it("answers same-readlist for All to All", () => {
		assert.deepEqual(
			decideReadlistArticleMove({
				from: DEFAULT_READLIST_SLUG,
				to: DEFAULT_READLIST_SLUG,
				readlists,
				saves: [{}],
			}),
			{ ok: false, reason: "same-readlist" },
		);
	});

	it("refuses a source the reader does not own", () => {
		assert.deepEqual(
			decideReadlistArticleMove({
				from: slug("ffffffff"),
				to: work,
				readlists,
				saves: [{ readlist: slug("ffffffff") }],
			}),
			{ ok: false, reason: "unknown-readlist" },
		);
	});

	it("refuses a destination the reader does not own", () => {
		assert.deepEqual(
			decideReadlistArticleMove({ from: work, to: slug("ffffffff"), readlists, saves: [{ readlist: work }] }),
			{ ok: false, reason: "unknown-readlist" },
		);
	});

	it("refuses a source that no longer holds the article", () => {
		assert.deepEqual(
			decideReadlistArticleMove({ from: work, to: personal, readlists, saves: [{}] }),
			{ ok: false, reason: "not-in-source" },
		);
	});

	it("refuses a destination that already holds the article", () => {
		assert.deepEqual(
			decideReadlistArticleMove({
				from: DEFAULT_READLIST_SLUG,
				to: work,
				readlists,
				saves: [{}, { readlist: work }],
			}),
			{ ok: false, reason: "already-in-destination" },
		);
	});
});
