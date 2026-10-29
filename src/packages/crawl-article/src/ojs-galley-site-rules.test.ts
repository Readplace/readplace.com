import { initOjsGalleySiteRules } from "./ojs-galley-site-rules";
import type { CrawlFetch } from "./crawl-fetch";

const VIEWER = "https://journals.example.org/index.php/sample/article/view/37/33";
const DOWNLOAD = "https://journals.example.org/index.php/sample/article/download/37/33/527";

function viewerHtml(params: { downloadHref?: string; generator?: string; pdfViewer?: boolean }): string {
	const generator = params.generator === undefined ? "" : `<meta name="generator" content="${params.generator}" />`;
	const download = params.downloadHref === undefined
		? '<a class="download" download><span class="label">Download</span></a>'
		: `<a href="${params.downloadHref}" class="download" download><span class="label">Download</span></a>`;
	const container = params.pdfViewer === false
		? '<div class="galley_view"><p>An HTML galley body.</p></div>'
		: '<div id="pdfCanvasContainer" class="galley_view"><iframe src="" width="100%" height="100%" title="PDF of A sample study" allow="fullscreen"></iframe></div>';
	return `<!DOCTYPE html>
<html lang="en-US">
<head>
	<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
	<title>View of A sample study</title>
	${generator}
</head>
<body class="pkp_page_article pkp_op_view">
	<header class="header_view">
		<a href="https://journals.example.org/index.php/sample/article/view/37" class="return"><span class="pkp_screen_reader">Return to Article Details</span></a>
		<a href="https://journals.example.org/index.php/sample/article/view/37" class="title">A sample study</a>
		${download}
	</header>
	${container}
</body>
</html>`;
}

function ojsViewer(downloadHref: string): string {
	return viewerHtml({ downloadHref, generator: "Open Journal Systems 3.3.0.21" });
}

function siteFor(html: string) {
	const crawlFetch: CrawlFetch = async () => new Response(html, { status: 200 });
	return initOjsGalleySiteRules({ crawlFetch, logError: () => {} });
}

describe("OJS galley site rules", () => {
	it.each([
		["https://journals.example.org/index.php/sample/article/view/37/33", true],
		["https://reviews.example.net/article/view/220/218", true],
		["http://journals.example.org/sample/article/view/1/2?x=1#p", true],
		["https://journals.example.org/index.php/sample/article/view/37", false],
		["https://journals.example.org/index.php/sample/article/download/37/33/527", false],
		["https://journals.example.org/index.php/sample/article/download/37/33", false],
		["https://journals.example.org/index.php/sample/article/view/37/33/527", false],
		["https://journals.example.org/index.php/sample/article/view/abc/33", false],
		["https://journals.example.org/index.php/sample/article/view/37/abc", false],
		["https://user:pw@journals.example.org/index.php/sample/article/view/1/2", false],
		["ftp://journals.example.org/index.php/sample/article/view/1/2", false],
		["invalid", false],
	])("claims only OJS galley viewer URL shapes: %s", (url, expected) => {
		expect(siteFor("").matches({ url, hostname: "journals.example.org" })).toBe(expected);
	});

	it.each([
		{ viewer: VIEWER, download: DOWNLOAD },
		{ viewer: VIEWER, download: "https://journals.example.org/index.php/sample/article/download/37/33" },
		{ viewer: "https://journals.example.org/sample/article/view/37/33", download: "https://journals.example.org/sample/article/download/37/33/527" },
		{ viewer: "https://reviews.example.net/article/view/220/218", download: "https://reviews.example.net/article/download/220/218" },
		{ viewer: "https://reviews.example.net/article/view/220/218?x=1#p", download: "/article/download/220/218/9" },
	])("follows the declared same-origin PDF galley download $download from $viewer", async ({ viewer, download }) => {
		expect(await siteFor(ojsViewer(download)).onCrawl({ url: viewer })).toEqual({
			kind: "redirect",
			url: new URL(download, viewer).href,
		});
	});

	it("declines a non-OJS page that happens to carry a download link", async () => {
		expect(await siteFor(viewerHtml({ downloadHref: DOWNLOAD })).onCrawl({ url: VIEWER })).toEqual({ kind: "skip" });
	});

	it("declines a generator that is not OJS", async () => {
		const html = viewerHtml({ downloadHref: DOWNLOAD, generator: "WordPress 6.5" });
		expect(await siteFor(html).onCrawl({ url: VIEWER })).toEqual({ kind: "skip" });
	});

	it("declines an OJS page without the PDF galley viewer", async () => {
		const html = viewerHtml({ downloadHref: DOWNLOAD, generator: "Open Journal Systems 3.3.0.21", pdfViewer: false });
		expect(await siteFor(html).onCrawl({ url: VIEWER })).toEqual({ kind: "skip" });
	});

	it("declines an OJS viewer without a download href", async () => {
		const html = viewerHtml({ generator: "Open Journal Systems 3.3.0.21" });
		expect(await siteFor(html).onCrawl({ url: VIEWER })).toEqual({ kind: "skip" });
	});

	it("declines an OJS viewer without a download link", async () => {
		const html = ojsViewer(DOWNLOAD).replace('class="download"', 'class="other"');
		expect(await siteFor(html).onCrawl({ url: VIEWER })).toEqual({ kind: "skip" });
	});

	it.each([
		"https://cdn.example.net/index.php/sample/article/download/37/33/527",
		"http://journals.example.org/index.php/sample/article/download/37/33/527",
		"https://journals.example.org/index.php/other/article/download/37/33/527",
		"https://journals.example.org/index.php/sample/article/download/38/33/527",
		"https://journals.example.org/index.php/sample/article/download/37/34",
		"https://journals.example.org/index.php/sample/article/download/37/33/abc",
		"https://journals.example.org/index.php/sample/article/download/37/33/527?x=1",
		"https://journals.example.org/index.php/sample/article/download/37/33/527#f",
		"https://journals.example.org/index.php/sample/article/view/37",
		"javascript:void(0)",
		"https://[invalid",
	])("declines a cross-origin or mismatched download href: %s", async (href) => {
		expect(await siteFor(ojsViewer(href)).onCrawl({ url: VIEWER })).toEqual({ kind: "skip" });
	});

	it("declines a non-viewer URL when called directly", async () => {
		expect(await siteFor("").onCrawl({ url: "https://journals.example.org/index.php/sample/article/view/37" })).toEqual({ kind: "skip" });
	});

	it.each([404, 500])("declines when the viewer answers %i", async (status) => {
		const site = initOjsGalleySiteRules({ crawlFetch: async () => new Response(null, { status }), logError: () => {} });
		expect(await site.onCrawl({ url: VIEWER })).toEqual({ kind: "skip" });
	});

	it.each([new Error("network failure"), "network failure"])("logs and declines on a viewer fetch error", async (error) => {
		const logError = jest.fn();
		const site = initOjsGalleySiteRules({ crawlFetch: async () => { throw error; }, logError });
		expect(await site.onCrawl({ url: VIEWER })).toEqual({ kind: "skip" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] OJS galley viewer resolution failed", error instanceof Error ? error : undefined);
	});
});
