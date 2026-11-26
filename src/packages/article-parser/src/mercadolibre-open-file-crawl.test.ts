import { initCrawlArticle, rejectDocumentLandingPage, type CrawlFetch } from "@packages/crawl-article";
import { initArticleSiteRules } from "./article-site-rules";

const FILE = "aHR0cHM6Ly9maWxlcy5leGFtcGxlLmNvbS9hbm51YWwtcmVwb3J0LnBkZg==";
const VIEWER = `https://investor.mercadolibre.com/open-file?file=${FILE}`;
const PDF = `https://investor.mercadolibre.com/open-file/pdf?file=${FILE}`;
const TRACKER = "https://newsletter.example.com/redirect/abc123";

const OPEN_FILE_VIEWER = `<!DOCTYPE html>
<html data-framework="nordic">
<head><title>Open file</title></head>
<body>
	<main class="open-file-page"><iframe class="open-file-page__viewer" src="/open-file/pdf?file=${FILE}" title="annual-report.pdf"></iframe></main>
	<div class="cookie-consent-banner"><p>By browsing this site, you accept the cookies.</p></div>
</body>
</html>`;

function initCrawl(crawlFetch: CrawlFetch) {
	const { siteRules } = initArticleSiteRules({ crawlFetch, logError: () => {} });
	return initCrawlArticle({
		rejectDocumentLandingPage,
		crawlFetch,
		siteRules,
		logError: () => {},
		logInfo: () => {},
		logThumbnailNotDelivered: () => {},
	});
}

function openFileFetch(requested: string[]): CrawlFetch {
	return async (target) => {
		requested.push(target);
		if (target === PDF) {
			return new Response("%PDF-1.4\nAnnual report PDF bytes", { status: 200, headers: { "content-type": "application/pdf" } });
		}
		const response = new Response(OPEN_FILE_VIEWER, { status: 200, headers: { "content-type": "text/html" } });
		Object.defineProperty(response, "url", { value: target === TRACKER ? VIEWER : target });
		return response;
	};
}

it.each([
	{ url: PDF, requested: [PDF] },
	{ url: `https://investor.example.com/open-file?file=${FILE}`, requested: [`https://investor.example.com/open-file?file=${FILE}`] },
])("preserves the ordinary crawl path for $url", async ({ url, requested: expected }) => {
	const requested: string[] = [];
	const html = "<html><body><p>The normal fetched document.</p></body></html>";
	const crawl = initCrawl(async (target) => {
		requested.push(target);
		return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
	});

	expect(await crawl({ chargeOcrPages: undefined, url })).toMatchObject({ status: "fetched", html });
	expect(requested).toEqual(expected);
});

it("defers the MercadoLibre open-file PDF to the comprehensive crawl", async () => {
	const requested: string[] = [];
	const crawl = initCrawl(openFileFetch(requested));

	expect(await crawl({ chargeOcrPages: undefined, url: VIEWER })).toEqual({ status: "unsupported", reason: "unsupported content type: application/pdf" });
	expect(requested).toEqual([VIEWER, PDF]);
});

it("defers the open-file PDF when a newsletter tracker lands on the viewer", async () => {
	const requested: string[] = [];
	const crawl = initCrawl(openFileFetch(requested));

	expect(await crawl({ chargeOcrPages: undefined, url: TRACKER })).toMatchObject({ status: "unsupported", reason: "unsupported content type: application/pdf" });
	expect(requested).toEqual([TRACKER, VIEWER, PDF]);
});
