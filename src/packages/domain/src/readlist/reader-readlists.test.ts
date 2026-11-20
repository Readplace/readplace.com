import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "./readlist-name.schema";
import {
	DEFAULT_READLIST,
	ownSavesFiling,
	ownSavesReadlist,
	type ReadlistRef,
	readerReadlists,
	readlistsHoldingArticle,
	routableReadlists,
	withOwnSaves,
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
	it("preserves a starter readlist's campaign through the reader rail", () => {
		assert.deepEqual(readerReadlists([{ ...WORK, starterCampaignId: "hn-starter-v1" }]), [
			DEFAULT_READLIST,
			{ ...WORK, starterCampaignId: "hn-starter-v1" },
		]);
	});

	it("carries only slug and label, dropping any extra fields on the definitions", () => {
		const withExtras = { slug: WORK.slug, label: WORK.label, createdAt: new Date(0) };
		assert.deepEqual(readerReadlists([withExtras]), [DEFAULT_READLIST, WORK]);
	});

	it("keeps the mark of the readlist that holds the reader's own saves", () => {
		const ownSavesSince = new Date("2026-11-20T00:00:00.000Z");
		assert.deepEqual(readerReadlists([{ ...WORK, ownSavesSince }]), [DEFAULT_READLIST, { ...WORK, ownSavesSince }]);
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

describe("routableReadlists", () => {
	const ownSaves = { ...RUST, ownSavesSince: new Date("2026-11-20T00:00:00.000Z") };

	it("leaves out the readlist that holds the reader's own saves", () => {
		assert.deepEqual(routableReadlists([WORK, ownSaves]), [WORK]);
	});

	it("is every readlist when none holds the reader's own saves", () => {
		assert.deepEqual(routableReadlists([WORK, RUST]), [WORK, RUST]);
	});
});

describe("ownSavesReadlist", () => {
	it("names the readlist that holds the reader's own saves", () => {
		const ownSaves = { ...RUST, ownSavesSince: new Date("2026-11-20T00:00:00.000Z") };
		assert.deepEqual(ownSavesReadlist([WORK, ownSaves]), ownSaves);
	});

	it("is undefined when no readlist holds the reader's own saves", () => {
		assert.equal(ownSavesReadlist([WORK, RUST]), undefined);
	});
});

describe("ownSavesFiling", () => {
	const ownSaves = { ...RUST, ownSavesSince: new Date("2026-11-20T00:00:00.000Z") };

	it("files a chosen web save into the readlist that holds the reader's own saves", () => {
		assert.deepEqual(ownSavesFiling({ readlists: [WORK, ownSaves], provenance: { kind: "web" }, trigger: "manual" }), ownSaves);
	});

	it("files a chosen save from the browser extension, an assistant or an email page", () => {
		for (const provenance of [
			{ kind: "client", clientName: "chrome" },
			{ kind: "mcp", registeredName: "Claude" },
			{ kind: "email", senderEmail: "news@example.com" },
			{ kind: "upload" },
		] as const) {
			assert.deepEqual(ownSavesFiling({ readlists: [ownSaves], provenance, trigger: "manual" }), ownSaves);
		}
	});

	it("leaves an iPhone or Android share where the device's ticks put it", () => {
		for (const clientName of ["iphone", "android"]) {
			assert.equal(ownSavesFiling({ readlists: [ownSaves], provenance: { kind: "client", clientName }, trigger: "manual" }), undefined);
		}
	});

	it("files nothing for an automatic save", () => {
		assert.equal(ownSavesFiling({ readlists: [ownSaves], provenance: { kind: "web" }, trigger: "automatic" }), undefined);
	});

	it("files nothing when no readlist holds the reader's own saves", () => {
		assert.equal(ownSavesFiling({ readlists: [WORK, RUST], provenance: { kind: "web" }, trigger: "manual" }), undefined);
	});
});

describe("withOwnSaves", () => {
	it("adds the own-saves readlist after the save's destinations", () => {
		assert.deepEqual(withOwnSaves({ destinations: [DEFAULT_READLIST, WORK], ownSaves: RUST }), [DEFAULT_READLIST, WORK, RUST]);
	});

	it("names the own-saves readlist once when the save already went there", () => {
		assert.deepEqual(withOwnSaves({ destinations: [RUST], ownSaves: RUST }), [RUST]);
	});

	it("is the save's destinations when nothing holds the reader's own saves", () => {
		assert.deepEqual(withOwnSaves({ destinations: [WORK], ownSaves: undefined }), [WORK]);
	});
});
