import { createHash } from "node:crypto";
import { noopLogger } from "@packages/hutch-logger";
import type { CrawlArticle, CrawlUnsupportedReason } from "@packages/crawl-article";
import { MAX_HTML_BYTES } from "@packages/crawl-article";
import { markCrawlBlocked, markCrawlFailed, markCrawlUnsupported } from "@packages/domain/article-aggregate";
import {
	ComprehensiveCrawlCommand,
	RecrawlContentExtractedEvent,
	RefreshContentExtractedEvent,
	TierContentExtractedEvent,
} from "@packages/hutch-infra-components";
import { initFinalizeArticle, type FinalizeArticle, type FinalizedArticle } from "@packages/finalize-article";
import type { SQSEvent } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { RenderOutcome, RenderPage } from "../../providers/render-page/render-page.types";
import { initRenderCrawlHandler } from "./render-crawl-handler";

const URL = "https://example-spa.test/post";
const RENDERED_HTML = "<html><head><title>Post</title></head><body><article><p>Rendered body</p></article></body></html>";
const PROXY = { server: "http://proxy.example-egress.test:22225", username: "user", password: "secret" };
const wrapperRefs = [{ id: "wrapper-candidate", tier: "tier-2" as const }];

function createSqsEvent(detail: {
	url: string;
	saveAttemptId?: string;
	candidates?: { id: string; tier: "tier-2" }[];
	userId?: string;
	recrawl?: boolean;
	refresh?: boolean;
	previousBodyHash?: string;
	unsupportedReason?: "javascript-required" | "blocked";
}): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail: { saveAttemptId: "attempt-1", unsupportedReason: "javascript-required", ...detail } }),
			attributes: {
				ApproximateReceiveCount: "1",
				SentTimestamp: "1620000000000",
				SenderId: "TESTID",
				ApproximateFirstReceiveTimestamp: "1620000000001",
			},
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:RenderCrawlCommand",
			awsRegion: "ap-southeast-2",
		}],
	};
}

const oneRequest = { continued: 1, abortedByBudget: 0, abortedByType: 0, continuedByResourceType: { document: 1 } };

const rendered = (overrides: Partial<Extract<RenderOutcome, { kind: "rendered" }>> = {}): RenderOutcome => ({
	kind: "rendered",
	html: RENDERED_HTML,
	finalUrl: URL,
	httpStatus: 200,
	requests: oneRequest,
	...overrides,
});
const blocked = (httpStatus: number): RenderOutcome => ({ kind: "blocked", httpStatus, requests: oneRequest });
const failed = (detail: string, httpStatus?: number): RenderOutcome => ({ kind: "failed", detail, httpStatus, requests: oneRequest });

function renderPageAnswering(direct: RenderOutcome, proxied?: RenderOutcome) {
	return jest.fn<ReturnType<RenderPage>, Parameters<RenderPage>>(async ({ proxy }) => {
		if (proxy === undefined) return direct;
		if (proxied === undefined) throw new Error("the proxied leg was not expected to run");
		return proxied;
	});
}

const finalizedArticle: FinalizedArticle = {
	html: "<p>Rendered body</p>",
	metadata: {
		title: "Post",
		siteName: "example-spa.test",
		excerpt: "Rendered body",
		wordCount: 120,
		estimatedReadTime: 1,
		imageUrl: undefined,
	},
};
const okFinalize: FinalizeArticle = async () => ({ ok: true, article: finalizedArticle });
const unreadableFinalize: FinalizeArticle = async () => ({ ok: false, reason: "empty document" });
const unusedCrawl: CrawlArticle = async () => {
	throw new Error("the render path must not run the HTTP crawler");
};

const refusedProxiedCrawl: CrawlArticle = async () => ({ status: "blocked", httpStatus: 403 });
const proxiedCrawlUnsupported = (unsupportedReason?: CrawlUnsupportedReason): CrawlArticle => async () => ({
	status: "unsupported",
	reason: "proxied fetch unsupported",
	unsupportedReason,
});
const proxiedCrawlFetching = (httpStatus: number | undefined): CrawlArticle => async () => ({
	status: "fetched",
	html: RENDERED_HTML,
	thumbnailUrl: undefined,
	bodyHash: "proxied-hash",
	httpStatus,
});

const CDN_BASE_URL = "https://images.example-cdn.test";

