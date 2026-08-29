import assert from "node:assert/strict";
import { generateReadlistSlug } from "./generate-readlist-slug";
import { READLIST_LABEL_MAX_LENGTH, ReadlistSlugSchema } from "./readlist-name.schema";

describe("generateReadlistSlug", () => {
	it("addresses a readlist by an opaque id, never by what it is called", () => {
		const slug = generateReadlistSlug();

		assert.equal(ReadlistSlugSchema.parse(slug), slug);
		assert.ok(slug.length <= READLIST_LABEL_MAX_LENGTH);
	});

	it("gives every readlist its own id, which is how a readlist is addressed", () => {
		const slugs = new Set(Array.from({ length: 50 }, () => generateReadlistSlug()));

		assert.equal(slugs.size, 50);
	});
});
