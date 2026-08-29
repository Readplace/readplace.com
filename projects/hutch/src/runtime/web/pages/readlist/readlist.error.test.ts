import { READLIST_LABEL_MAX_LENGTH, READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import {
	READLIST_RENAME_REJECTIONS,
	collectStatusFlashParams,
	httpErrorMessageMapping,
	readlistErrorFlashMapping,
	statusFlashMapping,
} from "./readlist.error";

describe("readlistErrorFlashMapping", () => {
	it("returns undefined when queue_error is absent", () => {
		expect(readlistErrorFlashMapping({})).toBeUndefined();
	});

	it("returns undefined when queue_error is not a string", () => {
		expect(readlistErrorFlashMapping({ queue_error: 42 })).toBeUndefined();
	});

	it("returns undefined for an unknown readlist error code", () => {
		expect(readlistErrorFlashMapping({ queue_error: "something_else" })).toBeUndefined();
	});

	it("names the cap when the reader has run out of readlists", () => {
		expect(readlistErrorFlashMapping({ queue_error: "limit" })).toBe(
			`You can keep up to ${READLIST_MAX_PER_USER} readlists.`,
		);
	});
});

describe("READLIST_RENAME_REJECTIONS", () => {
	it("answers a missing readlist as not-found and a bad name as unprocessable", () => {
		expect(READLIST_RENAME_REJECTIONS["unknown-readlist"].status).toBe(404);
		expect(READLIST_RENAME_REJECTIONS["invalid-name"].status).toBe(422);
	});

	it("carries copy the client can show the reader verbatim", () => {
		expect(READLIST_RENAME_REJECTIONS["invalid-name"].message).toBe(
			`Give the readlist a name of ${READLIST_LABEL_MAX_LENGTH} characters or fewer.`,
		);
	});

	it("tells a reader whose name is taken why the number would not fit", () => {
		expect(READLIST_RENAME_REJECTIONS["name-taken"].status).toBe(422);
		expect(READLIST_RENAME_REJECTIONS["name-taken"].message).toBe(
			"You already have a readlist with that name, and it's too long to number. Try a shorter one.",
		);
	});
});

describe("httpErrorMessageMapping", () => {
	it("returns undefined when error_code is absent", () => {
		expect(httpErrorMessageMapping({})).toBeUndefined();
	});

	it("returns undefined when error_code is not a string", () => {
		expect(httpErrorMessageMapping({ error_code: 42 })).toBeUndefined();
	});

	it("returns undefined for an unknown error code", () => {
		expect(httpErrorMessageMapping({ error_code: "something_else" })).toBeUndefined();
	});

	it("returns the mapped message for save_failed", () => {
		expect(httpErrorMessageMapping({ error_code: "save_failed" })).toBe("Could not save article. Please try again.");
	});
});

describe("statusFlashMapping", () => {
	it("returns undefined when status_changed is absent", () => {
		expect(statusFlashMapping({ status_article: "abc" })).toBeUndefined();
	});

	it("returns undefined when status_changed is not read or unread", () => {
		expect(statusFlashMapping({ status_changed: "deleted", status_article: "abc" })).toBeUndefined();
	});

	it("returns undefined when status_article is missing", () => {
		expect(statusFlashMapping({ status_changed: "read" })).toBeUndefined();
	});

	it("returns undefined when status_article is empty", () => {
		expect(statusFlashMapping({ status_changed: "read", status_article: "" })).toBeUndefined();
	});

	it("maps a read change to a 'Marked as read' flash that undoes to unread", () => {
		expect(statusFlashMapping({ status_changed: "read", status_article: "abc" })).toEqual({
			message: "Marked as read",
			undoArticleId: "abc",
			undoStatus: "unread",
		});
	});

	it("maps an unread change to a 'Marked as unread' flash that undoes to read", () => {
		expect(statusFlashMapping({ status_changed: "unread", status_article: "abc" })).toEqual({
			message: "Marked as unread",
			undoArticleId: "abc",
			undoStatus: "read",
		});
	});
});

describe("collectStatusFlashParams", () => {
	it("returns both status flash pairs when present", () => {
		expect(collectStatusFlashParams({ status_changed: "read", status_article: "abc" })).toEqual([
			["status_changed", "read"],
			["status_article", "abc"],
		]);
	});

	it("returns an empty list when the status flash params are absent", () => {
		expect(collectStatusFlashParams({})).toEqual([]);
	});
});
