import { initCrawlArticle, type CrawlFetch } from "@packages/crawl-article";
import { initArticleSiteRules } from "./article-site-rules";

it.each([
	"https://github.com/sample/docs",
	"https://github.com/sample/docs/blob/main/index.ts",
	"https://github.com/sample/docs/blob/main/notes.txt",
	"https://raw.githubusercontent.com/sample/docs/main/paper.pdf",
	"https://example.com/sample/docs/blob/main/paper.pdf",
])("preserves the ordinary crawl path for %s", async (url) => {
	const requested: string[] = [];
	const html = "<html><body><p>The normal fetched document.</p></body></html>";
	const crawlFetch: CrawlFetch = async (target) => {
		requested.push(target);
		return new Response(html, { headers: { "content-type": "text/html" } });
	};
	const { siteRules } = initArticleSiteRules({ crawlFetch, logError: () => {} });
	const crawl = initCrawlArticle({ crawlFetch, siteRules, logError: () => {}, logInfo: () => {} });

	expect(await crawl({ url })).toMatchObject({ status: "fetched", html });
	expect(requested).toEqual([url]);
});

it("fails the registered viewer crawl when GitHub only serves its PDF loading shell", async () => {
	const url = "https://github.com/sample/docs/blob/main/paper.pdf";
	const requested: string[] = [];
	const crawlFetch: CrawlFetch = async (target) => {
		requested.push(target);
		return new Response("<html><head><title>paper.pdf</title></head><body>Loading document…</body></html>");
	};
	const { siteRules } = initArticleSiteRules({ crawlFetch, logError: () => {} });
	const crawl = initCrawlArticle({ crawlFetch, siteRules, logError: () => {}, logInfo: () => {} });

	expect(await crawl({ url })).toEqual({ status: "failed" });
	expect(requested).toEqual([url]);
});


it.each(["1", "true"])("preserves GitHub raw=%s PDF downloads through normal media dispatch", async (raw) => {
	const url = `https://github.com/sample/docs/blob/main/paper.pdf?raw=${raw}`;
	const requested: string[] = [];
	const crawlFetch: CrawlFetch = async (target) => {
		requested.push(target);
		return new Response("%PDF-1.4\nDirect PDF download", { headers: { "content-type": "application/pdf" } });
	};
	const { siteRules } = initArticleSiteRules({ crawlFetch, logError: () => {} });
	const crawl = initCrawlArticle({ crawlFetch, siteRules, logError: () => {}, logInfo: () => {} });

	expect(await crawl({ url })).toEqual({ status: "unsupported", reason: "unsupported content type: application/pdf" });
	expect(requested).toEqual([url]);
});
