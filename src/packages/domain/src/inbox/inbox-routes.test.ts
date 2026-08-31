import assert from "node:assert/strict";
import {
	INBOX_ADDRESSES_PATH,
	INBOX_PATH,
	buildInboxHighlightUrl,
	parseInboxHighlight,
} from "./inbox-routes";

describe("inbox routes", () => {
	it("derives the addresses path from the inbox path so one rename moves both", () => {
		assert.equal(INBOX_ADDRESSES_PATH, `${INBOX_PATH}/addresses`);
	});

	it("builds a highlight link that survives an id carrying URL-significant characters", () => {
		const url = buildInboxHighlightUrl({
			receivedAtMessageId: "2026-06-24T09:00:00.000Z#<m@x>",
		});

		assert.equal(
			url,
			`${INBOX_PATH}?highlight=2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E`,
		);
		assert.equal(
			parseInboxHighlight(Object.fromEntries(new URL(url, "https://x.test").searchParams)),
			"2026-06-24T09:00:00.000Z#<m@x>",
		);
	});

	it("falls back to the plain list when no email is named", () => {
		assert.equal(buildInboxHighlightUrl({}), INBOX_PATH);
	});

	it("reads no highlight from a query that omits it or leaves it blank", () => {
		assert.equal(parseInboxHighlight({}), undefined);
		assert.equal(parseInboxHighlight({ highlight: "" }), undefined);
		assert.equal(parseInboxHighlight({ highlight: ["a", "b"] }), undefined);
	});
});
