import { httpErrorMessageMapping, statusFlashMapping } from "./queue.error";

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
