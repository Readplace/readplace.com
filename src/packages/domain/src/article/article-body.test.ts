import { UserIdSchema } from "../user/user.schema";
import { storedArticleBody } from "./article-body";
import { ANONYMOUS_VIEWER, viewerFor } from "./private-item-access";

const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const OWNER = UserIdSchema.parse("owner-user");
const OTHER_READER = UserIdSchema.parse("other-reader");

describe("storedArticleBody", () => {
	it("holds the body of an article page", () => {
		expect(storedArticleBody({ url: "https://example.com/post", html: "<p>Body</p>", viewer: ANONYMOUS_VIEWER, ownerUserId: undefined })).toEqual({
			kind: "article",
			body: "<p>Body</p>",
		});
	});

	it("reports an article page without a stored body as missing", () => {
		expect(storedArticleBody({ url: "https://example.com/post", html: undefined, viewer: ANONYMOUS_VIEWER, ownerUserId: undefined })).toEqual({ kind: "missing" });
	});

	it("reports an article page whose stored body is empty as missing", () => {
		expect(storedArticleBody({ url: "https://example.com/post", html: "", viewer: ANONYMOUS_VIEWER, ownerUserId: undefined })).toEqual({ kind: "missing" });
	});

	it("never holds the body of a webmail page, even when one is stored", () => {
		expect(storedArticleBody({ url: "https://mail.google.com/mail/u/2/", html: "<p>Inbox</p>", viewer: ANONYMOUS_VIEWER, ownerUserId: undefined })).toEqual({
			kind: "not-an-article",
		});
	});

	it("reports a webmail page without a stored body as not an article", () => {
		expect(storedArticleBody({ url: "https://mail.google.com/mail/u/2/", html: undefined, viewer: ANONYMOUS_VIEWER, ownerUserId: undefined })).toEqual({
			kind: "not-an-article",
		});
	});

	it("treats a subdomain of a webmail host as not an article", () => {
		expect(storedArticleBody({ url: "https://foo.mail.google.com/x", html: "<p>Inbox</p>", viewer: ANONYMOUS_VIEWER, ownerUserId: undefined })).toEqual({
			kind: "not-an-article",
		});
	});

	it("holds the body of a private upload for its owner", () => {
		expect(
			storedArticleBody({ url: PRIVATE_URL, html: "<p>Chapter</p>", viewer: viewerFor(OWNER), ownerUserId: OWNER }),
		).toEqual({ kind: "article", body: "<p>Chapter</p>" });
	});

	it("never holds the body of a private upload for a signed-out viewer, even when one is stored", () => {
		expect(
			storedArticleBody({ url: PRIVATE_URL, html: "<p>Chapter</p>", viewer: ANONYMOUS_VIEWER, ownerUserId: OWNER }),
		).toEqual({ kind: "not-an-article" });
	});

	it("never holds the body of a private upload for another reader", () => {
		expect(
			storedArticleBody({ url: PRIVATE_URL, html: "<p>Chapter</p>", viewer: viewerFor(OTHER_READER), ownerUserId: OWNER }),
		).toEqual({ kind: "not-an-article" });
	});

	it("never holds the body of a webmail page, even for a reader named as its owner", () => {
		expect(
			storedArticleBody({
				url: "https://mail.google.com/mail/u/2/",
				html: "<p>Inbox</p>",
				viewer: viewerFor(OWNER),
				ownerUserId: OWNER,
			}),
		).toEqual({ kind: "not-an-article" });
	});
});
