import { initCrawlArticle, type CrawlFetch } from "@packages/crawl-article";
import { initArticleSiteRules } from "./article-site-rules";

const VIEWER = "https://journals.example.org/index.php/sample/article/view/37/33";
const DOWNLOAD = "https://journals.example.org/index.php/sample/article/download/37/33/527";

const OJS_PDF_VIEWER = `<!DOCTYPE html>
<html lang="en-US">
<head>
	<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
	<title>View of A sample study</title>
	<meta name="generator" content="Open Journal Systems 3.3.0.21" />
</head>
<body class="pkp_page_article pkp_op_view">
	<header class="header_view">
		<a href="https://journals.example.org/index.php/sample/article/view/37" class="return"><span class="pkp_screen_reader">Return to Article Details</span></a>
		<a href="https://journals.example.org/index.php/sample/article/view/37" class="title">A sample study</a>
		<a href="${DOWNLOAD}" class="download" download><span class="label">Download</span><span class="pkp_screen_reader">Download PDF</span></a>
	</header>
	<div id="pdfCanvasContainer" class="galley_view">
		<iframe src="" width="100%" height="100%" title="PDF of A sample study" allow="fullscreen"></iframe>
	</div>
</body>
</html>`;

it.each([
	{ url: "https://journals.example.org/index.php/sample/article/view/37", requested: ["https://journals.example.org/index.php/sample/article/view/37"] },
	{ url: DOWNLOAD, requested: [DOWNLOAD] },
	{ url: "https://news.example.com/article/view/1/2", requested: ["https://news.example.com/article/view/1/2", "https://news.example.com/article/view/1/2"] },
])("preserves the ordinary crawl path for $url", async ({ url, requested: expected }) => {
	const requested: string[] = [];
	const html = "<html><body><p>The normal fetched document.</p></body></html>";
	const crawlFetch: CrawlFetch = async (target) => {
		requested.push(target);
		return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
	};
	const { siteRules } = initArticleSiteRules({ crawlFetch, logError: () => {} });
	const crawl = initCrawlArticle({
		crawlFetch,
		siteRules,
		logError: () => {},
		logInfo: () => {},
		logThumbnailNotDelivered: () => {},
	});

	expect(await crawl({ url })).toMatchObject({ status: "fetched", html });
	expect(requested).toEqual(expected);
});

it("defers the OJS PDF galley to the comprehensive crawl", async () => {
	const requested: string[] = [];
	const crawlFetch: CrawlFetch = async (target) => {
		requested.push(target);
		return target === DOWNLOAD
			? new Response("%PDF-1.4\nGalley PDF bytes", { status: 200, headers: { "content-type": "application/pdf" } })
			: new Response(OJS_PDF_VIEWER, { status: 200, headers: { "content-type": "text/html" } });
	};
	const { siteRules } = initArticleSiteRules({ crawlFetch, logError: () => {} });
	const crawl = initCrawlArticle({
		crawlFetch,
		siteRules,
		logError: () => {},
		logInfo: () => {},
		logThumbnailNotDelivered: () => {},
	});

	expect(await crawl({ url: VIEWER })).toEqual({ status: "unsupported", reason: "unsupported content type: application/pdf" });
	expect(requested).toEqual([VIEWER, DOWNLOAD]);
});
