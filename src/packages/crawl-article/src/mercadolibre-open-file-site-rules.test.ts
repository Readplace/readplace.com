import { initMercadoLibreOpenFileSiteRules } from "./mercadolibre-open-file-site-rules";
import type { CrawlFetch } from "./crawl-fetch";

const FILE = "aHR0cHM6Ly9maWxlcy5leGFtcGxlLmNvbS9hbm51YWwtcmVwb3J0LnBkZg==";
const VIEWER = `https://investor.mercadolibre.com/open-file?file=${FILE}`;
const PDF = `https://investor.mercadolibre.com/open-file/pdf?file=${FILE}`;

function viewerHtml(iframe: string): string {
	return `<!DOCTYPE html>
<html data-framework="nordic">
<head><title>Open file</title></head>
<body>
	<main class="open-file-page">${iframe}</main>
	<div class="cookie-consent-banner"><p>By browsing this site, you accept the cookies.</p></div>
</body>
</html>`;
}

function viewerWithSrc(src: string): string {
	return viewerHtml(`<iframe class="open-file-page__viewer" src="${src}" title="annual-report.pdf"></iframe>`);
}

function siteFor(html: string) {
	const crawlFetch: CrawlFetch = async () => new Response(html, { status: 200 });
	return initMercadoLibreOpenFileSiteRules({ crawlFetch, logError: () => {} });
}

describe("MercadoLibre investor open-file site rules", () => {
	it.each([
		[VIEWER, true],
		[`${VIEWER}&utm_source=newsletter&utm_medium=email`, true],
		[`https://investor.mercadolibre.com/open-file?utm_source=newsletter&file=${FILE}`, true],
		[`http://investor.mercadolibre.com/open-file?file=${FILE}`, false],
		[`https://user:pw@investor.mercadolibre.com/open-file?file=${FILE}`, false],
		[`https://investor.mercadolibre.com:8443/open-file?file=${FILE}`, false],
		[`https://www.mercadolibre.com/open-file?file=${FILE}`, false],
		[`https://investor.example.com/open-file?file=${FILE}`, false],
		[PDF, false],
		[`https://investor.mercadolibre.com/open-file/other?file=${FILE}`, false],
		[`https://investor.mercadolibre.com/reports?file=${FILE}`, false],
		["https://investor.mercadolibre.com/open-file", false],
		["https://investor.mercadolibre.com/open-file?file=", false],
		[`https://investor.mercadolibre.com/open-file?file=${FILE}&file=${FILE}`, false],
		["invalid", false],
	])("claims only the investor open-file viewer: %s", (url, expected) => {
		expect(siteFor("").matches({ url, hostname: "investor.mercadolibre.com" })).toBe(expected);
	});

	it.each([
		{ viewer: VIEWER, src: `/open-file/pdf?file=${FILE}` },
		{ viewer: `${VIEWER}&utm_source=newsletter`, src: `/open-file/pdf?file=${FILE}` },
		{ viewer: VIEWER, src: PDF },
	])("follows the declared same-origin PDF iframe $src from $viewer", async ({ viewer, src }) => {
		expect(await siteFor(viewerWithSrc(src)).onCrawl({ url: viewer })).toEqual({ kind: "redirect", url: PDF });
	});

	it("declines a viewer without the PDF iframe", async () => {
		expect(await siteFor(viewerHtml("")).onCrawl({ url: VIEWER })).toEqual({ kind: "skip" });
	});

	it("declines a viewer iframe without a src", async () => {
		const html = viewerHtml('<iframe class="open-file-page__viewer" title="annual-report.pdf"></iframe>');
		expect(await siteFor(html).onCrawl({ url: VIEWER })).toEqual({ kind: "skip" });
	});

	it("declines an iframe that is not the open-file viewer", async () => {
		const html = viewerHtml(`<iframe class="other" src="/open-file/pdf?file=${FILE}"></iframe>`);
		expect(await siteFor(html).onCrawl({ url: VIEWER })).toEqual({ kind: "skip" });
	});

	it.each([
		`https://cdn.example.net/open-file/pdf?file=${FILE}`,
		`http://investor.mercadolibre.com/open-file/pdf?file=${FILE}`,
		"/open-file/pdf?file=aHR0cHM6Ly9maWxlcy5leGFtcGxlLmNvbS9vdGhlci5wZGY=",
		`/open-file/pdf?file=${FILE}&file=${FILE}`,
		"/open-file/pdf",
		`/open-file/download?file=${FILE}`,
		`/open-file/pdf?file=${FILE}&page=2`,
		`/open-file/pdf?file=${FILE}#page=2`,
		"https://[invalid",
	])("declines a cross-origin or mismatched iframe src: %s", async (src) => {
		expect(await siteFor(viewerWithSrc(src)).onCrawl({ url: VIEWER })).toEqual({ kind: "skip" });
	});

	it("declines a non-viewer URL when called directly", async () => {
		expect(await siteFor(viewerWithSrc(PDF)).onCrawl({ url: PDF })).toEqual({ kind: "skip" });
	});

	it.each([403, 404, 500])("declines when the viewer answers %i", async (status) => {
		const site = initMercadoLibreOpenFileSiteRules({ crawlFetch: async () => new Response(null, { status }), logError: () => {} });
		expect(await site.onCrawl({ url: VIEWER })).toEqual({ kind: "skip" });
	});

	it.each([new Error("network failure"), "network failure"])("logs and declines on a viewer fetch error", async (error) => {
		const logError = jest.fn();
		const site = initMercadoLibreOpenFileSiteRules({ crawlFetch: async () => { throw error; }, logError });
		expect(await site.onCrawl({ url: VIEWER })).toEqual({ kind: "skip" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] MercadoLibre open-file viewer resolution failed", error instanceof Error ? error : undefined);
	});
});
