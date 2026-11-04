import { createHash } from "node:crypto";
import { noopLogger } from "@packages/hutch-logger";
import type { CrawlArticle, CrawlUnsupportedReason } from "@packages/crawl-article";
import { MAX_HTML_BYTES } from "@packages/crawl-article";
import { markCrawlBlocked, markCrawlExhausted, markCrawlFailed, markCrawlUnsupported } from "@packages/domain/article-aggregate";
import {
	ComprehensiveCrawlCommand,
	RecrawlContentExtractedEvent,
	RefreshContentExtractedEvent,
	TierContentExtractedEvent,
} from "@packages/hutch-infra-components";
import { initFinalizeArticle, type FinalizeArticle, type FinalizedArticle } from "@packages/finalize-article";
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
import type { SQSEvent } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { RenderOutcome, RenderPage, ResidentialEgress, WebUnlockerEgress } from "../../providers/render-page/render-page.types";
import { initRenderCrawlHandler } from "./render-crawl-handler";

const URL = "https://example-spa.test/post";
const RENDERED_HTML = "<html><head><title>Post</title></head><body><article><p>Rendered body</p></article></body></html>";
const RESIDENTIAL_PASSWORD = "residential-secret-7f3a";
const RESIDENTIAL_EGRESS: ResidentialEgress = {
	kind: "residential",
	proxy: { server: "http://residential.example-egress.test:33335", username: "residential-user-session-1", password: RESIDENTIAL_PASSWORD },
};
const WEB_UNLOCKER_EGRESS: WebUnlockerEgress = {
	kind: "web-unlocker",
	proxy: { server: "http://unlocker.example-egress.test:33335", username: "unlocker-user", password: "unlocker-secret" },
};
const AMPLE_MILLISECONDS = 900_000;
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
	finalUrl?: string;
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

