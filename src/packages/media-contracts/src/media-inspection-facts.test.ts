import assert from "node:assert/strict";
import { MediaInspectionFactsSchema } from "./media-inspection-facts";

const bookFacts = {
	kind: "book",
	title: "The Left Hand of Darkness",
	authors: ["Ursula K. Le Guin"],
	sectionTitles: ["A Parade in Erhenrang", "The Place Inside the Blizzard"],
};

describe("MediaInspectionFactsSchema", () => {
	it("keeps a book's title, authors and section titles", () => {
		assert.deepEqual(MediaInspectionFactsSchema.parse(bookFacts), bookFacts);
	});

	it("refuses a kind it does not name", () => {
		assert.equal(MediaInspectionFactsSchema.safeParse({ ...bookFacts, kind: "audio" }).success, false);
	});

	it("refuses a book with no section titles", () => {
		const { sectionTitles: _removed, ...withoutSectionTitles } = bookFacts;

		assert.equal(MediaInspectionFactsSchema.safeParse(withoutSectionTitles).success, false);
	});
});
