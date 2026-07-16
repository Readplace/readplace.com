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

});
