import { inboxSavedLinkKey } from "./inbox-saved-link.types";

describe("inboxSavedLinkKey", () => {
	it("collapses tracking params so a save and a lookup of the same link agree", () => {
		expect(inboxSavedLinkKey("https://example.com/post?utm_source=news&utm_medium=email")).toBe(
			inboxSavedLinkKey("https://example.com/post"),
		);
	});

	it("ignores the scheme, so an http and an https save are one link", () => {
		expect(inboxSavedLinkKey("http://example.com/post")).toBe(
			inboxSavedLinkKey("https://example.com/post"),
		);
	});

	it("keeps a meaningful query param that identifies the article", () => {
		expect(inboxSavedLinkKey("https://example.com/read?id=42")).not.toBe(
			inboxSavedLinkKey("https://example.com/read?id=43"),
		);
	});

	it("keeps distinct paths on one host apart", () => {
		expect(inboxSavedLinkKey("https://example.com/one")).not.toBe(
			inboxSavedLinkKey("https://example.com/two"),
		);
	});

	it("throws on a value that is not a url", () => {
		expect(() => inboxSavedLinkKey("not a url")).toThrow();
	});
});
