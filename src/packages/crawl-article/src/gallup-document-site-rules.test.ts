import { initGallupDocumentSiteRules } from "./gallup-document-site-rules";
import { MAX_HTML_BYTES } from "./html-body-limit";

const LANDING = "https://www.gallup.com/analytics/123/sample-report.aspx";
const PDF = "https://www.gallup.com/file/analytics/123/sample-report.pdf";

function documentHtml(links = `<a class="gel-icon-document-pdf-solid" href="${PDF}">Download report</a>`): string {
	return `<html><body><main class="sa-document"><article class="o-article"><div class="article-content"><p>${links}</p></div></article></main></body></html>`;
}

function siteFor(html: string) {
	return initGallupDocumentSiteRules({ crawlFetch: async () => new Response(html, { status: 200 }), logError: () => {} });
}

describe("Gallup document site rules", () => {
	it("redirects the dedicated document's primary declaration to its same-publication PDF", async () => {
		expect(await siteFor(documentHtml()).onCrawl({ url: LANDING })).toEqual({ kind: "redirect", url: PDF });
	});

	it("resolves a relative download and accepts repeated declarations of the same target", async () => {
		const link = '<a class="gel-icon-document-pdf-solid" href="/file/analytics/123/sample-report.pdf">PDF</a>';
		expect(await siteFor(documentHtml(link + link)).onCrawl({ url: LANDING })).toEqual({ kind: "redirect", url: PDF });
	});

	it.each([
		[LANDING, true],
		["http://www.gallup.com/analytics/123/sample-report.aspx", true],
		["https://example.org/analytics/123/sample-report.aspx", false],
		["https://www.gallup.com/analytics/report/sample.aspx", false],
		[PDF, false],
		["https://reader:secret@www.gallup.com/analytics/123/sample-report.aspx", false],
		["ftp://www.gallup.com/analytics/123/sample-report.aspx", false],
		["invalid", false],
	])("claims only the publisher landing shape: %s", (url, expected) => {
		expect(siteFor("").matches({ url, hostname: new URL(LANDING).hostname })).toBe(expected);
	});

	it.each([
		documentHtml().replace('class="sa-document"', 'class="sa-article"'),
		documentHtml().replace('class="o-article"', 'class="other"'),
		documentHtml().replace('class="article-content"', 'class="related-content"'),
		documentHtml().replace('class="gel-icon-document-pdf-solid"', 'class="attachment"'),
		documentHtml(""),
		documentHtml('<a class="gel-icon-document-pdf-solid">PDF</a>'),
		`<main class="sa-document"><a class="gel-icon-document-pdf-solid" href="${PDF}">Related PDF</a><article class="o-article"><div class="article-content">Article body</div></article></main>`,
		documentHtml() + documentHtml(),
	])("leaves ordinary articles and secondary or missing declarations to the ordinary crawl", async (html) => {
		expect(await siteFor(html).onCrawl({ url: LANDING })).toEqual({ kind: "skip" });
	});

	it("declines multiple distinct primary downloads", async () => {
		const links = `<a class="gel-icon-document-pdf-solid" href="${PDF}">Report</a><a class="gel-icon-document-pdf-solid" href="/file/analytics/123/other-report.pdf">Other report</a>`;
		expect(await siteFor(documentHtml(links)).onCrawl({ url: LANDING })).toEqual({ kind: "skip" });
	});

	it.each([
		"/file/analytics/124/sample-report.pdf",
		"/file/other/123/sample-report.pdf",
		"/file/analytics/123/sample-report.html",
		"https://example.org/file/analytics/123/sample-report.pdf",
		"http://www.gallup.com/file/analytics/123/sample-report.pdf",
		"https://reader:secret@www.gallup.com/file/analytics/123/sample-report.pdf",
		`${PDF}?download=1`,
		`${PDF}#page=2`,
		"javascript:void(0)",
		"https://[invalid",
	])("declines mismatched or invalid declarations: %s", async (href) => {
		expect(await siteFor(documentHtml(`<a class="gel-icon-document-pdf-solid" href="${href}">PDF</a>`)).onCrawl({ url: LANDING })).toEqual({ kind: "skip" });
	});

	it("declines an unclaimed URL when invoked directly", async () => {
		expect(await siteFor(documentHtml()).onCrawl({ url: "https://example.org/story" })).toEqual({ kind: "skip" });
	});

	it.each([403, 500])("declines a landing response with status %i", async (status) => {
		const site = initGallupDocumentSiteRules({ crawlFetch: async () => new Response(null, { status }), logError: () => {} });
		expect(await site.onCrawl({ url: LANDING })).toEqual({ kind: "skip" });
	});

	it.each([new Error("fetch failed"), "fetch failed"])("logs and declines a failed landing fetch", async (error) => {
		const logError = jest.fn();
		const site = initGallupDocumentSiteRules({ crawlFetch: async () => { throw error; }, logError });
		expect(await site.onCrawl({ url: LANDING })).toEqual({ kind: "skip" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Gallup document resolution failed", error instanceof Error ? error : undefined);
	});

	it("declines a landing body exceeding the existing HTML cap", async () => {
		const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MAX_HTML_BYTES.bytes + 1)); controller.close(); } });
		const site = initGallupDocumentSiteRules({ crawlFetch: async () => new Response(body, { status: 200 }), logError: () => {} });
		expect(await site.onCrawl({ url: LANDING })).toEqual({ kind: "skip" });
	});
});
