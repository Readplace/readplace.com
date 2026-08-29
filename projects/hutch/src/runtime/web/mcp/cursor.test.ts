import { decodeReadlistCursor, encodeReadlistCursor } from "./cursor";

describe("readlist cursor codec", () => {
	it("round-trips a full cursor", () => {
		const cursor = {
			page: 3,
			pageSize: 10,
			status: "read" as const,
			sort: "readAt" as const,
			order: "asc" as const,
		};
		expect(decodeReadlistCursor(encodeReadlistCursor(cursor))).toEqual(cursor);
	});

	it("round-trips a minimal cursor with no filters", () => {
		const cursor = { page: 2, pageSize: 20 };
		expect(decodeReadlistCursor(encodeReadlistCursor(cursor))).toEqual(cursor);
	});

	it("returns null for a token that is not base64url-encoded JSON", () => {
		expect(decodeReadlistCursor("!!!not base64!!!")).toBeNull();
	});

	it("returns null for valid JSON of the wrong shape", () => {
		const token = Buffer.from(JSON.stringify({ page: 0, pageSize: 5 }), "utf8").toString(
			"base64url",
		);
		expect(decodeReadlistCursor(token)).toBeNull();
	});

	it("returns null for a pageSize beyond the allowed maximum", () => {
		const token = Buffer.from(
			JSON.stringify({ page: 1, pageSize: 9999 }),
			"utf8",
		).toString("base64url");
		expect(decodeReadlistCursor(token)).toBeNull();
	});

	it("returns null for a cursor that sorts by read date without a read status", () => {
		const token = Buffer.from(
			JSON.stringify({ page: 1, pageSize: 10, status: "unread", sort: "readAt" }),
			"utf8",
		).toString("base64url");
		expect(decodeReadlistCursor(token)).toBeNull();
	});
});
