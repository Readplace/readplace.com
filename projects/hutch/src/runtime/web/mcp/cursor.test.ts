import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { decodeReadlistCursor, encodeReadlistCursor } from "./cursor";

describe("readlist cursor codec", () => {
	it("round-trips a full cursor, readlist included", () => {
		const cursor = {
			page: 3,
			pageSize: 10,
			readlist: ReadlistSlugSchema.parse("work"),
			status: "read" as const,
			sort: "readAt" as const,
			order: "asc" as const,
		};
		expect(decodeReadlistCursor(encodeReadlistCursor(cursor))).toEqual(cursor);
	});

	it("decodes a token minted before readlists carried on the cursor", () => {
		const token = Buffer.from(
			JSON.stringify({ page: 2, pageSize: 20, status: "unread" }),
			"utf8",
		).toString("base64url");
		expect(decodeReadlistCursor(token)).toEqual({
			page: 2,
			pageSize: 20,
			status: "unread",
		});
	});

	it("returns null for a token whose readlist id is not a valid slug", () => {
		const token = Buffer.from(
			JSON.stringify({ page: 1, pageSize: 10, readlist: "Not A Slug" }),
			"utf8",
		).toString("base64url");
		expect(decodeReadlistCursor(token)).toBeNull();
	});

	it("round-trips a minimal cursor with no filters", () => {
		const cursor = { page: 2, pageSize: 20 };
		expect(decodeReadlistCursor(encodeReadlistCursor(cursor))).toEqual(cursor);
	});

	it("returns null for a token that is not base64url-encoded JSON", () => {
		expect(decodeReadlistCursor("!!!not base64!!!")).toBeNull();
	});

	it("returns null for valid JSON of the wrong shape", () => {
		const token = Buffer.from(
			JSON.stringify({ page: 0, pageSize: 5 }),
			"utf8",
		).toString("base64url");
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
			JSON.stringify({
				page: 1,
				pageSize: 10,
				status: "unread",
				sort: "readAt",
			}),
			"utf8",
		).toString("base64url");
		expect(decodeReadlistCursor(token)).toBeNull();
	});

	it("round-trips a combined-scope cursor", () => {
		const cursor = { page: 2, pageSize: 20, scope: "combined" as const };
		expect(decodeReadlistCursor(encodeReadlistCursor(cursor))).toEqual(cursor);
	});

	it("returns null for a cursor that is both combined-scope and readlist-scoped", () => {
		const token = Buffer.from(
			JSON.stringify({
				page: 1,
				pageSize: 10,
				scope: "combined",
				readlist: "work",
			}),
			"utf8",
		).toString("base64url");
		expect(decodeReadlistCursor(token)).toBeNull();
	});

	it("returns null for a cursor whose scope is not the combined marker", () => {
		const token = Buffer.from(
			JSON.stringify({ page: 1, pageSize: 10, scope: "all" }),
			"utf8",
		).toString("base64url");
		expect(decodeReadlistCursor(token)).toBeNull();
	});
});
