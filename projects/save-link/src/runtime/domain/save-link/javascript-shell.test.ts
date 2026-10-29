import type { CrawlAndFinalizeArticle, CrawlAndFinalizeResult } from "@packages/finalize-article";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { deferJavascriptShells } from "./javascript-shell";

const SHELL_HTML = '<html><head><title>App</title><script src="/static/app.js"></script></head><body><div id="root"></div></body></html>';

const JAVASCRIPT_REQUIRED = {
	status: "unsupported",
	reason: "javascript-required",
	unsupportedReason: { kind: "javascript-required" },
};

function fetchedPage(page: {
	evaluationHtml: string;
	wordCount: number;
	httpStatus?: number;
	directResourceKind?: "image" | "plain-text";
	articleHtml?: string;
	finalUrl?: string;
}): CrawlAndFinalizeResult {
	return {
		status: "fetched",
		article: {
			html: page.articleHtml ?? "<p></p>",
			metadata: {
				title: "App",
				siteName: "example-spa.test",
				excerpt: "",
				wordCount: page.wordCount,
				estimatedReadTime: 0,
				...(page.directResourceKind === undefined ? {} : { directResourceKind: page.directResourceKind }),
			},
		},
		...("finalUrl" in page ? { finalUrl: page.finalUrl } : { finalUrl: "https://example-spa.test/post" }),
		bodyHash: "body-hash",
		evaluationHtml: page.evaluationHtml,
		httpStatus: page.httpStatus,
	};
}

function fakeCrawl(result: CrawlAndFinalizeResult) {
	return jest.fn<ReturnType<CrawlAndFinalizeArticle>, Parameters<CrawlAndFinalizeArticle>>().mockResolvedValue(result);
}

function deferring(crawlAndFinalizeArticle: CrawlAndFinalizeArticle) {
	return deferJavascriptShells({ crawlAndFinalizeArticle });
}

const url = "https://example-spa.test/post";

