import { initCrawlArticle, rejectDocumentLandingPage, type CrawlFetch } from "@packages/crawl-article";
import { initArticleSiteRules } from "./article-site-rules";

function crawlWith(responses: Record<string, () => Response>) {
	const requested: string[] = [];
	const crawlFetch: CrawlFetch = async (target) => {
		requested.push(target);
		const response = responses[target]();
		Object.defineProperty(response, "url", { value: target });
		return response;
	};
	const { siteRules } = initArticleSiteRules({ crawlFetch, logError: () => {} });
	const crawl = initCrawlArticle({ rejectDocumentLandingPage, crawlFetch, siteRules, logError: () => {}, logInfo: () => {}, logThumbnailNotDelivered: () => {} });
	return { crawl, requested };
}

const html = (body: string) => () => new Response(`<html><body>${body}</body></html>`, { status: 200, headers: { "content-type": "text/html" } });

it("defers a registered transaction page's declared PDF to comprehensive extraction", async () => {
	const url = "https://ftpartners.com/transactions/sample-deal";
	const download = "https://ftpartners.com/assets/abc123/FT_Partners_Profile_-_Sample.pdf";
	const { crawl, requested } = crawlWith({
		[url]: html(`<h1>Sample deal</h1><div id="description"></div><footer>Firm disclosures</footer><script>adobeDCView.previewFile({ content:{ location:{ url: "${download}", } } });</script>`),
		[download]: () => new Response("%PDF-1.4\nSynthetic profile bytes", { status: 200, headers: { "content-type": "application/pdf" } }),
	});

	expect(await crawl({ url })).toEqual({ status: "unsupported", reason: "unsupported content type: application/pdf" });
	expect(requested).toEqual([url, download]);
});

it("crawls a page outside the transactions path as an ordinary page", async () => {
	const url = "https://ftpartners.com/about";
	const { crawl, requested } = crawlWith({ [url]: html("<article><p>About the firm.</p></article>") });

	expect(await crawl({ url })).toMatchObject({ status: "fetched" });
	expect(requested).toEqual([url]);
});
