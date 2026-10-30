import { initCrawlArticle, type CrawlFetch } from "@packages/crawl-article";
import { initArticleSiteRules } from "./article-site-rules";

it("defers the registered document landing's declared PDF to comprehensive extraction", async () => {
	const url = "https://www.gallup.com/analytics/123/sample-report.aspx";
	const download = "https://www.gallup.com/file/analytics/123/sample-report.pdf";
	const requested: string[] = [];
	const crawlFetch: CrawlFetch = async (target) => {
		requested.push(target);
		return target === download
			? new Response("%PDF-1.4\nSynthetic report bytes", { status: 200, headers: { "content-type": "application/pdf" } })
			: new Response(`<html><body><nav>Publisher navigation</nav><main class="sa-document"><article class="o-article"><div class="article-content"><p><a class="gel-icon-document-pdf-solid" href="${download}">Download report</a></p></div></article></main></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
	};
	const { siteRules } = initArticleSiteRules({ crawlFetch, logError: () => {} });
	const crawl = initCrawlArticle({ crawlFetch, siteRules, logError: () => {}, logInfo: () => {}, logThumbnailNotDelivered: () => {} });

	expect(await crawl({ url })).toEqual({ status: "unsupported", reason: "unsupported content type: application/pdf" });
	expect(requested).toEqual([url, download]);
});
