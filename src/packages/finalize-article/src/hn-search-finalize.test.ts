import { parseHTML } from "linkedom";
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
import { initHnSearchSiteRules } from "@packages/crawl-article";
import { initFinalizeArticle } from "./finalize-article";

const SEARCH_URL = "https://hn.algolia.com/?dateRange=all&page=0&prefix=true&query=glass%20frog&sort=byPopularity&type=story";

it("keeps all thirty search results and returned story bodies through the production parser and finalizer", async () => {
	const hits = Array.from({ length: 30 }, (_, index) => ({
		objectID: String(index + 1),
		title: index === 1 ? "Search results for “glass frog”" : `Glass frog result ${index + 1}`,
		url: `https://example.org/story/${index + 1}`,
		story_text: index < 11 ? `Returned story text ${index + 1}.` : null,
		_tags: ["story"],
		points: 10 + index,
		num_comments: index,
		author: "author",
		created_at: "2026-01-01T00:00:00.000Z",
	}));
	const rule = initHnSearchSiteRules({
		crawlFetch: async () => new Response(JSON.stringify({ query: "glass frog", page: 0, hitsPerPage: 30, hits }), { status: 200 }),
		logError: () => {},
	});
	const outcome = await rule.onCrawl({ url: SEARCH_URL });
	if (outcome.kind !== "content") throw new Error("Expected search collection");
	const { parseHtml } = initReadabilityParser({
		crawlArticle: async () => { throw new Error("Unexpected crawl"); },
		siteRules: [rule],
		readabilityAdditions,
		logError: () => {},
	});
	const finalize = initFinalizeArticle({
		parseHtml,
		downloadMedia: async () => [],
		processContent: async ({ html }) => html,
		fetchThumbnailImage: async () => ({ image: undefined, provenUnusable: [] }),
		putImageObject: async () => { throw new Error("Unexpected image write"); },
		imagesCdnBaseUrl: "https://cdn.example.org",
	});
	const final = await finalize({ url: SEARCH_URL, documentUrl: SEARCH_URL, html: outcome.html });
	if (!final.ok) throw new Error(final.reason);
	expect(final.article.metadata.wordCount).toBeGreaterThan(300);
	const { document } = parseHTML(final.article.html);
	const text = document.documentElement.textContent;
	const links: string[] = [];
	for (const anchor of document.querySelectorAll("a[href]")) links.push(anchor.getAttribute("href"));
	for (const hit of hits) {
		expect(text).toContain(hit.title);
		expect(links).toContain(`https://news.ycombinator.com/item?id=${hit.objectID}`);
		if (hit.story_text) expect(text).toContain(hit.story_text);
	}
	expect(links.filter((link) => link?.startsWith("https://news.ycombinator.com/item?id="))).toEqual(
		hits.map((hit) => `https://news.ycombinator.com/item?id=${hit.objectID}`),
	);
});
