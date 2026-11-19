import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryOcrPagesLeft } from "./in-memory-ocr-pages-left";

describe("initInMemoryOcrPagesLeft", () => {
	it("answers the pages left it was built with for any reader", async () => {
		const { readOcrPagesLeft } = initInMemoryOcrPagesLeft({ pagesLeft: 7 });

		assert.equal(await readOcrPagesLeft({ userId: UserIdSchema.parse("reader-1") }), 7);
	});
});
