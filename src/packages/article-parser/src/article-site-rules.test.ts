import { matchingSiteRuleUrl } from "@packages/site-rules";
import type { CrawlFetch } from "@packages/crawl-article";
import { initArticleSiteRules } from "./article-site-rules";
import { linkedinSiteRules } from "./linkedin-site-rules";
import { mediaWikiSiteRules } from "./mediawiki-site-rules";
import { mediumSiteRules } from "./medium-site-rules";
import { theInformationSiteRules } from "./the-information-site-rules";

function recordingCrawlFetch(requested: string[]): CrawlFetch {
	return async (url) => {
		requested.push(url);
		return new Response(JSON.stringify({ author_name: "Jack", html: "<blockquote>just setting up</blockquote>" }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};
}

describe("initArticleSiteRules", () => {
	it("registers the parse-time rules ahead of the crawl-claiming ones, in a fixed order", () => {
		const { siteRules, crawlClaimingSiteRules } = initArticleSiteRules({
			crawlFetch: recordingCrawlFetch([]),
			logError: () => {},
		});

		expect(siteRules).toEqual([
			theInformationSiteRules,
			mediumSiteRules,
			linkedinSiteRules,
			mediaWikiSiteRules,
			...crawlClaimingSiteRules,
		]);
		expect(crawlClaimingSiteRules).toHaveLength(3);
	});

	it("claims X, Apple News and Stack Overflow URLs among the crawl-claiming rules", () => {
		const { crawlClaimingSiteRules } = initArticleSiteRules({ crawlFetch: recordingCrawlFetch([]), logError: () => {} });

		const claimed = (url: string) =>
			crawlClaimingSiteRules.filter((site) => matchingSiteRuleUrl({ site, url }) !== undefined).length;

		expect(claimed("https://x.com/jack/status/20")).toBe(1);
		expect(claimed("https://twitter.com/jack/status/20")).toBe(1);
		expect(claimed("https://apple.news/A123")).toBe(1);
		expect(claimed("https://stackoverflow.com/questions/42/why")).toBe(1);
		expect(claimed("https://example.com/story")).toBe(0);
	});

	it("gives the crawl-claiming rules the crawl fetch it was built with", async () => {
		const requested: string[] = [];
		const { crawlClaimingSiteRules } = initArticleSiteRules({
			crawlFetch: recordingCrawlFetch(requested),
			logError: () => {},
		});
		const [xTwitter] = crawlClaimingSiteRules;

		const outcome = await xTwitter.onCrawl({ url: "https://x.com/jack/status/20" });

		expect(outcome).toEqual({
			kind: "content",
			html: "<html><head><title>Jack</title></head><body><blockquote>just setting up</blockquote></body></html>",
		});
		expect(requested).toEqual(["https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fjack%2Fstatus%2F20"]);
	});
});