describe("deferJavascriptShells", () => {
	it("defers a 2xx HTML page with no readable words and an external script to the render crawl", async () => {
		const crawl = deferring(fakeCrawl(fetchedPage({ evaluationHtml: SHELL_HTML, wordCount: 0 })));

		await expect(crawl({ url })).resolves.toEqual(JAVASCRIPT_REQUIRED);
	});

	it("asks the wrapped crawl for the evaluation html so the shell check can read the scripts", async () => {
		const inner = fakeCrawl(fetchedPage({ evaluationHtml: SHELL_HTML, wordCount: 0 }));

		const writeContext = { url, attemptId: SaveAttemptIdSchema.parse("attempt-1") };

		await deferring(inner)({ url, writeContext });

		expect(inner).toHaveBeenCalledWith({ url, writeContext, includeEvaluationHtml: true });
	});

	it.each(["", "module", "text/javascript", "application/javascript", " Text/JavaScript "])(
		'treats an inline script with type="%s" as executable',
		async (type) => {
			const html = `<html><body><div id="app"></div><script type="${type}">boot()</script></body></html>`;
			const crawl = deferring(fakeCrawl(fetchedPage({ evaluationHtml: html, wordCount: 3 })));

			await expect(crawl({ url })).resolves.toEqual(JAVASCRIPT_REQUIRED);
		},
	);

	it("treats an inline script with no type attribute as executable", async () => {
		const html = "<html><body><div id=\"app\"></div><script>boot()</script></body></html>";
		const crawl = deferring(fakeCrawl(fetchedPage({ evaluationHtml: html, wordCount: 3 })));

		await expect(crawl({ url })).resolves.toEqual(JAVASCRIPT_REQUIRED);
	});

	it.each(["application/ld+json", "application/json", "text/template", "text/x-handlebars-template"])(
		'keeps a page whose only script is a data block of type "%s"',
		async (type) => {
			const html = `<html><body><div id="app"></div><script type="${type}">{}</script></body></html>`;
			const result = fetchedPage({ evaluationHtml: html, wordCount: 3 });
			const crawl = deferring(fakeCrawl(result));

			await expect(crawl({ url, includeEvaluationHtml: true })).resolves.toEqual(result);
		},
	);

	it.each(["img", "video", "audio", "iframe"])("keeps a short page whose article carries an <%s> next to an analytics script", async (element) => {
		const html = '<html><head><script src="/analytics.js"></script></head><body><figure><img src="/photo.jpg"><figcaption>Harbour at dawn</figcaption></figure></body></html>';
		const result = fetchedPage({ evaluationHtml: html, wordCount: 3, articleHtml: `<figure><${element} src="/media"></figure><p>Harbour at dawn</p>` });
		const crawl = deferring(fakeCrawl(result));

		await expect(crawl({ url, includeEvaluationHtml: true })).resolves.toEqual(result);
	});

	it("keeps a near-empty page that ships no script at all", async () => {
		const result = fetchedPage({ evaluationHtml: "<html><body><p>Hi</p></body></html>", wordCount: 1 });
		const crawl = deferring(fakeCrawl(result));

		await expect(crawl({ url, includeEvaluationHtml: true })).resolves.toEqual(result);
	});

	it("defers a page just under the word ceiling", async () => {
		const crawl = deferring(fakeCrawl(fetchedPage({ evaluationHtml: SHELL_HTML, wordCount: 24 })));

		await expect(crawl({ url })).resolves.toEqual(JAVASCRIPT_REQUIRED);
	});

	it("keeps a page at the word ceiling", async () => {
		const result = fetchedPage({ evaluationHtml: SHELL_HTML, wordCount: 25 });
		const crawl = deferring(fakeCrawl(result));

		await expect(crawl({ url, includeEvaluationHtml: true })).resolves.toEqual(result);
	});

	it.each<"image" | "plain-text">(["image", "plain-text"])("keeps a %s resource", async (directResourceKind) => {
		const result = fetchedPage({ evaluationHtml: SHELL_HTML, wordCount: 0, directResourceKind });
		const crawl = deferring(fakeCrawl(result));

		await expect(crawl({ url, includeEvaluationHtml: true })).resolves.toEqual(result);
	});

	it("defers a retained 2xx response", async () => {
		const crawl = deferring(fakeCrawl(fetchedPage({ evaluationHtml: SHELL_HTML, wordCount: 0, httpStatus: 203 })));

		await expect(crawl({ url, retainResponseBody: true })).resolves.toEqual(JAVASCRIPT_REQUIRED);
	});

	it.each([199, 300, 403, 500])("keeps a retained HTTP %i response for selection to judge", async (httpStatus) => {
		const result = fetchedPage({ evaluationHtml: SHELL_HTML, wordCount: 0, httpStatus });
		const crawl = deferring(fakeCrawl(result));

		await expect(crawl({ url, retainResponseBody: true })).resolves.toEqual(result);
	});

	it("keeps a retained response that carries no HTTP status", async () => {
		const result = fetchedPage({ evaluationHtml: SHELL_HTML, wordCount: 0 });
		const crawl = deferring(fakeCrawl(result));

		await expect(crawl({ url, retainResponseBody: true })).resolves.toEqual(result);
	});

	it("keeps a body a site rule produced itself, with no HTTP terminal, even when it looks like a shell", async () => {
		const result = fetchedPage({ evaluationHtml: SHELL_HTML, wordCount: 0, finalUrl: undefined });
		const crawl = deferring(fakeCrawl(result));

		await expect(crawl({ url, includeEvaluationHtml: true })).resolves.toEqual(result);
	});

	it("strips the forced fields from a site-rule body when the caller asked for neither", async () => {
		const crawl = deferring(fakeCrawl(fetchedPage({ evaluationHtml: SHELL_HTML, wordCount: 0, finalUrl: undefined })));

		await expect(crawl({ url })).resolves.toEqual({
			status: "fetched",
			article: { html: "<p></p>", metadata: { title: "App", siteName: "example-spa.test", excerpt: "", wordCount: 0, estimatedReadTime: 0 } },
			finalUrl: undefined,
			bodyHash: "body-hash",
		});
	});

	it("defers a shell that a site rule redirected to and the crawl fetched over HTTP", async () => {
		const result = fetchedPage({ evaluationHtml: SHELL_HTML, wordCount: 0, finalUrl: "https://publisher-spa.test/story" });
		const crawl = deferring(fakeCrawl(result));

		await expect(crawl({ url: "https://news-wrapper.test/A123" })).resolves.toEqual(JAVASCRIPT_REQUIRED);
	});

	it("leaves an archive or wrapper fetch untouched, even when it returns a shell", async () => {
		const result = fetchedPage({ evaluationHtml: SHELL_HTML, wordCount: 0 });
		const inner = fakeCrawl(result);
		const params = { url, fetchUrl: "https://archive.example.test/web/2026/https://example-spa.test/post", retainResponseBody: true };

		await expect(deferring(inner)(params)).resolves.toBe(result);
		expect(inner).toHaveBeenCalledWith(params);
	});

	it.each<CrawlAndFinalizeResult>([
		{ status: "failed", reason: "crawl-failed" },
		{ status: "blocked", httpStatus: 403 },
		{ status: "not-found", httpStatus: 404 },
		{ status: "not-modified" },
		{ status: "unsupported", reason: "unsupported content type: application/pdf" },
	])("passes a $status result through unchanged", async (result) => {
		await expect(deferring(fakeCrawl(result))({ url })).resolves.toBe(result);
	});

	it("strips the evaluation html and status it forced when the caller asked for neither", async () => {
		const result = fetchedPage({ evaluationHtml: "<html><body><p>Words</p></body></html>", wordCount: 400 });
		const crawl = deferring(fakeCrawl(result));

		await expect(crawl({ url })).resolves.toEqual({
			status: "fetched",
			article: { html: "<p></p>", metadata: { title: "App", siteName: "example-spa.test", excerpt: "", wordCount: 400, estimatedReadTime: 0 } },
			finalUrl: url,
			bodyHash: "body-hash",
		});
	});

	it("returns the evaluation html when the caller retained the response body", async () => {
		const result = fetchedPage({ evaluationHtml: "<html><body><p>Words</p></body></html>", wordCount: 400, httpStatus: 200 });
		const crawl = deferring(fakeCrawl(result));

		await expect(crawl({ url, retainResponseBody: true })).resolves.toBe(result);
	});
});
