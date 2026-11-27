import assert from "node:assert/strict";
import { readlistAfterDelete } from "./readlist-delete";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "./readlist-name.schema";

const slug = (value: string) => ReadlistSlugSchema.parse(value);

describe("readlistAfterDelete", () => {
	it("keeps the reader on the readlist they were viewing when another one goes", () => {
		assert.equal(
			readlistAfterDelete({ viewed: slug("a1b2c3d4"), deleted: slug("e5f6a7b8") }),
			"a1b2c3d4",
		);
	});

	it("sends the reader to the default readlist when the one they were viewing is the one deleted", () => {
		assert.equal(
			readlistAfterDelete({ viewed: slug("a1b2c3d4"), deleted: slug("a1b2c3d4") }),
			DEFAULT_READLIST_SLUG,
		);
	});
});
