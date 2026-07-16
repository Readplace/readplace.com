import { classifyEmailLink } from "./classify-email-link";

describe("classifyEmailLink", () => {
	const listUnsubscribeUrls = ["https://news.example.com/unsub"];

	it("classifies an article link as crawlable", () => {
		expect(
			classifyEmailLink({ url: "https://blog.example.com/post", listUnsubscribeUrls }),
		).toEqual({ action: "crawl" });
	});

	it("skips a link matching the List-Unsubscribe endpoint", () => {
		expect(
			classifyEmailLink({
				url: "https://news.example.com/unsub?token=send-2",
				listUnsubscribeUrls,
			}),
		).toEqual({ action: "skip", reason: "list-unsubscribe" });
	});

	it("skips a known action-link shape even without a List-Unsubscribe header", () => {
		expect(
			classifyEmailLink({
				url: "https://pub.example.com/action/disable_email/disable?token=jwt",
				listUnsubscribeUrls: [],
			}),
		).toEqual({ action: "skip", reason: "action-link-pattern" });
	});

	it("attributes a link matching both rules to the List-Unsubscribe match", () => {
		expect(
			classifyEmailLink({
				url: "https://news.example.com/unsub",
				listUnsubscribeUrls: ["https://news.example.com/unsub"],
			}),
		).toEqual({ action: "skip", reason: "list-unsubscribe" });
	});
});
