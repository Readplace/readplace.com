import assert from "node:assert/strict";
import {
	defaultReadlistDisplayName,
	presentReaderReadlistLabels,
	presentReadlists,
	readlistLabelDisplayKey,
} from "./default-readlist-display-name";
import { DEFAULT_READLIST, readerReadlists } from "./reader-readlists";
import { ReadlistSlugSchema } from "./readlist-name.schema";

const names = { name: "Main saves", qualifiedName: "Built-in main saves" };

describe("readlistLabelDisplayKey", () => {
	it("folds case, collapses interior whitespace and trims", () => {
		assert.equal(readlistLabelDisplayKey("  Main  \t saves "), "main saves");
	});

	it("strips a soft hyphen and a zero-width space that render invisibly", () => {
		assert.equal(readlistLabelDisplayKey("Main sa­ves"), "main saves");
		assert.equal(readlistLabelDisplayKey("Main​ saves"), "main saves");
	});

	it("applies compatibility normalisation to full-width letters", () => {
		assert.equal(readlistLabelDisplayKey("Ｍain saves"), "main saves");
	});
});

describe("defaultReadlistDisplayName", () => {
	it("names the built-in Main saves when no named readlist collides", () => {
		assert.equal(defaultReadlistDisplayName({ names, namedLabels: ["Research"] }), "Main saves");
	});

	it.each([["Main saves"], ["MAIN SAVES"], ["Main  saves"], ["Main sa­ves"]])(
		"qualifies the built-in when a named readlist reads as %j",
		(label) => {
			assert.equal(defaultReadlistDisplayName({ names, namedLabels: [label] }), "Built-in main saves");
		},
	);

	it("numbers the qualified name when the qualified form is also taken", () => {
		assert.equal(
			defaultReadlistDisplayName({ names, namedLabels: ["Main saves", "Built-in  main saves"] }),
			"Built-in main saves 2",
		);
	});

	it("takes the first free number after the qualified and first numbered forms", () => {
		assert.equal(
			defaultReadlistDisplayName({
				names,
				namedLabels: ["Main saves", "Built-in main saves", "built-in main  saves 2"],
			}),
			"Built-in main saves 3",
		);
	});

	it("keeps the qualified fallback within the readlist name limit", () => {
		const taken = ["Main saves", "Built-in main saves", ...Array.from({ length: 13 }, (_, i) => `Built-in main saves ${i + 2}`)];
		const name = defaultReadlistDisplayName({ names, namedLabels: taken });
		assert.equal(name, "Built-in main saves 15");
		assert.ok(name.length <= 24);
	});

	it("returns to Main saves once the colliding readlist is renamed away", () => {
		assert.equal(defaultReadlistDisplayName({ names, namedLabels: ["Main saves (old)"] }), "Main saves");
	});
});

describe("presentReadlists", () => {
	it("relabels only the built-in and keeps every slug and named label", () => {
		const research = { slug: ReadlistSlugSchema.parse("research"), label: "Research" };
		assert.deepEqual(presentReadlists({ readlists: [DEFAULT_READLIST, research], defaultName: "Main saves" }), [
			{ slug: DEFAULT_READLIST.slug, label: "Main saves" },
			research,
		]);
	});
});

describe("presentReaderReadlistLabels", () => {
	it("keeps a colliding custom readlist's own spelling and slug beside the qualified built-in", () => {
		const custom = { slug: ReadlistSlugSchema.parse("main-saves"), label: "Main  saves" };
		assert.deepEqual(presentReaderReadlistLabels({ readlists: readerReadlists([custom]), names }), [
			{ slug: DEFAULT_READLIST.slug, label: "Built-in main saves" },
			custom,
		]);
	});
});
