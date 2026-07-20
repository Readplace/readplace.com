import { buildInboxEmailsUrl, parseInboxEmailsUrl } from "./inbox-emails.url";

const BOUNDARY = "2026-06-24T00:01:00.000Z#<m-1@x>";
const ENCODED_BOUNDARY = "2026-06-24T00%3A01%3A00.000Z%23%3Cm-1%40x%3E";

describe("parseInboxEmailsUrl", () => {
	it("yields no cursor for an empty query", () => {
		expect(parseInboxEmailsUrl({})).toEqual({ cursor: undefined });
	});

	it("parses an older cursor", () => {
		expect(parseInboxEmailsUrl({ older: BOUNDARY })).toEqual({
			cursor: { direction: "older", receivedAtMessageId: BOUNDARY },
		});
	});

	it("parses a newer cursor", () => {
		expect(parseInboxEmailsUrl({ newer: BOUNDARY })).toEqual({
			cursor: { direction: "newer", receivedAtMessageId: BOUNDARY },
		});
	});

	it("prefers older when both directions are present", () => {
		expect(parseInboxEmailsUrl({ older: BOUNDARY, newer: "other" })).toEqual({
			cursor: { direction: "older", receivedAtMessageId: BOUNDARY },
		});
	});

	it("treats junk cursors as absent", () => {
		expect(parseInboxEmailsUrl({ older: "" })).toEqual({ cursor: undefined });
		expect(parseInboxEmailsUrl({ older: ["a", "b"] })).toEqual({ cursor: undefined });
	});

	it("bounds the cursor by UTF-8 bytes, not characters", () => {
		expect(parseInboxEmailsUrl({ older: "x".repeat(1025) })).toEqual({ cursor: undefined });
		expect(parseInboxEmailsUrl({ newer: "é".repeat(600) })).toEqual({ cursor: undefined });
		expect(parseInboxEmailsUrl({ older: "é".repeat(512) })).toEqual({
			cursor: { direction: "older", receivedAtMessageId: "é".repeat(512) },
		});
	});
});

describe("buildInboxEmailsUrl", () => {
	it("returns the bare inbox path when there is no cursor", () => {
		expect(buildInboxEmailsUrl({})).toBe("/inbox");
	});

	it("URL-encodes an older cursor", () => {
		expect(
			buildInboxEmailsUrl({
				cursor: { direction: "older", receivedAtMessageId: BOUNDARY },
			}),
		).toBe(`/inbox?older=${ENCODED_BOUNDARY}`);
	});

	it("URL-encodes a newer cursor", () => {
		expect(
			buildInboxEmailsUrl({
				cursor: { direction: "newer", receivedAtMessageId: BOUNDARY },
			}),
		).toBe(`/inbox?newer=${ENCODED_BOUNDARY}`);
	});
});