const hostedImage = { body: Buffer.from("image-bytes"), contentType: "image/jpeg", url: `${CDN_BASE_URL}/photo.jpg`, extension: ".jpg" };

const finalizeOnImageRefusingOrigin = (): FinalizeArticle => initFinalizeArticle({
	parseHtml: () => ({ ok: false, reason: "no article in the document" }),
	downloadMedia: async () => [],
	processContent: async ({ html }) => html,
	fetchThumbnailImage: async ({ candidates }) => ({
		image: candidates.some((candidate) => candidate.startsWith(CDN_BASE_URL)) ? hostedImage : undefined,
		provenUnusable: [],
	}),
	putImageObject: jest.fn().mockResolvedValue(undefined),
	imagesCdnBaseUrl: CDN_BASE_URL,
});

type HandlerDeps = Parameters<typeof initRenderCrawlHandler>[0];

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	return initRenderCrawlHandler({
		resolveOriginalUrl: async (url) => url,
		prepareArticleIdentity: async (url) => ({ status: "resolved", url, originalUrl: url }),
		verifyWrapperSource: async ({ articleUrl, sourceUrl }) => ({ originalUrl: articleUrl, sourceUrl }),
		crawlArticle: unusedCrawl,
		proxiedCrawlArticle: refusedProxiedCrawl,
		finalizeArticle: okFinalize,
		putTierSource: jest.fn().mockResolvedValue(undefined),
		updateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		markCrawlStage: jest.fn().mockResolvedValue(undefined),
		consumeRenderCrawlBudget: jest.fn().mockResolvedValue({ allowed: true, consumed: true }),
		adoptCanonicalIdentity: jest.fn().mockResolvedValue(undefined),
		publishEvent: jest.fn().mockResolvedValue(undefined),
		renderPage: renderPageAnswering(rendered()),
		renderProxy: PROXY,
		now: () => new Date("2026-10-28T12:00:00.000Z"),
		logger: noopLogger,
		logParseError: jest.fn(),
		logCrawlOutcome: jest.fn(),
		readTierSnapshot: jest.fn().mockResolvedValue({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
		...overrides,
	});
}

async function run(handler: ReturnType<typeof createHandler>, detail: Parameters<typeof createSqsEvent>[0]) {
	return handler(createSqsEvent(detail), buildLambdaContext(), () => {});
}

describe("initRenderCrawlHandler", () => {
	describe("a page rendered on the first leg", () => {
		it("stores the rendered page as this save's tier-1 live candidate tagged with the direct leg, and hands it to selection", async () => {
			const renderPage = renderPageAnswering(rendered());
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ renderPage, putTierSource, publishEvent });

			const response = await run(handler, { url: URL, userId: "user-1" });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(renderPage).toHaveBeenCalledWith({ url: URL, navigationTimeoutMilliseconds: 30_000 });
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				url: URL,
				tier: "tier-1",
				html: finalizedArticle.html,
				metadata: expect.objectContaining({ kind: "live", httpStatus: 200, renderedThrough: "direct-egress", attemptId: "attempt-1" }),
			}));
			expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({
				url: URL,
				userId: "user-1",
				saveAttemptId: "attempt-1",
				candidates: [{ id: expect.any(String), tier: "tier-1" }],
			}));
		});

		it("finalizes the rendered DOM against the browser's final URL and lets finalize resolve the thumbnail from it", async () => {
			const finalizeArticle = jest.fn(okFinalize);
			const handler = createHandler({
				finalizeArticle,
				renderPage: renderPageAnswering(rendered({ finalUrl: "https://example-spa.test/posts/1" })),
			});

			await run(handler, { url: URL });

			expect(finalizeArticle).toHaveBeenCalledWith({
				writeContext: { url: URL, attemptId: "attempt-1" },
				url: URL,
				documentUrl: "https://example-spa.test/posts/1",
				html: RENDERED_HTML,
				resolvedThumbnail: undefined,
				mediaType: undefined,
			});
		});

		it("records the rendered body's hash as the fetch freshness", async () => {
			const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ updateFetchTimestamp });

			await run(handler, { url: URL });

			expect(updateFetchTimestamp).toHaveBeenCalledWith({
				url: URL,
				contentFetchedAt: "2026-10-28T12:00:00.000Z",
				etag: undefined,
				lastModified: undefined,
				bodyHash: createHash("sha256").update(RENDERED_HTML).digest("hex"),
			});
		});

		it("renders the article's resolved original rather than the stored row URL", async () => {
			const renderPage = renderPageAnswering(rendered());
			const handler = createHandler({
				renderPage,
				prepareArticleIdentity: async (url) => ({ status: "resolved", url, originalUrl: "https://example-spa.test/original" }),
			});

			await run(handler, { url: URL });

			expect(renderPage).toHaveBeenCalledWith({ url: "https://example-spa.test/original", navigationTimeoutMilliseconds: 30_000 });
		});

		it.each([
			{ flag: { recrawl: true }, event: RecrawlContentExtractedEvent },
			{ flag: { refresh: true }, event: RefreshContentExtractedEvent },
		])("emits $event.detailType for a $flag render", async ({ flag, event }) => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ publishEvent });

			await run(handler, { url: URL, ...flag });

			expect(publishEvent).toHaveBeenCalledTimes(1);
			expect(publishEvent).toHaveBeenCalledWith(event, expect.objectContaining({ url: URL }));
		});
	});

	it.each([
		{ direct: blocked(403), label: "bot-blocked" },
		{ direct: failed("net::ERR_TIMED_OUT"), label: "failed" },
	])("renders through the residential proxy when the direct leg is $label, and tags the candidate with the proxied leg", async ({ direct }) => {
		const renderPage = renderPageAnswering(direct, rendered());
		const putTierSource = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({ renderPage, putTierSource });

		await run(handler, { url: URL });

		expect(renderPage).toHaveBeenNthCalledWith(2, { url: URL, proxy: PROXY, navigationTimeoutMilliseconds: 90_000 });
		expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
			metadata: expect.objectContaining({ renderedThrough: "residential-proxy" }),
		}));
	});

	describe("a rendered page finalize cannot read", () => {
		it("fails the save as a parse error that says the page was rendered, without retrying the message", async () => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const logParseError = jest.fn();
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				finalizeArticle: unreadableFinalize,
				renderPage: renderPageAnswering(blocked(403), rendered()),
				transitionAndPersist,
				logParseError,
				putTierSource,
			});

			const response = await run(handler, { url: URL });

			expect(response).toEqual({ batchItemFailures: [] });
			const detail = "no readable article after render (residential-proxy): empty document";
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, { url: URL, input: { reason: { kind: "parse-error", detail } } });
			expect(logParseError).toHaveBeenCalledWith({ url: URL, reason: detail });
			expect(putTierSource).not.toHaveBeenCalled();
		});

		it("still offers it beside the reader's wrapper candidates for comparison", async () => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ finalizeArticle: unreadableFinalize, publishEvent, transitionAndPersist });

			await run(handler, { url: URL, candidates: wrapperRefs });

			expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({
				candidates: [...wrapperRefs, { id: expect.any(String), tier: "tier-1" }],
			}));
			expect(transitionAndPersist).not.toHaveBeenCalled();
		});
	});

	describe("a page neither leg rendered", () => {
		it.each([
			{ direct: blocked(403), proxied: blocked(403), cause: "edge-block" },
			{ direct: blocked(403), proxied: blocked(429), cause: "rate-limited" },
			{ direct: failed("net::ERR_CONNECTION_RESET"), proxied: blocked(429), cause: "rate-limited" },
			{ direct: blocked(403), proxied: failed("net::ERR_PROXY_CONNECTION_FAILED"), cause: "edge-block" },
		])("settles the row as blocked ($cause) when a leg was refused", async ({ direct, proxied, cause }) => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const logCrawlOutcome = jest.fn();
			const handler = createHandler({ renderPage: renderPageAnswering(direct, proxied), transitionAndPersist, logCrawlOutcome });

			const response = await run(handler, { url: URL });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, { url: URL, input: { reason: { kind: "blocked", cause } } });
			expect(logCrawlOutcome).toHaveBeenCalledWith(expect.objectContaining({ thisTier: "tier-1", thisTierStatus: "failed" }));
		});

		it("fails the fetch with both legs' details when neither leg could load the page", async () => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const logParseError = jest.fn();
			const logCrawlOutcome = jest.fn();
			const handler = createHandler({
				renderPage: renderPageAnswering(failed("main document answered HTTP 500", 500), failed("net::ERR_PROXY_CONNECTION_FAILED")),
				transitionAndPersist,
				logParseError,
				logCrawlOutcome,
			});

			const response = await run(handler, { url: URL });

			expect(response).toEqual({ batchItemFailures: [] });
			const detail = "render-failed: direct-egress: main document answered HTTP 500; residential-proxy: net::ERR_PROXY_CONNECTION_FAILED";
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, {
				url: URL,
				input: { reason: { kind: "fetch-failed", detail, httpStatus: 500 } },
			});
			expect(JSON.stringify(transitionAndPersist.mock.calls[0][1].input.reason)).toBe(JSON.stringify({ kind: "fetch-failed", detail, httpStatus: 500 }));
			expect(logParseError).toHaveBeenCalledWith({ url: URL, reason: detail });
			expect(logCrawlOutcome).toHaveBeenCalledWith(expect.objectContaining({ thisTier: "tier-1", thisTierStatus: "failed" }));
		});

		it.each([
			{ direct: failed("main document answered HTTP 500", 500), proxied: failed("main document answered HTTP 404", 404), stored: '{"kind":"fetch-failed","detail":"render-failed: direct-egress: main document answered HTTP 500; residential-proxy: main document answered HTTP 404","httpStatus":404}' },
			{ direct: failed("net::ERR_TIMED_OUT"), proxied: failed("net::ERR_PROXY_CONNECTION_FAILED"), stored: '{"kind":"fetch-failed","detail":"render-failed: direct-egress: net::ERR_TIMED_OUT; residential-proxy: net::ERR_PROXY_CONNECTION_FAILED"}' },
		])("stores the proxied leg's status ahead of the direct leg's, and none when neither leg answered ($stored)", async ({ direct, proxied, stored }) => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ renderPage: renderPageAnswering(direct, proxied), transitionAndPersist });

			await run(handler, { url: URL });

			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, expect.anything());
			expect(JSON.stringify(transitionAndPersist.mock.calls[0][1].input.reason)).toBe(stored);
		});

		it.each([false, true])("hands the reader's wrapper candidates to selection with no live body (recrawl=%s)", async (recrawl) => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				renderPage: renderPageAnswering(blocked(403), blocked(403)),
				publishEvent,
				transitionAndPersist,
			});

			const response = await run(handler, { url: URL, candidates: wrapperRefs, recrawl });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(publishEvent).toHaveBeenCalledWith(recrawl ? RecrawlContentExtractedEvent : TierContentExtractedEvent, expect.objectContaining({
				candidates: wrapperRefs,
				liveAttempt: { outcome: "no-body" },
			}));
			expect(transitionAndPersist).not.toHaveBeenCalled();
		});
	});

	describe("a rendered page larger than the parse cap", () => {
		const oversized = "a".repeat(MAX_HTML_BYTES.bytes + 1);

		it("settles the row as content too large without parsing it or retrying the message", async () => {
			const finalizeArticle = jest.fn(okFinalize);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const logParseError = jest.fn();
			const handler = createHandler({
				finalizeArticle,
				transitionAndPersist,
				logParseError,
				renderPage: renderPageAnswering(rendered({ html: oversized })),
			});

			const response = await run(handler, { url: URL });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(finalizeArticle).not.toHaveBeenCalled();
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlUnsupported, {
				url: URL,
				input: { reason: { kind: "content-too-large", bytes: MAX_HTML_BYTES.bytes + 1 } },
			});
			expect(logParseError).toHaveBeenCalledWith({
				url: URL,
				reason: `crawl-unsupported: content body too large after render (direct-egress): ${MAX_HTML_BYTES.bytes + 1} bytes (cap ${MAX_HTML_BYTES.bytes} bytes)`,
			});
		});

		it("hands the reader's wrapper candidates to selection with no live body", async () => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ publishEvent, transitionAndPersist, renderPage: renderPageAnswering(rendered({ html: oversized })) });

			await run(handler, { url: URL, candidates: wrapperRefs });

			expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({
				candidates: wrapperRefs,
				liveAttempt: { outcome: "no-body" },
			}));
			expect(transitionAndPersist).not.toHaveBeenCalled();
		});
	});

	describe("a refreshed article whose render is refused", () => {
		const backoff = { url: URL, contentFetchedAt: "2026-10-28T12:00:00.000Z", bodyHash: "previous-hash" };

		const refusals: { label: string; overrides: Partial<HandlerDeps> }[] = [
			{ label: "blocked on both legs", overrides: { renderPage: renderPageAnswering(blocked(403), blocked(403)) } },
			{ label: "failed on both legs", overrides: { renderPage: renderPageAnswering(failed("net::ERR_TIMED_OUT"), failed("net::ERR_PROXY_CONNECTION_FAILED")) } },
			{ label: "rendered but unreadable", overrides: { finalizeArticle: unreadableFinalize } },
			{ label: "rendered past the parse cap", overrides: { renderPage: renderPageAnswering(rendered({ html: "a".repeat(MAX_HTML_BYTES.bytes + 1) })) } },
			{ label: "denied by the budget", overrides: { renderPage: renderPageAnswering(blocked(403)), consumeRenderCrawlBudget: async () => ({ allowed: false }) } },
		];

		it.each(refusals)("backs off instead of re-rendering on the next view when $label", async ({ overrides }) => {
			const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ ...overrides, updateFetchTimestamp });

			const response = await run(handler, { url: URL, refresh: true, previousBodyHash: "previous-hash" });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(updateFetchTimestamp).toHaveBeenCalledTimes(1);
			expect(updateFetchTimestamp).toHaveBeenCalledWith(backoff);
		});

		it.each([
			{ label: "a first save", detail: { url: URL } },
			{ label: "a recrawl", detail: { url: URL, recrawl: true } },
		])("leaves the freshness clock alone on $label that cannot render", async ({ detail }) => {
			const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ renderPage: renderPageAnswering(blocked(403), blocked(403)), updateFetchTimestamp });

			await run(handler, detail);

			expect(updateFetchTimestamp).not.toHaveBeenCalled();
		});
	});

	describe("the proxied fetch after a direct block", () => {
		it("commits a readable proxied body with no render budget and no proxied render", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const renderPage = renderPageAnswering(blocked(403));
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const info = jest.fn();
			const handler = createHandler({
				consumeRenderCrawlBudget,
				renderPage,
				putTierSource,
				proxiedCrawlArticle: proxiedCrawlFetching(200),
				logger: { ...noopLogger, info },
			});

			const response = await run(handler, { url: URL });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				metadata: expect.objectContaining({ renderedThrough: "residential-proxy", httpStatus: 200 }),
			}));
			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] fetched", { url: URL, fetchedThrough: "residential-proxy", httpStatus: 200 });
		});

		it("commits a proxied image with the bytes it hosted and no proxied render", async () => {
			const imageUrl = "https://example-spa.test/photo.jpg";
			const originFigure = `<figure><img src="${imageUrl}"></figure>`;
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const renderPage = renderPageAnswering(blocked(403));
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				consumeRenderCrawlBudget,
				renderPage,
				putTierSource,
				finalizeArticle: finalizeOnImageRefusingOrigin(),
				proxiedCrawlArticle: async () => ({
					status: "fetched",
					html: originFigure,
					evaluationHtml: originFigure,
					thumbnailUrl: undefined,
					thumbnail: { image: { ...hostedImage, url: imageUrl }, provenUnusable: [] },
					mediaType: "image",
					bodyHash: "proxied-hash",
					finalUrl: imageUrl,
					httpStatus: 200,
				}),
			});

			const response = await run(handler, { url: imageUrl, unsupportedReason: "blocked" });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				html: expect.stringContaining(`<img src="${CDN_BASE_URL}/`),
				metadata: expect.objectContaining({ directResourceKind: "image", renderedThrough: "residential-proxy" }),
			}));
		});

		it("commits a proxied text body through the plain-text finalize and no proxied render", async () => {
			const textUrl = "https://example-spa.test/notes.txt";
			const plainText = "Plain notes served as text";
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const renderPage = renderPageAnswering(blocked(403));
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				consumeRenderCrawlBudget,
				renderPage,
				putTierSource,
				finalizeArticle: finalizeOnImageRefusingOrigin(),
				proxiedCrawlArticle: async () => ({
					status: "fetched",
					html: "",
					evaluationHtml: plainText,
					thumbnailUrl: undefined,
					mediaType: "plain-text",
					plainText,
					bodyHash: "proxied-hash",
					finalUrl: textUrl,
					httpStatus: 200,
				}),
			});

			const response = await run(handler, { url: textUrl, unsupportedReason: "blocked" });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				html: `<pre><code>${plainText}</code></pre>`,
				metadata: expect.objectContaining({ directResourceKind: "plain-text", renderedThrough: "residential-proxy" }),
			}));
		});

		it.each([
			{ label: "answered 404 through the retained body", overrides: { proxiedCrawlArticle: proxiedCrawlFetching(404) } },
			{ label: "carried no status", overrides: { proxiedCrawlArticle: proxiedCrawlFetching(undefined) } },
			{ label: "could not be parsed", overrides: { proxiedCrawlArticle: proxiedCrawlFetching(200), finalizeArticle: unreadableFinalize } },
			{ label: "was refused", overrides: { proxiedCrawlArticle: refusedProxiedCrawl } },
		])("reaches the proxied render when the proxied fetch $label", async ({ overrides }) => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const renderPage = renderPageAnswering(blocked(403), rendered());
			const handler = createHandler({ consumeRenderCrawlBudget, renderPage, ...overrides });

			await run(handler, { url: URL });

			expect(consumeRenderCrawlBudget).toHaveBeenCalledTimes(1);
			expect(renderPage).toHaveBeenCalledTimes(2);
		});

		const deferrableReasons: { label: string; reason: CrawlUnsupportedReason | undefined }[] = [
			{ label: "non-html content", reason: { kind: "non-html-content", contentType: "application/pdf" } },
			{ label: "a paywall", reason: { kind: "paywall" } },
			{ label: "no stated reason", reason: undefined },
		];
		it.each(deferrableReasons)("hands $label to the comprehensive crawl with no render budget and no proxied render", async ({ reason }) => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const markCrawlStage = jest.fn().mockResolvedValue(undefined);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const renderPage = renderPageAnswering(blocked(403));
			const handler = createHandler({
				consumeRenderCrawlBudget,
				publishEvent,
				markCrawlStage,
				transitionAndPersist,
				renderPage,
				proxiedCrawlArticle: proxiedCrawlUnsupported(reason),
			});

			const response = await run(handler, { url: URL, userId: "user-1", recrawl: true, previousBodyHash: "previous-hash", candidates: wrapperRefs });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(publishEvent).toHaveBeenCalledTimes(1);
			expect(publishEvent).toHaveBeenCalledWith(ComprehensiveCrawlCommand, expect.objectContaining({
				url: URL,
				userId: "user-1",
				recrawl: true,
				previousBodyHash: "previous-hash",
				candidates: wrapperRefs,
			}));
			expect(markCrawlStage).toHaveBeenCalledWith({ url: URL, stage: "comprehensive-fetching" });
			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(transitionAndPersist).not.toHaveBeenCalled();
		});

		it("reaches the proxied render when the proxied fetch finds a javascript shell", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const renderPage = renderPageAnswering(blocked(403), rendered());
			const handler = createHandler({
				consumeRenderCrawlBudget,
				publishEvent,
				renderPage,
				proxiedCrawlArticle: proxiedCrawlUnsupported({ kind: "javascript-required" }),
			});

			await run(handler, { url: URL });

			expect(publishEvent).not.toHaveBeenCalledWith(ComprehensiveCrawlCommand, expect.anything());
			expect(consumeRenderCrawlBudget).toHaveBeenCalledTimes(1);
			expect(renderPage).toHaveBeenCalledTimes(2);
		});

		it("settles an oversized proxied body as unsupported with no render budget and no proxied render", async () => {
			const reason: CrawlUnsupportedReason = { kind: "content-too-large", bytes: 100_000_000 };
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const renderPage = renderPageAnswering(blocked(403));
			const handler = createHandler({
				consumeRenderCrawlBudget,
				publishEvent,
				transitionAndPersist,
				renderPage,
				proxiedCrawlArticle: proxiedCrawlUnsupported(reason),
			});

			await run(handler, { url: URL });

			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlUnsupported, { url: URL, input: { reason } });
			expect(publishEvent).not.toHaveBeenCalledWith(ComprehensiveCrawlCommand, expect.anything());
			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
			expect(renderPage).toHaveBeenCalledTimes(1);
		});

		it("offers the reader's wrapper candidates to selection when the proxied body is oversized", async () => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				publishEvent,
				transitionAndPersist,
				renderPage: renderPageAnswering(blocked(403)),
				proxiedCrawlArticle: proxiedCrawlUnsupported({ kind: "content-too-large", bytes: 100_000_000 }),
			});

			await run(handler, { url: URL, candidates: wrapperRefs });

			expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({ url: URL, candidates: wrapperRefs }));
			expect(transitionAndPersist).not.toHaveBeenCalled();
		});

		it("backs off a refresh whose proxied body is oversized", async () => {
			const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				updateFetchTimestamp,
				renderPage: renderPageAnswering(blocked(403)),
				proxiedCrawlArticle: proxiedCrawlUnsupported({ kind: "content-too-large", bytes: 100_000_000 }),
			});

			await run(handler, { url: URL, refresh: true, previousBodyHash: "previous-hash" });

			expect(updateFetchTimestamp).toHaveBeenCalledWith(expect.objectContaining({ url: URL, bodyHash: "previous-hash" }));
		});

		it("reaches the proxied render when a readable proxied body cannot be committed", async () => {
			const renderPage = renderPageAnswering(blocked(403), rendered());
			const finalizeArticle = jest.fn<ReturnType<FinalizeArticle>, Parameters<FinalizeArticle>>()
				.mockResolvedValueOnce({ ok: true, article: finalizedArticle })
				.mockResolvedValueOnce({ ok: false, reason: "empty document" })
				.mockResolvedValue({ ok: true, article: finalizedArticle });
			const handler = createHandler({ renderPage, finalizeArticle, proxiedCrawlArticle: proxiedCrawlFetching(200) });

			await run(handler, { url: URL });

			expect(renderPage).toHaveBeenCalledTimes(2);
		});

		it("runs it after a failed direct render on a blocked deferral, with no render budget", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const renderPage = renderPageAnswering(failed("direct timeout"));
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ consumeRenderCrawlBudget, renderPage, putTierSource, proxiedCrawlArticle: proxiedCrawlFetching(200) });

			await run(handler, { url: URL, unsupportedReason: "blocked" });

			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(putTierSource).toHaveBeenCalledTimes(1);
		});

		it("leaves it out after a failed direct render on a javascript-required deferral", async () => {
			const proxiedCrawlArticle = jest.fn(refusedProxiedCrawl);
			const handler = createHandler({ proxiedCrawlArticle, renderPage: renderPageAnswering(failed("direct timeout"), rendered()) });

			await run(handler, { url: URL, unsupportedReason: "javascript-required" });

			expect(proxiedCrawlArticle).not.toHaveBeenCalled();
		});

		it("runs it after an unreadable direct render on a blocked deferral, with no render budget", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const renderPage = renderPageAnswering(rendered());
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const finalizeArticle = jest.fn<ReturnType<FinalizeArticle>, Parameters<FinalizeArticle>>()
				.mockResolvedValueOnce({ ok: false, reason: "empty document" })
				.mockResolvedValue({ ok: true, article: finalizedArticle });
			const handler = createHandler({ consumeRenderCrawlBudget, renderPage, putTierSource, transitionAndPersist, finalizeArticle, proxiedCrawlArticle: proxiedCrawlFetching(200) });

			await run(handler, { url: URL, unsupportedReason: "blocked" });

			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
			expect(transitionAndPersist).not.toHaveBeenCalled();
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				metadata: expect.objectContaining({ renderedThrough: "residential-proxy" }),
			}));
		});

		it("names the unreadable direct render when no leg brings a body on a blocked deferral", async () => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ transitionAndPersist, finalizeArticle: unreadableFinalize, renderPage: renderPageAnswering(rendered(), failed("proxied timeout")) });

			await run(handler, { url: URL, unsupportedReason: "blocked" });

			const detail = "render-failed: direct-egress: no readable article after render (direct-egress): empty document; residential-proxy: proxied timeout";
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, {
				url: URL,
				input: { reason: { kind: "fetch-failed", detail, httpStatus: 200 } },
			});
		});

		it("ends an unreadable direct render on a javascript-required deferral without the proxy", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const proxiedCrawlArticle = jest.fn(refusedProxiedCrawl);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ consumeRenderCrawlBudget, proxiedCrawlArticle, transitionAndPersist, finalizeArticle: unreadableFinalize });

			await run(handler, { url: URL, unsupportedReason: "javascript-required" });

			expect(proxiedCrawlArticle).not.toHaveBeenCalled();
			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, {
				url: URL,
				input: { reason: { kind: "parse-error", detail: "no readable article after render (direct-egress): empty document" } },
			});
		});

		it("names the proxied fetch outcome on the not-rendered log line", async () => {
			const info = jest.fn();
			const handler = createHandler({ renderPage: renderPageAnswering(blocked(403), failed("proxied timeout")), logger: { ...noopLogger, info } });

			await run(handler, { url: URL });

			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] not rendered on either leg", {
				url: URL,
				direct: blocked(403),
				proxied: failed("proxied timeout"),
				proxiedFetch: { kind: "no-body", outcome: "blocked" },
			});
		});
	});

	describe("the render budget", () => {
		it("spends no slot on a direct render", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const handler = createHandler({ consumeRenderCrawlBudget });

			await run(handler, { url: URL });

			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
		});

		it("carries the request tally on the rendered log line", async () => {
			const info = jest.fn();
			const handler = createHandler({ logger: { ...noopLogger, info } });

			await run(handler, { url: URL });

			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] rendered", { url: URL, renderedThrough: "direct-egress", httpStatus: 200, requests: oneRequest });
		});

		it("claims one slot per message and runs no proxied render once the window is spent", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: false });
			const renderPage = renderPageAnswering(blocked(403));
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ consumeRenderCrawlBudget, renderPage, transitionAndPersist });

			const response = await run(handler, { url: URL });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(consumeRenderCrawlBudget).toHaveBeenCalledWith({ messageId: "msg-1" });
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, { url: URL, input: { reason: { kind: "blocked", cause: "spend-capped" } } });
		});

		it("leaves a refreshed article's served content alone once the window is spent", async () => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ renderPage: renderPageAnswering(blocked(403)), consumeRenderCrawlBudget: async () => ({ allowed: false }), transitionAndPersist });

			await run(handler, { url: URL, refresh: true });

			expect(transitionAndPersist).not.toHaveBeenCalled();
		});

		it("hands the reader's wrapper candidates to selection once the window is spent", async () => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ renderPage: renderPageAnswering(blocked(403)), consumeRenderCrawlBudget: async () => ({ allowed: false }), publishEvent });

			await run(handler, { url: URL, candidates: wrapperRefs });

			expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({
				candidates: wrapperRefs,
				liveAttempt: { outcome: "no-body" },
			}));
		});
	});

	describe("a source-bound article", () => {
		const captureUrl = `https://web.archive.org/web/20081203/${URL}`;
		const sourceBound: HandlerDeps["prepareArticleIdentity"] = async () => ({
			status: "resolved",
			url: URL,
			originalUrl: URL,
			contentSourceUrl: captureUrl,
			sourceOriginalUrl: URL,
		});

		it.each([
			{ captured: true, candidates: [{ id: expect.any(String), tier: "tier-2" }, { id: expect.any(String), tier: "tier-1" }] },
			{ captured: false, candidates: [{ id: expect.any(String), tier: "tier-1" }] },
		])("crawls its capture before rendering and offers both for comparison (capture crawled: $captured)", async ({ captured, candidates }) => {
			const crawled: string[] = [];
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				prepareArticleIdentity: sourceBound,
				crawlArticle: async ({ url }) => {
					crawled.push(url);
					return captured ? { status: "fetched", html: "<html><body><p>archived</p></body></html>", bodyHash: "hash" } : { status: "failed" };
				},
				publishEvent,
			});

			await run(handler, { url: URL });

			expect(crawled).toEqual([captureUrl]);
			expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({ candidates }));
		});

		it("does not re-crawl the capture on a refresh", async () => {
			const crawlArticle = jest.fn(unusedCrawl);
			const handler = createHandler({ prepareArticleIdentity: sourceBound, crawlArticle });

			const response = await run(handler, { url: URL, refresh: true });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(crawlArticle).not.toHaveBeenCalled();
		});
	});

	it.each([
		{ label: "an article whose original is unresolved", overrides: { prepareArticleIdentity: async () => ({ status: "unresolved" as const }) }, detail: { url: URL } },
		{ label: "a command that fails its schema", overrides: {}, detail: { url: URL, recrawl: true, refresh: true } },
	])("reports $label as a failed record", async ({ overrides, detail }) => {
		const handler = createHandler(overrides);

		const response = await run(handler, detail);

		expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