function renderPageAnswering(answers: { direct: RenderOutcome; residential?: RenderOutcome; webUnlocker?: RenderOutcome }) {
	return jest.fn<ReturnType<RenderPage>, Parameters<RenderPage>>(async ({ egress }) => {
		const answer = egress.kind === "direct" ? answers.direct : egress.kind === "residential" ? answers.residential : answers.webUnlocker;
		if (answer === undefined) throw new Error(`the ${egress.kind} leg was not expected to run`);
		return answer;
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
		findAdoptedFetchUrl: async () => undefined,
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
		renderPage: renderPageAnswering({ direct: rendered() }),
		residentialEgress: () => RESIDENTIAL_EGRESS,
		webUnlockerEgress: WEB_UNLOCKER_EGRESS,
		now: () => new Date("2026-10-28T12:00:00.000Z"),
		logger: noopLogger,
		logParseError: jest.fn(),
		logCrawlOutcome: jest.fn(),
		readTierSnapshot: jest.fn().mockResolvedValue({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
		...overrides,
	});
}

async function run(handler: ReturnType<typeof createHandler>, detail: Parameters<typeof createSqsEvent>[0], remainingMilliseconds = AMPLE_MILLISECONDS) {
	return handler(createSqsEvent(detail), { ...buildLambdaContext(), getRemainingTimeInMillis: () => remainingMilliseconds }, () => {});
}

describe("initRenderCrawlHandler", () => {
	describe("a page rendered on the first leg", () => {
		it("stores the rendered page as this save's tier-1 live candidate tagged with the direct leg, and hands it to selection", async () => {
			const renderPage = renderPageAnswering({ direct: rendered() });
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ renderPage, putTierSource, publishEvent });

			const response = await run(handler, { url: URL, userId: "user-1" });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(renderPage).toHaveBeenCalledWith({ url: URL, egress: { kind: "direct" }, navigationTimeoutMilliseconds: 30_000 });
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

		it("commits a readable direct render on a blocked deferral without spending the render budget", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ consumeRenderCrawlBudget, putTierSource });

			await run(handler, { url: URL, unsupportedReason: "blocked" });

			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				metadata: expect.objectContaining({ renderedThrough: "direct-egress" }),
			}));
		});

		it("finalizes the rendered DOM against the browser's final URL and lets finalize resolve the thumbnail from it", async () => {
			const finalizeArticle = jest.fn(okFinalize);
			const handler = createHandler({
				finalizeArticle,
				renderPage: renderPageAnswering({ direct: rendered({ finalUrl: "https://example-spa.test/posts/1" }) }),
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
			const renderPage = renderPageAnswering({ direct: rendered() });
			const handler = createHandler({
				renderPage,
				prepareArticleIdentity: async (url) => ({ status: "resolved", url, originalUrl: "https://example-spa.test/original" }),
			});

			await run(handler, { url: URL });

			expect(renderPage).toHaveBeenCalledWith({ url: "https://example-spa.test/original", egress: { kind: "direct" }, navigationTimeoutMilliseconds: 30_000 });
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

	describe("the residential per-GB render", () => {
		it("renders through a fresh residential egress when the direct leg failed, and tags the candidate with that leg", async () => {
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: rendered() });
			const residentialEgress = jest.fn(() => RESIDENTIAL_EGRESS);
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const info = jest.fn();
			const handler = createHandler({ renderPage, residentialEgress, consumeRenderCrawlBudget, putTierSource, logger: { ...noopLogger, info } });

			const response = await run(handler, { url: URL });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(consumeRenderCrawlBudget).toHaveBeenCalledTimes(1);
			expect(residentialEgress).toHaveBeenCalledTimes(1);
			expect(renderPage).toHaveBeenCalledTimes(2);
			expect(renderPage).toHaveBeenNthCalledWith(2, { url: URL, egress: RESIDENTIAL_EGRESS, navigationTimeoutMilliseconds: 30_000 });
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				metadata: expect.objectContaining({ renderedThrough: "residential-per-gb" }),
			}));
			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] rendered", { url: URL, renderedThrough: "residential-per-gb", httpStatus: 200, requests: oneRequest });
			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] ladder settled", { url: URL, settledThrough: "residential-per-gb", residentialSkipped: false });
		});

		it("carries an unreadable residential render with candidates on to the Web Unlocker render without publishing it first", async () => {
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: rendered(), webUnlocker: rendered() });
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const proxiedCrawlArticle = jest.fn(refusedProxiedCrawl);
			const finalizeArticle = jest.fn<ReturnType<FinalizeArticle>, Parameters<FinalizeArticle>>()
				.mockResolvedValueOnce({ ok: false, reason: "empty document" })
				.mockResolvedValue({ ok: true, article: finalizedArticle });
			const handler = createHandler({ renderPage, publishEvent, putTierSource, proxiedCrawlArticle, finalizeArticle });

			await run(handler, { url: URL, candidates: wrapperRefs });

			expect(renderPage).toHaveBeenCalledTimes(3);
			expect(renderPage).toHaveBeenNthCalledWith(3, { url: URL, egress: WEB_UNLOCKER_EGRESS, navigationTimeoutMilliseconds: 90_000 });
			expect(proxiedCrawlArticle).not.toHaveBeenCalled();
			expect(putTierSource).toHaveBeenCalledTimes(1);
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				metadata: expect.objectContaining({ renderedThrough: "web-unlocker-render" }),
			}));
			expect(publishEvent).toHaveBeenCalledTimes(1);
			expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({
				candidates: [...wrapperRefs, { id: expect.any(String), tier: "tier-1" }],
			}));
		});
	});

	describe("a rendered page finalize cannot read", () => {
		it("fails the save as a parse error naming the Web Unlocker render, without retrying the message", async () => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const logParseError = jest.fn();
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: rendered(), webUnlocker: rendered() });
			const handler = createHandler({
				finalizeArticle: unreadableFinalize,
				renderPage,
				transitionAndPersist,
				logParseError,
				putTierSource,
			});

			const response = await run(handler, { url: URL });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(renderPage).toHaveBeenCalledTimes(3);
			const detail = "no readable article after render (web-unlocker-render): empty document";
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

	describe("a page no leg rendered", () => {
		it.each([
			{ direct: failed("net::ERR_CONNECTION_RESET"), residential: blocked(403), webUnlocker: failed("unlocker timeout"), cause: "edge-block" },
			{ direct: failed("net::ERR_CONNECTION_RESET"), residential: blocked(429), webUnlocker: failed("unlocker timeout"), cause: "rate-limited" },
			{ direct: blocked(403), residential: undefined, webUnlocker: failed("unlocker timeout"), cause: "edge-block" },
			{ direct: blocked(429), residential: undefined, webUnlocker: failed("unlocker timeout"), cause: "rate-limited" },
			{ direct: blocked(429), residential: undefined, webUnlocker: blocked(403), cause: "edge-block" },
			{ direct: blocked(403), residential: undefined, webUnlocker: blocked(429), cause: "rate-limited" },
		])("settles the row as blocked ($cause) from the most recent leg that was refused", async ({ direct, residential, webUnlocker, cause }) => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const logCrawlOutcome = jest.fn();
			const handler = createHandler({ renderPage: renderPageAnswering({ direct, residential, webUnlocker }), transitionAndPersist, logCrawlOutcome });

			const response = await run(handler, { url: URL });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, { url: URL, input: { reason: { kind: "blocked", cause } } });
			expect(logCrawlOutcome).toHaveBeenCalledWith(expect.objectContaining({ thisTier: "tier-1", thisTierStatus: "failed" }));
		});

		it("fails the fetch with every leg's detail when no leg could load the page", async () => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const logParseError = jest.fn();
			const logCrawlOutcome = jest.fn();
			const handler = createHandler({
				renderPage: renderPageAnswering({
					direct: failed("main document answered HTTP 500", 500),
					residential: failed("net::ERR_PROXY_CONNECTION_FAILED"),
					webUnlocker: failed("net::ERR_TIMED_OUT"),
				}),
				transitionAndPersist,
				logParseError,
				logCrawlOutcome,
			});

			const response = await run(handler, { url: URL });

			expect(response).toEqual({ batchItemFailures: [] });
			const detail = "render-failed: direct-egress: main document answered HTTP 500; residential-per-gb: net::ERR_PROXY_CONNECTION_FAILED; web-unlocker-fetch: skipped (no-block-evidence); web-unlocker-render: net::ERR_TIMED_OUT";
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, {
				url: URL,
				input: { reason: { kind: "fetch-failed", detail, httpStatus: 500 }, receiveCount: 1 },
			});
			expect(logParseError).toHaveBeenCalledWith({ url: URL, reason: detail });
			expect(logCrawlOutcome).toHaveBeenCalledWith(expect.objectContaining({ thisTier: "tier-1", thisTierStatus: "failed" }));
		});

		it.each([
			{
				residential: failed("main document answered HTTP 404", 404),
				webUnlocker: failed("net::ERR_TIMED_OUT"),
				stored: '{"kind":"fetch-failed","detail":"render-failed: direct-egress: main document answered HTTP 500; residential-per-gb: main document answered HTTP 404; web-unlocker-fetch: skipped (no-block-evidence); web-unlocker-render: net::ERR_TIMED_OUT","httpStatus":404}',
			},
			{
				residential: failed("main document answered HTTP 404", 404),
				webUnlocker: failed("main document answered HTTP 502", 502),
				stored: '{"kind":"fetch-failed","detail":"render-failed: direct-egress: main document answered HTTP 500; residential-per-gb: main document answered HTTP 404; web-unlocker-fetch: skipped (no-block-evidence); web-unlocker-render: main document answered HTTP 502","httpStatus":502}',
			},
		])("stores the most recent leg's status ($stored)", async ({ residential, webUnlocker, stored }) => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ renderPage: renderPageAnswering({ direct: failed("main document answered HTTP 500", 500), residential, webUnlocker }), transitionAndPersist });

			await run(handler, { url: URL });

			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, expect.anything());
			expect(JSON.stringify(transitionAndPersist.mock.calls[0][1].input.reason)).toBe(stored);
		});

		it("carries the record's receive count into the failed crawl", async () => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ renderPage: renderPageAnswering({ direct: failed("direct timeout"), residential: failed("residential timeout"), webUnlocker: failed("unlocker timeout") }), transitionAndPersist });
			const event = createSqsEvent({ url: URL });
			event.Records[0].attributes.ApproximateReceiveCount = "3";

			await handler(event, { ...buildLambdaContext(), getRemainingTimeInMillis: () => AMPLE_MILLISECONDS }, () => {});

			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, expect.objectContaining({ input: expect.objectContaining({ receiveCount: 3 }) }));
		});

		it("stores no status when no leg answered", async () => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: failed("net::ERR_PROXY_CONNECTION_FAILED"), webUnlocker: failed("unlocker timeout") }),
				transitionAndPersist,
			});

			await run(handler, { url: URL });

			expect(JSON.stringify(transitionAndPersist.mock.calls[0][1].input.reason)).toBe(
				'{"kind":"fetch-failed","detail":"render-failed: direct-egress: net::ERR_TIMED_OUT; residential-per-gb: net::ERR_PROXY_CONNECTION_FAILED; web-unlocker-fetch: skipped (no-block-evidence); web-unlocker-render: unlocker timeout"}',
			);
		});

		it.each([false, true])("hands the reader's wrapper candidates to selection with no live body (recrawl=%s)", async (recrawl) => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				renderPage: renderPageAnswering({ direct: blocked(403), residential: blocked(403), webUnlocker: blocked(403) }),
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

		it("names every leg's outcome on the not-rendered log line", async () => {
			const info = jest.fn();
			const warn = jest.fn();
			const handler = createHandler({
				renderPage: renderPageAnswering({ direct: blocked(403), webUnlocker: failed("unlocker timeout") }),
				logger: { ...noopLogger, info, warn },
			});

			await run(handler, { url: URL });

			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] not rendered on any leg", {
				url: URL,
				direct: blocked(403),
				residential: { kind: "skipped", reason: "block-evidence" },
				webUnlockerFetch: { kind: "no-body", outcome: "blocked" },
				webUnlockerRender: failed("unlocker timeout"),
			});
			expect(warn).not.toHaveBeenCalled();
		});
	});

	describe("a ladder that runs out of time", () => {
		it("spends no budget and names every paid leg it skipped when too little time is left for the residential render", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT") });
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const warn = jest.fn();
			const handler = createHandler({ consumeRenderCrawlBudget, renderPage, transitionAndPersist, logger: { ...noopLogger, warn } });

			const response = await run(handler, { url: URL }, 50_000);

			expect(response).toEqual({ batchItemFailures: [] });
			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith("[RenderCrawlCommand] render ladder ran out of time", {
				url: URL,
				skippedLegs: ["residential", "webUnlockerFetch", "webUnlockerRender"],
			});
			const detail = "render-failed: direct-egress: net::ERR_TIMED_OUT; residential-per-gb: skipped (time-exhausted); web-unlocker-fetch: skipped (time-exhausted); web-unlocker-render: skipped (time-exhausted)";
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, { url: URL, input: { reason: { kind: "fetch-failed", detail, httpStatus: undefined }, receiveCount: 1 } });
		});

		it("skips the Web Unlocker fetch but still runs the Web Unlocker render when only the render fits on a blocked deferral", async () => {
			const proxiedCrawlArticle = jest.fn(proxiedCrawlFetching(200));
			const renderPage = renderPageAnswering({ direct: failed("direct timeout"), webUnlocker: failed("unlocker timeout") });
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const warn = jest.fn();
			const handler = createHandler({ proxiedCrawlArticle, renderPage, transitionAndPersist, logger: { ...noopLogger, warn } });

			await run(handler, { url: URL, unsupportedReason: "blocked" }, 200_000);

			expect(proxiedCrawlArticle).not.toHaveBeenCalled();
			expect(renderPage).toHaveBeenCalledTimes(2);
			expect(warn).toHaveBeenCalledWith("[RenderCrawlCommand] render ladder ran out of time", { url: URL, skippedLegs: ["webUnlockerFetch"] });
			const detail = "render-failed: direct-egress: direct timeout; residential-per-gb: skipped (block-evidence); web-unlocker-fetch: skipped (time-exhausted); web-unlocker-render: unlocker timeout";
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, { url: URL, input: { reason: { kind: "fetch-failed", detail, httpStatus: undefined }, receiveCount: 1 } });
		});

		it("skips the Web Unlocker render when only the residential render fits", async () => {
			const renderPage = renderPageAnswering({ direct: failed("direct timeout"), residential: failed("residential timeout") });
			const warn = jest.fn();
			const handler = createHandler({ renderPage, logger: { ...noopLogger, warn } });

			await run(handler, { url: URL }, 100_000);

			expect(renderPage).toHaveBeenCalledTimes(2);
			expect(warn).toHaveBeenCalledWith("[RenderCrawlCommand] render ladder ran out of time", { url: URL, skippedLegs: ["webUnlockerRender"] });
		});
	});

	describe("the residential proxy credentials", () => {
		it.each([
			{ label: "the residential render succeeds", answers: { direct: failed("direct timeout"), residential: rendered() } },
			{ label: "every leg fails", answers: { direct: failed("direct timeout"), residential: failed("residential timeout"), webUnlocker: blocked(403) } },
		])("never reach a logged payload when $label", async ({ answers }) => {
			const logged: unknown[][] = [];
			const record = (...args: unknown[]) => {
				logged.push(args);
			};
			const logParseError = jest.fn();
			const logCrawlOutcome = jest.fn();
			const renderPage = renderPageAnswering(answers);
			const handler = createHandler({
				renderPage,
				logParseError,
				logCrawlOutcome,
				logger: { info: record, warn: record, error: record, debug: record },
			});

			await run(handler, { url: URL });

			expect(renderPage).toHaveBeenNthCalledWith(2, { url: URL, egress: RESIDENTIAL_EGRESS, navigationTimeoutMilliseconds: 30_000 });
			expect(JSON.stringify([logged, logParseError.mock.calls, logCrawlOutcome.mock.calls])).not.toContain(RESIDENTIAL_PASSWORD);
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
				renderPage: renderPageAnswering({ direct: rendered({ html: oversized }) }),
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

		it("names the residential leg when that render is oversized, and stops the ladder there", async () => {
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: rendered({ html: oversized }) });
			const logParseError = jest.fn();
			const handler = createHandler({ renderPage, logParseError });

			await run(handler, { url: URL });

			expect(renderPage).toHaveBeenCalledTimes(2);
			expect(logParseError).toHaveBeenCalledWith({
				url: URL,
				reason: `crawl-unsupported: content body too large after render (residential-per-gb): ${MAX_HTML_BYTES.bytes + 1} bytes (cap ${MAX_HTML_BYTES.bytes} bytes)`,
			});
		});

		it("hands the reader's wrapper candidates to selection with no live body", async () => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ publishEvent, transitionAndPersist, renderPage: renderPageAnswering({ direct: rendered({ html: oversized }) }) });

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
			{ label: "blocked on every leg", overrides: { renderPage: renderPageAnswering({ direct: blocked(403), residential: blocked(403), webUnlocker: blocked(403) }) } },
			{ label: "failed on every leg", overrides: { renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: failed("net::ERR_PROXY_CONNECTION_FAILED"), webUnlocker: failed("unlocker timeout") }) } },
			{ label: "rendered but unreadable", overrides: { finalizeArticle: unreadableFinalize } },
			{ label: "rendered past the parse cap", overrides: { renderPage: renderPageAnswering({ direct: rendered({ html: "a".repeat(MAX_HTML_BYTES.bytes + 1) }) }) } },
			{ label: "denied by the budget", overrides: { renderPage: renderPageAnswering({ direct: blocked(403) }), consumeRenderCrawlBudget: async () => ({ allowed: false }) } },
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
			const handler = createHandler({ renderPage: renderPageAnswering({ direct: blocked(403), residential: blocked(403), webUnlocker: blocked(403) }), updateFetchTimestamp });

			await run(handler, detail);

			expect(updateFetchTimestamp).not.toHaveBeenCalled();
		});
	});

	describe("the Web Unlocker fetch after the residential render", () => {
		it("commits a readable fetched body with no Web Unlocker render", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const renderPage = renderPageAnswering({ direct: failed("direct timeout"), residential: blocked(403) });
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
			expect(consumeRenderCrawlBudget).toHaveBeenCalledTimes(1);
			expect(renderPage).toHaveBeenCalledTimes(2);
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				metadata: expect.objectContaining({ renderedThrough: "web-unlocker-fetch", httpStatus: 200 }),
			}));
			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] fetched", { url: URL, fetchedThrough: "web-unlocker-fetch", httpStatus: 200 });
		});

		it("commits a fetched image with the bytes it hosted and no Web Unlocker render", async () => {
			const imageUrl = "https://example-spa.test/photo.jpg";
			const originFigure = `<figure><img src="${imageUrl}"></figure>`;
			const renderPage = renderPageAnswering({ direct: failed("direct timeout"), residential: blocked(403) });
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
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

			const response = await run(handler, { url: imageUrl });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(renderPage).toHaveBeenCalledTimes(2);
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				html: expect.stringContaining(`<img src="${CDN_BASE_URL}/`),
				metadata: expect.objectContaining({ directResourceKind: "image", renderedThrough: "web-unlocker-fetch" }),
			}));
		});

		it("commits a fetched text body through the plain-text finalize and no Web Unlocker render", async () => {
			const textUrl = "https://example-spa.test/notes.txt";
			const plainText = "Plain notes served as text";
			const renderPage = renderPageAnswering({ direct: failed("direct timeout"), residential: blocked(403) });
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
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

			const response = await run(handler, { url: textUrl });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(renderPage).toHaveBeenCalledTimes(2);
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				html: `<pre><code>${plainText}</code></pre>`,
				metadata: expect.objectContaining({ directResourceKind: "plain-text", renderedThrough: "web-unlocker-fetch" }),
			}));
		});

		it.each([
			{ label: "answered 404 through the retained body", overrides: { proxiedCrawlArticle: proxiedCrawlFetching(404) } },
			{ label: "carried no status", overrides: { proxiedCrawlArticle: proxiedCrawlFetching(undefined) } },
			{ label: "could not be parsed", overrides: { proxiedCrawlArticle: proxiedCrawlFetching(200), finalizeArticle: unreadableFinalize } },
			{ label: "was refused", overrides: { proxiedCrawlArticle: refusedProxiedCrawl } },
			{ label: "found a javascript shell", overrides: { proxiedCrawlArticle: proxiedCrawlUnsupported({ kind: "javascript-required" }) } },
		])("reaches the Web Unlocker render when the fetch $label", async ({ overrides }) => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const renderPage = renderPageAnswering({ direct: failed("direct timeout"), residential: blocked(403), webUnlocker: rendered() });
			const handler = createHandler({ consumeRenderCrawlBudget, publishEvent, renderPage, ...overrides });

			await run(handler, { url: URL });

			expect(publishEvent).not.toHaveBeenCalledWith(ComprehensiveCrawlCommand, expect.anything());
			expect(consumeRenderCrawlBudget).toHaveBeenCalledTimes(1);
			expect(renderPage).toHaveBeenCalledTimes(3);
		});

		const deferrableReasons: { label: string; reason: CrawlUnsupportedReason | undefined }[] = [
			{ label: "non-html content", reason: { kind: "non-html-content", contentType: "application/pdf" } },
			{ label: "a paywall", reason: { kind: "paywall" } },
			{ label: "no stated reason", reason: undefined },
		];
		it.each(deferrableReasons)("hands $label to the comprehensive crawl with no Web Unlocker render", async ({ reason }) => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const markCrawlStage = jest.fn().mockResolvedValue(undefined);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const renderPage = renderPageAnswering({ direct: failed("direct timeout"), residential: blocked(403) });
			const handler = createHandler({
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
			expect(renderPage).toHaveBeenCalledTimes(2);
			expect(transitionAndPersist).not.toHaveBeenCalled();
		});

		it("settles an oversized fetched body as unsupported with no Web Unlocker render", async () => {
			const reason: CrawlUnsupportedReason = { kind: "content-too-large", bytes: 100_000_000 };
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const renderPage = renderPageAnswering({ direct: failed("direct timeout"), residential: blocked(403) });
			const handler = createHandler({
				publishEvent,
				transitionAndPersist,
				renderPage,
				proxiedCrawlArticle: proxiedCrawlUnsupported(reason),
			});

			await run(handler, { url: URL });

			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlUnsupported, { url: URL, input: { reason } });
			expect(publishEvent).not.toHaveBeenCalledWith(ComprehensiveCrawlCommand, expect.anything());
			expect(renderPage).toHaveBeenCalledTimes(2);
		});

		it("offers the reader's wrapper candidates to selection when the fetched body is oversized", async () => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				publishEvent,
				transitionAndPersist,
				renderPage: renderPageAnswering({ direct: failed("direct timeout"), residential: blocked(403) }),
				proxiedCrawlArticle: proxiedCrawlUnsupported({ kind: "content-too-large", bytes: 100_000_000 }),
			});

			await run(handler, { url: URL, candidates: wrapperRefs });

			expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({ url: URL, candidates: wrapperRefs }));
			expect(transitionAndPersist).not.toHaveBeenCalled();
		});

		it("backs off a refresh whose fetched body is oversized", async () => {
			const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				updateFetchTimestamp,
				renderPage: renderPageAnswering({ direct: failed("direct timeout"), residential: blocked(403) }),
				proxiedCrawlArticle: proxiedCrawlUnsupported({ kind: "content-too-large", bytes: 100_000_000 }),
			});

			await run(handler, { url: URL, refresh: true, previousBodyHash: "previous-hash" });

			expect(updateFetchTimestamp).toHaveBeenCalledWith(expect.objectContaining({ url: URL, bodyHash: "previous-hash" }));
		});

		it.each([
			{ label: "no candidates", candidates: undefined, published: [{ id: expect.any(String), tier: "tier-1" }] },
			{ label: "wrapper candidates", candidates: wrapperRefs, published: [...wrapperRefs, { id: expect.any(String), tier: "tier-1" }] },
		])("reaches the Web Unlocker render without publishing when a fetched body cannot be committed ($label)", async ({ candidates, published }) => {
			const renderPage = renderPageAnswering({ direct: failed("direct timeout"), residential: blocked(403), webUnlocker: rendered() });
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const finalizeArticle = jest.fn<ReturnType<FinalizeArticle>, Parameters<FinalizeArticle>>()
				.mockResolvedValueOnce({ ok: true, article: finalizedArticle })
				.mockResolvedValueOnce({ ok: false, reason: "empty document" })
				.mockResolvedValue({ ok: true, article: finalizedArticle });
			const handler = createHandler({ renderPage, publishEvent, putTierSource, finalizeArticle, proxiedCrawlArticle: proxiedCrawlFetching(200) });

			await run(handler, { url: URL, candidates });

			expect(renderPage).toHaveBeenCalledTimes(3);
			expect(putTierSource).toHaveBeenCalledTimes(1);
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				metadata: expect.objectContaining({ renderedThrough: "web-unlocker-render" }),
			}));
			expect(publishEvent).toHaveBeenCalledTimes(1);
			expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({ candidates: published }));
		});

		it("runs straight after a failed direct render on a blocked deferral", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const renderPage = renderPageAnswering({ direct: failed("direct timeout") });
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ consumeRenderCrawlBudget, renderPage, putTierSource, proxiedCrawlArticle: proxiedCrawlFetching(200) });

			await run(handler, { url: URL, unsupportedReason: "blocked" });

			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(putTierSource).toHaveBeenCalledTimes(1);
		});

		it("is left out without block evidence, and the Web Unlocker render still runs", async () => {
			const proxiedCrawlArticle = jest.fn(refusedProxiedCrawl);
			const renderPage = renderPageAnswering({ direct: failed("direct timeout"), residential: failed("residential timeout"), webUnlocker: rendered() });
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ proxiedCrawlArticle, renderPage, putTierSource });

			await run(handler, { url: URL, unsupportedReason: "javascript-required" });

			expect(proxiedCrawlArticle).not.toHaveBeenCalled();
			expect(renderPage).toHaveBeenCalledTimes(3);
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				metadata: expect.objectContaining({ renderedThrough: "web-unlocker-render" }),
			}));
		});

		it("runs after an unreadable direct render on a blocked deferral", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const renderPage = renderPageAnswering({ direct: rendered() });
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const finalizeArticle = jest.fn<ReturnType<FinalizeArticle>, Parameters<FinalizeArticle>>()
				.mockResolvedValueOnce({ ok: false, reason: "empty document" })
				.mockResolvedValue({ ok: true, article: finalizedArticle });
			const handler = createHandler({ consumeRenderCrawlBudget, renderPage, putTierSource, transitionAndPersist, finalizeArticle, proxiedCrawlArticle: proxiedCrawlFetching(200) });

			await run(handler, { url: URL, unsupportedReason: "blocked" });

			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(transitionAndPersist).not.toHaveBeenCalled();
			expect(putTierSource).toHaveBeenCalledTimes(1);
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				metadata: expect.objectContaining({ renderedThrough: "web-unlocker-fetch" }),
			}));
		});

		it("names the unreadable direct render when no leg brings a body on a blocked deferral", async () => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				transitionAndPersist,
				finalizeArticle: unreadableFinalize,
				renderPage: renderPageAnswering({ direct: rendered(), webUnlocker: failed("unlocker timeout") }),
			});

			await run(handler, { url: URL, unsupportedReason: "blocked" });

			const detail = "render-failed: direct-egress: no readable article after render (direct-egress): empty document; residential-per-gb: skipped (block-evidence); web-unlocker-fetch: blocked; web-unlocker-render: unlocker timeout";
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, {
				url: URL,
				input: { reason: { kind: "fetch-failed", detail, httpStatus: 200 }, receiveCount: 1 },
			});
		});

		it("ends an unreadable direct render on a javascript-required deferral without a paid leg", async () => {
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

		it("claims one slot per message and runs no paid leg once the window is spent", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: false });
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT") });
			const proxiedCrawlArticle = jest.fn(refusedProxiedCrawl);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const warn = jest.fn();
			const handler = createHandler({ consumeRenderCrawlBudget, renderPage, proxiedCrawlArticle, transitionAndPersist, logger: { ...noopLogger, warn } });

			const response = await run(handler, { url: URL });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(consumeRenderCrawlBudget).toHaveBeenCalledWith({ messageId: "msg-1" });
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(proxiedCrawlArticle).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalledWith("[RenderCrawlCommand] render-crawl budget exhausted — failing crawl gracefully", { url: URL, gate: "residential-per-gb", direct: failed("net::ERR_TIMED_OUT") });
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, { url: URL, input: { reason: { kind: "blocked", cause: "spend-capped" } } });
		});

		it("leaves a refreshed article's served content alone once the window is spent", async () => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ renderPage: renderPageAnswering({ direct: blocked(403) }), consumeRenderCrawlBudget: async () => ({ allowed: false }), transitionAndPersist });

			await run(handler, { url: URL, refresh: true });

			expect(transitionAndPersist).not.toHaveBeenCalled();
		});

		it("hands the reader's wrapper candidates to selection once the window is spent", async () => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ renderPage: renderPageAnswering({ direct: blocked(403) }), consumeRenderCrawlBudget: async () => ({ allowed: false }), publishEvent });

			await run(handler, { url: URL, candidates: wrapperRefs });

			expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({
				candidates: wrapperRefs,
				liveAttempt: { outcome: "no-body" },
			}));
		});
	});

	describe("block evidence before the residential render", () => {
		const blockEvidence: { label: string; direct: RenderOutcome; unsupportedReason: "javascript-required" | "blocked" }[] = [
			{ label: "a blocked deferral", direct: failed("net::ERR_TIMED_OUT"), unsupportedReason: "blocked" },
			{ label: "a bot-blocked direct render on a javascript-required deferral", direct: blocked(403), unsupportedReason: "javascript-required" },
		];

		it.each(blockEvidence)("settles $label through the Web Unlocker fetch without a residential egress or budget", async ({ direct, unsupportedReason }) => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const residentialEgress = jest.fn(() => RESIDENTIAL_EGRESS);
			const renderPage = renderPageAnswering({ direct });
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const info = jest.fn();
			const handler = createHandler({
				consumeRenderCrawlBudget,
				residentialEgress,
				renderPage,
				putTierSource,
				proxiedCrawlArticle: proxiedCrawlFetching(200),
				logger: { ...noopLogger, info },
			});

			const response = await run(handler, { url: URL, unsupportedReason });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(residentialEgress).not.toHaveBeenCalled();
			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				metadata: expect.objectContaining({ renderedThrough: "web-unlocker-fetch" }),
			}));
			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] ladder settled", { url: URL, settledThrough: "web-unlocker-fetch", residentialSkipped: true });
		});

		it("claims the budget after a Web Unlocker fetch with no body, then renders through the Web Unlocker", async () => {
			const order: string[] = [];
			const consumeRenderCrawlBudget = jest.fn(async () => {
				order.push("budget");
				return { allowed: true, consumed: true };
			});
			const proxiedCrawlArticle: CrawlArticle = async () => {
				order.push("web-unlocker-fetch");
				return { status: "blocked", httpStatus: 403 };
			};
			const residentialEgress = jest.fn(() => RESIDENTIAL_EGRESS);
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), webUnlocker: rendered() });
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const info = jest.fn();
			const handler = createHandler({ consumeRenderCrawlBudget, proxiedCrawlArticle, residentialEgress, renderPage, putTierSource, logger: { ...noopLogger, info } });

			await run(handler, { url: URL, unsupportedReason: "blocked" });

			expect(order).toEqual(["web-unlocker-fetch", "budget"]);
			expect(consumeRenderCrawlBudget).toHaveBeenCalledWith({ messageId: "msg-1" });
			expect(residentialEgress).not.toHaveBeenCalled();
			expect(renderPage).toHaveBeenNthCalledWith(2, { url: URL, egress: WEB_UNLOCKER_EGRESS, navigationTimeoutMilliseconds: 90_000 });
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				metadata: expect.objectContaining({ renderedThrough: "web-unlocker-render" }),
			}));
			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] ladder settled", { url: URL, settledThrough: "web-unlocker-render", residentialSkipped: true });
		});

		it("runs no Web Unlocker render once the window is spent, naming the Web Unlocker render as the gate", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: false });
			const proxiedCrawlArticle = jest.fn(refusedProxiedCrawl);
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT") });
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const warn = jest.fn();
			const handler = createHandler({ consumeRenderCrawlBudget, proxiedCrawlArticle, renderPage, transitionAndPersist, logger: { ...noopLogger, warn } });

			const response = await run(handler, { url: URL, unsupportedReason: "blocked" });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(proxiedCrawlArticle).toHaveBeenCalledTimes(1);
			expect(consumeRenderCrawlBudget).toHaveBeenCalledTimes(1);
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith("[RenderCrawlCommand] render-crawl budget exhausted — failing crawl gracefully", {
				url: URL,
				gate: "web-unlocker-render",
				direct: failed("net::ERR_TIMED_OUT"),
			});
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, { url: URL, input: { reason: { kind: "blocked", cause: "spend-capped" } } });
		});

		it("logs a direct render as settled without skipping the residential render", async () => {
			const info = jest.fn();
			const handler = createHandler({ logger: { ...noopLogger, info } });

			await run(handler, { url: URL, unsupportedReason: "blocked" });

			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] ladder settled", { url: URL, settledThrough: "direct-egress", residentialSkipped: false });
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

	describe("a new save the free crawl followed to another page", () => {
		const TRACKER = "https://links.tracker.example/r/abc?mid=1";
		const PUBLISHER = "https://publisher.example/story";
		const trackerIdentity: HandlerDeps["prepareArticleIdentity"] = async (url) => ({ status: "resolved", url, originalUrl: TRACKER });

		function recordingProxiedCrawl(result: Awaited<ReturnType<CrawlArticle>>) {
			return jest.fn<ReturnType<CrawlArticle>, Parameters<CrawlArticle>>(async () => result);
		}

		it("starts the direct render, the Web Unlocker fetch and the Web Unlocker render at that page, so no paid leg pays for the tracker again", async () => {
			const renderPage = renderPageAnswering({ direct: blocked(403), residential: blocked(403), webUnlocker: rendered({ finalUrl: PUBLISHER }) });
			const proxiedCrawlArticle = recordingProxiedCrawl({ status: "blocked", httpStatus: 403 });
			const handler = createHandler({ prepareArticleIdentity: trackerIdentity, renderPage, proxiedCrawlArticle });

			await run(handler, { url: TRACKER, unsupportedReason: "blocked", finalUrl: PUBLISHER });

			expect(renderPage.mock.calls.map(([params]) => params.url)).toEqual([PUBLISHER, PUBLISHER]);
			expect(proxiedCrawlArticle.mock.calls.map(([params]) => params.url)).toEqual([PUBLISHER]);
		});

		it("marks the processing log line as resumed, so render attempts that skipped the tracker can be counted", async () => {
			const info = jest.fn();
			const handler = createHandler({ prepareArticleIdentity: trackerIdentity, renderPage: renderPageAnswering({ direct: rendered({ finalUrl: PUBLISHER }) }), logger: { ...noopLogger, info } });

			await run(handler, { url: TRACKER, finalUrl: PUBLISHER });
			await run(handler, { url: TRACKER });

			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] processing", { url: TRACKER, recrawl: 0, refresh: 0, resumedAtObservedPage: 1 });
			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] processing", { url: TRACKER, recrawl: 0, refresh: 0, resumedAtObservedPage: 0 });
		});

		it("keeps the stored row, the save attempt and the selection hand-off on the tracker's identity", async () => {
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				prepareArticleIdentity: trackerIdentity,
				renderPage: renderPageAnswering({ direct: rendered({ finalUrl: PUBLISHER }) }),
				putTierSource,
				publishEvent,
				updateFetchTimestamp,
			});

			await run(handler, { url: TRACKER, userId: "user-1", finalUrl: PUBLISHER });

			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({ url: TRACKER, metadata: expect.objectContaining({ attemptId: "attempt-1", sourceUrl: PUBLISHER }) }));
			expect(updateFetchTimestamp).toHaveBeenCalledWith(expect.objectContaining({ url: TRACKER }));
			expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({ url: TRACKER, userId: "user-1", saveAttemptId: "attempt-1" }));
		});

		it("escalates unreadable direct and residential renders of that page through the Web Unlocker fetch of the same page", async () => {
			const proxiedCrawlArticle = recordingProxiedCrawl({ status: "fetched", html: RENDERED_HTML, bodyHash: "proxied-hash", httpStatus: 200, finalUrl: PUBLISHER });
			const finalizeArticle = jest.fn<ReturnType<FinalizeArticle>, Parameters<FinalizeArticle>>()
				.mockResolvedValueOnce({ ok: false, reason: "empty document" })
				.mockResolvedValueOnce({ ok: false, reason: "empty document" })
				.mockResolvedValue({ ok: true, article: finalizedArticle });
			const handler = createHandler({
				prepareArticleIdentity: trackerIdentity,
				renderPage: renderPageAnswering({ direct: rendered({ finalUrl: PUBLISHER }), residential: rendered({ finalUrl: PUBLISHER }) }),
				proxiedCrawlArticle,
				finalizeArticle,
			});

			await run(handler, { url: TRACKER, unsupportedReason: "blocked", finalUrl: PUBLISHER });

			expect(proxiedCrawlArticle.mock.calls.map(([params]) => params.url)).toEqual([PUBLISHER]);
		});

		it("resolves a proxied body's relative links and images, and records its source, against the page it was fetched from", async () => {
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const article = `<p>${"A readable publisher paragraph with plenty of words in it. ".repeat(20)}<a href="/next">Next</a></p><img src="/photo.jpg">`;
			const html = `<html><head><title>Story</title></head><body><article>${article}</article></body></html>`;
			const { parseHtml } = initReadabilityParser({ crawlArticle: unusedCrawl, siteRules: [], readabilityAdditions, logError: () => {} });
			const finalizeArticle = initFinalizeArticle({
				parseHtml,
				downloadMedia: async () => [],
				processContent: async ({ html: content }) => content,
				fetchThumbnailImage: async () => ({ image: undefined, provenUnusable: [] }),
				putImageObject: async () => {},
				imagesCdnBaseUrl: CDN_BASE_URL,
			});
			const handler = createHandler({
				prepareArticleIdentity: trackerIdentity,
				renderPage: renderPageAnswering({ direct: blocked(403), residential: blocked(403) }),
				proxiedCrawlArticle: async () => ({ status: "fetched", html, bodyHash: "proxied-hash", httpStatus: 200 }),
				finalizeArticle,
				putTierSource,
			});

			await run(handler, { url: TRACKER, unsupportedReason: "blocked", finalUrl: PUBLISHER });

			const [[stored]] = putTierSource.mock.calls;
			expect(stored.url).toBe(TRACKER);
			expect(stored.metadata.sourceUrl).toBe(PUBLISHER);
			expect(stored.html).toContain('href="https://publisher.example/next"');
			expect(stored.html).toContain('src="https://publisher.example/photo.jpg"');
		});

		it("keeps every leg on the destination already pinned to the article, whatever page the queued message names", async () => {
			const PINNED = "https://pinned.example/story";
			const renderPage = renderPageAnswering({ direct: blocked(403), residential: blocked(403), webUnlocker: rendered({ finalUrl: PINNED }) });
			const proxiedCrawlArticle = recordingProxiedCrawl({ status: "blocked", httpStatus: 403 });
			const findAdoptedFetchUrl = jest.fn(async () => PINNED);
			const handler = createHandler({
				prepareArticleIdentity: async (url) => ({ status: "resolved", url, originalUrl: PINNED }),
				findAdoptedFetchUrl,
				renderPage,
				proxiedCrawlArticle,
			});

			await run(handler, { url: TRACKER, unsupportedReason: "blocked", finalUrl: "https://attacker.example/elsewhere" });

			expect(findAdoptedFetchUrl).toHaveBeenCalledWith(TRACKER);
			expect(renderPage.mock.calls.map(([params]) => params.url)).toEqual([PINNED, PINNED]);
			expect(proxiedCrawlArticle.mock.calls.map(([params]) => params.url)).toEqual([PINNED]);
		});

		it.each([{ recrawl: true }, { refresh: true }])("ignores the observed page on a %j crawl, which keeps its existing pin resolution", async (flag) => {
			const renderPage = renderPageAnswering({ direct: blocked(403), residential: blocked(403), webUnlocker: rendered() });
			const proxiedCrawlArticle = recordingProxiedCrawl({ status: "blocked", httpStatus: 403 });
			const findAdoptedFetchUrl = jest.fn(async () => undefined);
			const handler = createHandler({ prepareArticleIdentity: trackerIdentity, findAdoptedFetchUrl, renderPage, proxiedCrawlArticle });

			await run(handler, { url: TRACKER, unsupportedReason: "blocked", finalUrl: PUBLISHER, ...flag });

			expect(renderPage.mock.calls.map(([params]) => params.url)).toEqual([TRACKER, TRACKER]);
			expect(proxiedCrawlArticle.mock.calls.map(([params]) => params.url)).toEqual([TRACKER]);
			expect(findAdoptedFetchUrl).toHaveBeenCalledTimes(0);
		});

		it("starts at the resolved original, with no extra pin read, when the message names no observed page", async () => {
			const renderPage = renderPageAnswering({ direct: blocked(403), residential: blocked(403), webUnlocker: rendered() });
			const proxiedCrawlArticle = recordingProxiedCrawl({ status: "blocked", httpStatus: 403 });
			const findAdoptedFetchUrl = jest.fn(async () => undefined);
			const handler = createHandler({ prepareArticleIdentity: trackerIdentity, findAdoptedFetchUrl, renderPage, proxiedCrawlArticle });

			await run(handler, { url: TRACKER, unsupportedReason: "blocked" });

			expect(renderPage.mock.calls.map(([params]) => params.url)).toEqual([TRACKER, TRACKER]);
			expect(proxiedCrawlArticle.mock.calls.map(([params]) => params.url)).toEqual([TRACKER]);
			expect(findAdoptedFetchUrl).toHaveBeenCalledTimes(0);
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
