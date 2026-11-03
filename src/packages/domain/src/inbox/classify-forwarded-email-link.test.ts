import { classifyForwardedEmailLink } from "./classify-forwarded-email-link";

const SOCIAL_SKIP = { action: "skip", reason: "social-host" };
const CRAWL = { action: "crawl" };

function classify(url: string, listUnsubscribeUrls: string[] = []) {
	return classifyForwardedEmailLink({ url, listUnsubscribeUrls });
}

describe("classifyForwardedEmailLink", () => {
	it.each([
		"https://x.com/someone/status/1",
		"https://www.x.com/someone/status/1",
		"https://linkedin.com/feed/",
		"https://www.linkedin.com/comm/jobs/view/1",
		"http://www.linkedin.com/posts/someone",
		"https://WWW.LinkedIn.COM/feed/",
		"https://X.COM/someone/status/1",
		"https://www.linkedin.com./feed/",
		"https://x.com./someone/status/1",
	])("skips the direct social link %s", (url) => {
		expect(classify(url)).toEqual(SOCIAL_SKIP);
	});

	it.each([
		"https://notx.com/post",
		"https://x.com.example.org/post",
		"https://linkedin.com.example.org/post",
		"https://mylinkedin.com/post",
		"https://news.linkedin.com/story",
		"https://business.x.com/post",
		"https://twitter.com/someone/status/1",
		"https://www.facebook.com/brand",
	])("leaves a host outside the measured rule eligible: %s", (url) => {
		expect(classify(url)).toEqual(CRAWL);
	});

	it("leaves an editorial link that only mentions LinkedIn in its path eligible", () => {
		expect(classify("https://blog.example.com/linkedin.com/why-feeds-fail")).toEqual(CRAWL);
	});

	it("leaves an opaque tracker carrying a social destination in its query eligible", () => {
		expect(
			classify("https://link.mail.example.com/c/token?u=https%3A%2F%2Fwww.linkedin.com%2Ffeed"),
		).toEqual(CRAWL);
	});

	it("leaves a value that is not an http URL for the rest of the pipeline", () => {
		expect(classify("x.com/someone")).toEqual(CRAWL);
	});

	it("attributes a social unsubscribe endpoint to the List-Unsubscribe match", () => {
		const url = "https://www.linkedin.com/comm/psettings/unsubscribe";

		expect(classify(url, [url])).toEqual({ action: "skip", reason: "list-unsubscribe" });
	});

	it("attributes a social link matching an action-link shape to that shape", () => {
		expect(classify("https://x.com/action/disable_email/disable?token=jwt")).toEqual({
			action: "skip",
			reason: "action-link-pattern",
		});
	});
});
