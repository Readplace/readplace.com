import assert from "node:assert/strict";
import { toSubstackPostUrl } from "./substack-comment-view";

describe("toSubstackPostUrl", () => {
	it("serves the post a Substack comment button opened, on a custom domain, keeping other params", () => {
		assert.equal(
			toSubstackPostUrl("https://newsletter.example/p/a-post/comments?action=post-comment&comments=true&page=2"),
			"https://newsletter.example/p/a-post?page=2",
		);
	});

	it.each([
		[
			"https://example.substack.com/p/a-post/comments?utm_campaign=email-half-magic-comments&token=dummyToken",
			"https://example.substack.com/p/a-post?token=dummyToken",
		],
		[
			"https://newsletter.example/p/a-post/comments?utm_source=substack&utm_campaign=email-half-magic-comments&token=dummyToken",
			"https://newsletter.example/p/a-post?utm_source=substack&token=dummyToken",
		],
	])("serves the post the comment button of a Substack email opened, from %s", (url, postUrl) => {
		assert.equal(toSubstackPostUrl(url), postUrl);
	});

	it.each([
		"not a url",
		"https://newsletter.example/p/a-post/comments?utm_campaign=email-share&token=dummyToken",
		"https://newsletter.example/p/comments?utm_campaign=email-half-magic-comments",
		"https://newsletter.example/p/a-post/comments",
		"https://newsletter.example/p/a-post/comments?comments=true",
		"https://newsletter.example/p/a-post/comments?action=post-comment",
		"https://newsletter.example/p/comments?action=post-comment&comments=true",
		"https://newsletter.example/news/a-post/comments?action=post-comment&comments=true",
	])("leaves %s as it is", (url) => {
		assert.equal(toSubstackPostUrl(url), url);
	});
});
