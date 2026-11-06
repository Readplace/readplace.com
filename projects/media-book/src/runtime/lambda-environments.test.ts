import assert from "node:assert/strict";
import { MEDIA_BOOK_FAILURES_DLQ_ENV } from "./media-book-failures-dlq.env";
import { PROCESS_BOOK_ENV } from "./process-book.env";

const tuples = {
	MEDIA_BOOK_FAILURES_DLQ_ENV,
	PROCESS_BOOK_ENV,
};

describe("Lambda environment tuples", () => {
	for (const [name, names] of Object.entries(tuples)) {
		it(`${name} names each variable once`, () => {
			assert.equal(new Set(names).size, names.length);
		});
	}
});
