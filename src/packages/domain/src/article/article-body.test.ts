import { storedArticleBody } from "./article-body";

describe("storedArticleBody", () => {
	it("holds the body of an article page", () => {
		expect(storedArticleBody({ url: "https://example.com/post", html: "<p>Body</p>" })).toEqual({
			kind: "article",
			body: "<p>Body</p>",
		});
	});

	it("reports an article page without a stored body as missing", () => {
		expect(storedArticleBody({ url: "https://example.com/post", html: undefined })).toEqual({ kind: "missing" });
	});

	it("reports an article page whose stored body is empty as missing", () => {
		expect(storedArticleBody({ url: "https://example.com/post", html: "" })).toEqual({ kind: "missing" });
	});

	it("never holds the body of a webmail page, even when one is stored", () => {
		expect(storedArticleBody({ url: "https://mail.google.com/mail/u/2/", html: "<p>Inbox</p>" })).toEqual({
			kind: "not-an-article",
		});
	});

	it("reports a webmail page without a stored body as not an article", () => {
		expect(storedArticleBody({ url: "https://mail.google.com/mail/u/2/", html: undefined })).toEqual({
			kind: "not-an-article",
		});
	});

	it("treats a subdomain of a webmail host as not an article", () => {
		expect(storedArticleBody({ url: "https://foo.mail.google.com/x", html: "<p>Inbox</p>" })).toEqual({
			kind: "not-an-article",
		});
	});
});
