import { withResolvedUrl } from "./follow-redirects";
import { initFtPartnersTransactionSiteRules } from "./ftpartners-transaction-site-rules";

const LANDING = "https://ftpartners.com/transactions/sample-deal";
const PDF = "https://ftpartners.com/assets/abc123/FT_Partners_Profile_-_Sample.pdf";

function previewDeclaration(url: string): string {
	return `adobeDCView.previewFile({ content:{ location:{ url: "${url}", } }, metaData:{ fileName: "Sample.pdf" } }, { embedMode: "SIZED_CONTAINER" });`;
}

function transactionHtml(script = previewDeclaration(PDF)): string {
	return `<html><body><h1>Sample deal</h1><div id="description"></div><footer>Firm disclosures</footer><script>${script}</script></body></html>`;
}

function landingResponse(params: { html: string; url: string }): Response {
	return withResolvedUrl(new Response(params.html, { status: 200 }), params.url);
}

function siteFor(html: string) {
	return initFtPartnersTransactionSiteRules({ crawlFetch: async () => landingResponse({ html, url: LANDING }), logError: () => {} });
}

describe("FT Partners transaction site rules", () => {
	it("redirects a transaction page to the one same-origin PDF its embed declares", async () => {
		expect(await siteFor(transactionHtml()).onCrawl({ url: LANDING })).toEqual({ kind: "redirect", url: PDF });
	});

	it("resolves the declaration against the landing page the fetch ended on", async () => {
		const site = initFtPartnersTransactionSiteRules({
			crawlFetch: async () => landingResponse({ html: transactionHtml(), url: LANDING }),
			logError: () => {},
		});
		expect(await site.onCrawl({ url: "http://ftpartners.com/transactions/sample-deal" })).toEqual({ kind: "redirect", url: PDF });
	});

	it.each([
		[LANDING, true],
		["http://ftpartners.com/transactions/sample-deal", true],
		["https://ftpartners.com/transactions/sample-deal/", true],
		["https://ftpartners.com/about", false],
		["https://ftpartners.com/transactions", false],
		["https://ftpartners.com/transactions/sample-deal/more", false],
		["https://example.org/transactions/sample-deal", false],
		["https://reader:secret@ftpartners.com/transactions/sample-deal", false],
		["ftp://ftpartners.com/transactions/sample-deal", false],
		["invalid", false],
	])("claims only transaction pages: %s", (url, expected) => {
		expect(siteFor("").matches({ url, hostname: "ftpartners.com" })).toBe(expected);
	});

	it.each([
		["no declaration", transactionHtml("var viewer = 1;")],
		["two declarations", transactionHtml(previewDeclaration(PDF) + previewDeclaration(PDF))],
		["a declaration in two scripts", `${transactionHtml()}<script>${previewDeclaration(PDF)}</script>`],
		["a declaration without a location url", transactionHtml('adobeDCView.previewFile({ content:{ promise: load() } });')],
		["a cross-origin target", transactionHtml(previewDeclaration("https://example.org/assets/Sample.pdf"))],
		["another scheme", transactionHtml(previewDeclaration("http://ftpartners.com/assets/Sample.pdf"))],
		["a credentialed target", transactionHtml(previewDeclaration("https://reader:secret@ftpartners.com/assets/Sample.pdf"))],
		["a query", transactionHtml(previewDeclaration(`${PDF}?download=1`))],
		["a fragment", transactionHtml(previewDeclaration(`${PDF}#page=2`))],
		["a non-PDF target", transactionHtml(previewDeclaration("https://ftpartners.com/assets/Sample.html"))],
		["an unparseable target", transactionHtml(previewDeclaration("https://[invalid"))],
	])("leaves the page to the ordinary crawl for %s", async (_case, html) => {
		expect(await siteFor(html).onCrawl({ url: LANDING })).toEqual({ kind: "skip" });
	});

	it("declines an unclaimed URL when invoked directly", async () => {
		expect(await siteFor(transactionHtml()).onCrawl({ url: "https://ftpartners.com/about" })).toEqual({ kind: "skip" });
	});

	it.each([403, 500])("declines a landing response with status %i", async (status) => {
		const site = initFtPartnersTransactionSiteRules({ crawlFetch: async () => new Response(null, { status }), logError: () => {} });
		expect(await site.onCrawl({ url: LANDING })).toEqual({ kind: "skip" });
	});

	it.each([new Error("fetch failed"), "fetch failed"])("logs and declines a failed landing fetch", async (error) => {
		const logError = jest.fn();
		const site = initFtPartnersTransactionSiteRules({ crawlFetch: async () => { throw error; }, logError });
		expect(await site.onCrawl({ url: LANDING })).toEqual({ kind: "skip" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] FT Partners transaction resolution failed", error instanceof Error ? error : undefined);
	});
});
