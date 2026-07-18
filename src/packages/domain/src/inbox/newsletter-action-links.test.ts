import { isKnownNewsletterActionLink } from "./newsletter-action-links";

function matches(url: string): boolean {
	return isKnownNewsletterActionLink({ url });
}

describe("isKnownNewsletterActionLink", () => {
	it("matches an action word appearing as a whole path segment", () => {
		expect(matches("https://news.example.com/email/unsubscribe/token-1")).toBe(true);
		expect(matches("https://news.example.com/unsub/abc")).toBe(true);
		expect(matches("https://news.example.com/opt-out?u=1")).toBe(true);
	});

	it("matches the AWS SNS unsubscribe page", () => {
		expect(
			matches("https://sns.us-east-1.amazonaws.com/unsubscribe.html?SubscriptionArn=arn:x"),
		).toBe(true);
	});

	it("matches action segments case-insensitively", () => {
		expect(matches("https://news.example.com/UnSubscribe")).toBe(true);
	});

	it("matches custom-domain action paths by prefix, exactly or at a segment boundary", () => {
		expect(matches("https://pub.example.com/action/disable_email/disable?token=jwt")).toBe(true);
		expect(matches("https://research.example.com/hs/manage-preferences/edit?lang=en")).toBe(true);
		expect(matches("https://research.example.com/hs/preferences-center/en/page")).toBe(true);
		expect(matches("https://news.example.com/subscribe/confirm?u=1&id=2")).toBe(true);
	});

	it("does not match a longer path that merely shares a prefix's text", () => {
		expect(matches("https://shop.example.com/subscribe/confirmation-of-order")).toBe(false);
		expect(matches("https://x.example.com/hs/preferences-centering-tips")).toBe(false);
	});

	it("matches every path on a dedicated preference-manager host", () => {
		expect(matches("https://manage.kmail-lists.com/subscriptions/anything?a=1")).toBe(true);
	});

	it("matches ESP action hosts on their action paths", () => {
		expect(matches("https://example.us1.list-manage.com/profile?u=1&id=2&e=3")).toBe(true);
		expect(matches("https://list-manage.com/profile?u=1")).toBe(true);
	});

	it("matches an action host written as a fully-qualified hostname with a trailing dot", () => {
		expect(matches("https://example.us1.list-manage.com./profile?u=1")).toBe(true);
	});

	it("does not match click-tracking wrappers that carry article links", () => {
		expect(matches("https://example.us1.list-manage.com/track/click?u=1&id=2&e=3")).toBe(false);
		expect(matches("https://u123.ct.sendgrid.net/ls/click?upn=article-token")).toBe(false);
		expect(matches("https://cmail19.com/t/d-l-abc123")).toBe(false);
	});

	it("does not match a lookalike host outside the ESP domain", () => {
		expect(matches("https://evil-list-manage.com/profile?u=1")).toBe(false);
		expect(matches("https://list-manage.com.evil.example/profile?u=1")).toBe(false);
	});

	it("does not match articles whose slug merely contains an action word", () => {
		expect(matches("https://blog.example.com/why-i-unsubscribe")).toBe(false);
		expect(matches("https://blog.example.com/blog/unsubscribe-guide")).toBe(false);
	});

	it("does not match an action word appearing only in the query", () => {
		expect(matches("https://blog.example.com/article?ref=unsubscribe")).toBe(false);
	});

	it("does not match a candidate that is not a URL", () => {
		expect(matches("not a url")).toBe(false);
	});
});
