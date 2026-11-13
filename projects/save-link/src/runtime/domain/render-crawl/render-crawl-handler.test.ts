import { createHash } from "node:crypto";
import { noopLogger } from "@packages/logger";
import type { CrawlArticle, CrawlUnsupportedReason } from "@packages/crawl-article";
import { MAX_HTML_BYTES } from "@packages/crawl-article";
import { markCrawlAwaitingReader, markCrawlBlocked, markCrawlExhausted, markCrawlFailed, markCrawlUnsupported } from "@packages/domain/article-aggregate";
import {
	ComprehensiveCrawlCommand,
	type CrawlTrigger,
	RecrawlContentExtractedEvent,
	RefreshContentExtractedEvent,
	TierContentExtractedEvent,
} from "@packages/infra-components";
import { initFinalizeArticle, type FinalizeArticle, type FinalizedArticle } from "@packages/finalize-article";
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
import type { SQSEvent } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import type { RenderOutcome, RenderPage, ResidentialEgress, WebUnlockerEgress } from "./render-page.types";
import { legInputHash } from "../metered-leg/leg-input-hash";
import { initRenderCrawlHandler } from "./render-crawl-handler";
import { initRecordingPublishEvent } from "@packages/test-fixtures/providers/events";

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
	trigger?: CrawlTrigger;
	previousBodyHash?: string;
	unsupportedReason?: "javascript-required" | "blocked";
	finalUrl?: string;
}): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail: { saveAttemptId: "attempt-1", unsupportedReason: "javascript-required", trigger: "save", ...detail } }),
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

const oneRequest = {
	proxiedRequestLimit: 40,
	continued: 1,
	continuedProxied: 0,
	continuedDirect: 1,
	continuedNavigations: 1,
	abortedByBudget: 0,
	abortedByType: 0,
	abortedBy: { type: 0, address: 0, budget: 0 },
	continuedByResourceType: { document: 1 },
};
const oneDocumentHost = {
	initialSite: "example-spa.test",
	finalSite: "example-spa.test",
	buckets: [{ documentSite: "example-spa.test", requestHost: "example-spa.test", resourceType: "document", navigation: true, route: "direct" as const, requests: 1, response2xx: 1, responseOther: 0, failed: 0 }],
	overflowedRequests: 0,
};

const rendered = (overrides: Partial<Extract<RenderOutcome, { kind: "rendered" }>> = {}): RenderOutcome => ({
	kind: "rendered",
	html: RENDERED_HTML,
	finalUrl: URL,
	httpStatus: 200,
	requests: oneRequest,
	resourceHosts: oneDocumentHost,
	...overrides,
});
const blocked = (httpStatus: number): RenderOutcome => ({ kind: "blocked", httpStatus, requests: oneRequest, resourceHosts: oneDocumentHost });
const failed = (detail: string, httpStatus?: number): RenderOutcome => ({ kind: "failed", detail, httpStatus, requests: oneRequest, resourceHosts: oneDocumentHost });

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
		fetched: candidates,
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
		...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => new Date("2026-10-28T12:00:00.000Z") }),
		adoptCanonicalIdentity: jest.fn().mockResolvedValue(undefined),
		publishEvent: initRecordingPublishEvent().publishEvent,
		renderPage: renderPageAnswering({ direct: rendered() }),
		residentialEgress: () => RESIDENTIAL_EGRESS,
		webUnlockerEgress: WEB_UNLOCKER_EGRESS,
		reportProxiedRenderAttempt: jest.fn(),
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
			const { publishEvent, published } = initRecordingPublishEvent();
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
			expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({
				url: URL,
				userId: "user-1",
				saveAttemptId: "attempt-1",
				candidates: [{ id: expect.any(String), tier: "tier-1" }],
			}) });
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
			{ trigger: "recrawl" as const, event: RecrawlContentExtractedEvent },
			{ trigger: "refresh" as const, event: RefreshContentExtractedEvent },
		])("emits $event.detailType for a $trigger render", async ({ trigger, event }) => {
			const { publishEvent, published } = initRecordingPublishEvent();
			const handler = createHandler({ publishEvent });

			await run(handler, { url: URL, trigger });

			expect(published).toHaveLength(1);
			expect(published).toContainEqual({ detailType: event.detailType, detail: expect.objectContaining({ url: URL }) });
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
			const { publishEvent, published } = initRecordingPublishEvent();
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
			expect(published).toHaveLength(1);
			expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({
				candidates: [...wrapperRefs, { id: expect.any(String), tier: "tier-1" }],
			}) });
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
			const { publishEvent, published } = initRecordingPublishEvent();
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ finalizeArticle: unreadableFinalize, publishEvent, transitionAndPersist });

			await run(handler, { url: URL, candidates: wrapperRefs });

			expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({
				candidates: [...wrapperRefs, { id: expect.any(String), tier: "tier-1" }],
			}) });
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

		it.each(["save", "recrawl"] as const)("hands the reader's wrapper candidates to selection with no live body (trigger=%s)", async (trigger) => {
			const { publishEvent, published } = initRecordingPublishEvent();
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				renderPage: renderPageAnswering({ direct: blocked(403), residential: blocked(403), webUnlocker: blocked(403) }),
				publishEvent,
				transitionAndPersist,
			});

			const response = await run(handler, { url: URL, candidates: wrapperRefs, trigger });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(published).toContainEqual({ detailType: (trigger === "recrawl" ? RecrawlContentExtractedEvent : TierContentExtractedEvent).detailType, detail: expect.objectContaining({
				candidates: wrapperRefs,
				liveAttempt: { outcome: "no-body" },
			}) });
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
				direct: { kind: "blocked", httpStatus: 403, requests: oneRequest },
				residential: { kind: "skipped", reason: "block-evidence" },
				webUnlockerFetch: { kind: "no-body", outcome: "blocked" },
				webUnlockerRender: { kind: "failed", detail: "unlocker timeout", httpStatus: undefined, requests: oneRequest },
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
			const { publishEvent, published } = initRecordingPublishEvent();
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ publishEvent, transitionAndPersist, renderPage: renderPageAnswering({ direct: rendered({ html: oversized }) }) });

			await run(handler, { url: URL, candidates: wrapperRefs });

			expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({
				candidates: wrapperRefs,
				liveAttempt: { outcome: "no-body" },
			}) });
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

			const response = await run(handler, { url: URL, trigger: "refresh", previousBodyHash: "previous-hash" });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(updateFetchTimestamp).toHaveBeenCalledTimes(1);
			expect(updateFetchTimestamp).toHaveBeenCalledWith(backoff);
		});

		it.each([
			{ label: "a first save", detail: { url: URL, trigger: "save" as const } },
			{ label: "a recrawl", detail: { url: URL, trigger: "recrawl" as const } },
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
					thumbnail: { image: { ...hostedImage, url: imageUrl }, provenUnusable: [], fetched: [imageUrl] },
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
			const { publishEvent, published } = initRecordingPublishEvent();
			const renderPage = renderPageAnswering({ direct: failed("direct timeout"), residential: blocked(403), webUnlocker: rendered() });
			const handler = createHandler({ consumeRenderCrawlBudget, publishEvent, renderPage, ...overrides });

			await run(handler, { url: URL });

			expect(published).not.toContainEqual(expect.objectContaining({ detailType: ComprehensiveCrawlCommand.detailType }));
			expect(consumeRenderCrawlBudget).toHaveBeenCalledTimes(1);
			expect(renderPage).toHaveBeenCalledTimes(3);
		});

		const deferrableReasons: { label: string; reason: CrawlUnsupportedReason | undefined }[] = [
			{ label: "non-html content", reason: { kind: "non-html-content", contentType: "application/pdf" } },
			{ label: "a paywall", reason: { kind: "paywall" } },
			{ label: "no stated reason", reason: undefined },
		];
		it.each(deferrableReasons)("hands $label to the comprehensive crawl with no Web Unlocker render", async ({ reason }) => {
			const { publishEvent, published } = initRecordingPublishEvent();
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

			const response = await run(handler, { url: URL, userId: "user-1", trigger: "recrawl", previousBodyHash: "previous-hash", candidates: wrapperRefs });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(published).toHaveLength(1);
			expect(published).toContainEqual({ detailType: ComprehensiveCrawlCommand.detailType, detail: expect.objectContaining({
				url: URL,
				userId: "user-1",
				trigger: "recrawl",
				previousBodyHash: "previous-hash",
				candidates: wrapperRefs,
			}) });
			expect(markCrawlStage).toHaveBeenCalledWith({ url: URL, stage: "comprehensive-fetching" });
			expect(renderPage).toHaveBeenCalledTimes(2);
			expect(transitionAndPersist).not.toHaveBeenCalled();
		});

		it("settles an oversized fetched body as unsupported with no Web Unlocker render", async () => {
			const reason: CrawlUnsupportedReason = { kind: "content-too-large", bytes: 100_000_000 };
			const { publishEvent, published } = initRecordingPublishEvent();
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
			expect(published).not.toContainEqual(expect.objectContaining({ detailType: ComprehensiveCrawlCommand.detailType }));
			expect(renderPage).toHaveBeenCalledTimes(2);
		});

		it("offers the reader's wrapper candidates to selection when the fetched body is oversized", async () => {
			const { publishEvent, published } = initRecordingPublishEvent();
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				publishEvent,
				transitionAndPersist,
				renderPage: renderPageAnswering({ direct: failed("direct timeout"), residential: blocked(403) }),
				proxiedCrawlArticle: proxiedCrawlUnsupported({ kind: "content-too-large", bytes: 100_000_000 }),
			});

			await run(handler, { url: URL, candidates: wrapperRefs });

			expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({ url: URL, candidates: wrapperRefs }) });
			expect(transitionAndPersist).not.toHaveBeenCalled();
		});

		it("backs off a refresh whose fetched body is oversized", async () => {
			const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				updateFetchTimestamp,
				renderPage: renderPageAnswering({ direct: failed("direct timeout"), residential: blocked(403) }),
				proxiedCrawlArticle: proxiedCrawlUnsupported({ kind: "content-too-large", bytes: 100_000_000 }),
			});

			await run(handler, { url: URL, trigger: "refresh", previousBodyHash: "previous-hash" });

			expect(updateFetchTimestamp).toHaveBeenCalledWith(expect.objectContaining({ url: URL, bodyHash: "previous-hash" }));
		});

		it.each([
			{ label: "no candidates", candidates: undefined, expectedCandidates: [{ id: expect.any(String), tier: "tier-1" }] },
			{ label: "wrapper candidates", candidates: wrapperRefs, expectedCandidates: [...wrapperRefs, { id: expect.any(String), tier: "tier-1" }] },
		])("reaches the Web Unlocker render without publishing when a fetched body cannot be committed ($label)", async ({ candidates, expectedCandidates }) => {
			const renderPage = renderPageAnswering({ direct: failed("direct timeout"), residential: blocked(403), webUnlocker: rendered() });
			const { publishEvent, published } = initRecordingPublishEvent();
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
			expect(published).toHaveLength(1);
			expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({ candidates: expectedCandidates }) });
		});

		it("runs straight after a failed direct render on a blocked deferral", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const renderPage = renderPageAnswering({ direct: failed("direct timeout") });
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ consumeRenderCrawlBudget, renderPage, putTierSource, proxiedCrawlArticle: proxiedCrawlFetching(200) });

			await run(handler, { url: URL, unsupportedReason: "blocked" });

			expect(consumeRenderCrawlBudget).toHaveBeenCalledTimes(1);
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

			expect(consumeRenderCrawlBudget).toHaveBeenCalledTimes(1);
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

	describe("the proxied render attempt report", () => {
		const reportFor = (overrides: Partial<HandlerDeps>) => {
			const reportProxiedRenderAttempt = jest.fn();
			return { reportProxiedRenderAttempt, handler: createHandler({ reportProxiedRenderAttempt, ...overrides }) };
		};

		it("reports a readable proxied render with its tally and the save attempt", async () => {
			const proxied = rendered();
			const { reportProxiedRenderAttempt, handler } = reportFor({ renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: proxied }) });

			await run(handler, { url: URL });

			expect(reportProxiedRenderAttempt.mock.calls).toEqual([[{ outcome: { ...proxied, renderedThrough: "residential-per-gb" }, readability: "readable", saveAttemptId: "attempt-1", renderedThrough: "residential-per-gb" }]]);
		});

		it("reports a proxied render finalize cannot read as unreadable", async () => {
			const { reportProxiedRenderAttempt, handler } = reportFor({ finalizeArticle: unreadableFinalize, renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: rendered(), webUnlocker: rendered() }) });

			await run(handler, { url: URL });

			expect(reportProxiedRenderAttempt.mock.calls).toEqual([
				[{ outcome: { ...rendered(), renderedThrough: "residential-per-gb" }, readability: "unreadable", saveAttemptId: "attempt-1", renderedThrough: "residential-per-gb" }],
				[{ outcome: { ...rendered(), renderedThrough: "web-unlocker-render" }, readability: "unreadable", saveAttemptId: "attempt-1", renderedThrough: "web-unlocker-render" }],
			]);
		});

		it("reports an unreadable proxied render as unreadable even when wrapper candidates carry the save on", async () => {
			const { reportProxiedRenderAttempt, handler } = reportFor({ finalizeArticle: unreadableFinalize, renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: rendered(), webUnlocker: rendered() }) });

			await run(handler, { url: URL, candidates: wrapperRefs });

			expect(reportProxiedRenderAttempt.mock.calls).toEqual([
				[{ outcome: { ...rendered(), renderedThrough: "residential-per-gb" }, readability: "unreadable", saveAttemptId: "attempt-1", renderedThrough: "residential-per-gb" }],
				[{ outcome: { ...rendered(), renderedThrough: "web-unlocker-render" }, readability: "unreadable", saveAttemptId: "attempt-1", renderedThrough: "web-unlocker-render" }],
			]);
		});

		it("reports an oversized proxied render as unknown, since no readability check ran", async () => {
			const oversized = rendered({ html: "a".repeat(MAX_HTML_BYTES.bytes + 1) });
			const { reportProxiedRenderAttempt, handler } = reportFor({ renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: oversized }) });

			await run(handler, { url: URL });

			expect(reportProxiedRenderAttempt.mock.calls).toEqual([[{ outcome: { ...oversized, renderedThrough: "residential-per-gb" }, readability: "unknown", saveAttemptId: "attempt-1", renderedThrough: "residential-per-gb" }]]);
		});

		it("reports each failed proxied render with that leg's outcome", async () => {
			const residential = failed("net::ERR_PROXY_CONNECTION_FAILED");
			const webUnlocker = failed("unlocker timeout");
			const { reportProxiedRenderAttempt, handler } = reportFor({ renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential, webUnlocker }) });

			await run(handler, { url: URL });

			expect(reportProxiedRenderAttempt.mock.calls).toEqual([
				[{ outcome: residential, readability: "unreadable", saveAttemptId: "attempt-1", renderedThrough: "residential-per-gb" }],
				[{ outcome: webUnlocker, readability: "unreadable", saveAttemptId: "attempt-1", renderedThrough: "web-unlocker-render" }],
			]);
		});

		it("reports the proxied render that follows an unreadable direct render once", async () => {
			const finalizeArticle = jest.fn<ReturnType<FinalizeArticle>, Parameters<FinalizeArticle>>()
				.mockResolvedValueOnce({ ok: false, reason: "empty document" })
				.mockResolvedValue({ ok: true, article: finalizedArticle });
			const { reportProxiedRenderAttempt, handler } = reportFor({ finalizeArticle, renderPage: renderPageAnswering({ direct: rendered(), webUnlocker: rendered() }) });

			await run(handler, { url: URL, unsupportedReason: "blocked" });

			expect(reportProxiedRenderAttempt.mock.calls).toEqual([[expect.objectContaining({ readability: "readable", renderedThrough: "web-unlocker-render" })]]);
		});

		it.each<{ label: string; overrides: Partial<HandlerDeps> }>([
			{ label: "a direct render", overrides: {} },
			{ label: "a render the budget refused", overrides: { renderPage: renderPageAnswering({ direct: blocked(403) }), consumeRenderCrawlBudget: async () => ({ allowed: false }) } },
		])("reports nothing for $label, which spent no proxied render", async ({ overrides }) => {
			const { reportProxiedRenderAttempt, handler } = reportFor(overrides);

			await run(handler, { url: URL });

			expect(reportProxiedRenderAttempt.mock.calls).toEqual([]);
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
			expect(warn).toHaveBeenCalledWith("[RenderCrawlCommand] render-crawl budget exhausted — failing crawl gracefully", { url: URL, gate: "residential-per-gb", direct: { kind: "failed", detail: "net::ERR_TIMED_OUT", httpStatus: undefined, requests: oneRequest } });
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, { url: URL, input: { reason: { kind: "blocked", cause: "spend-capped" } } });
		});

		it("leaves a refreshed article's served content alone once the window is spent", async () => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ renderPage: renderPageAnswering({ direct: blocked(403) }), consumeRenderCrawlBudget: async () => ({ allowed: false }), transitionAndPersist });

			await run(handler, { url: URL, trigger: "refresh" });

			expect(transitionAndPersist).not.toHaveBeenCalled();
		});

		it("hands the reader's wrapper candidates to selection once the window is spent", async () => {
			const { publishEvent, published } = initRecordingPublishEvent();
			const handler = createHandler({ renderPage: renderPageAnswering({ direct: blocked(403) }), consumeRenderCrawlBudget: async () => ({ allowed: false }), publishEvent });

			await run(handler, { url: URL, candidates: wrapperRefs });

			expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({
				candidates: wrapperRefs,
				liveAttempt: { outcome: "no-body" },
			}) });
		});
	});

	describe("block evidence before the residential render", () => {
		const blockEvidence: { label: string; direct: RenderOutcome; unsupportedReason: "javascript-required" | "blocked" }[] = [
			{ label: "a blocked deferral", direct: failed("net::ERR_TIMED_OUT"), unsupportedReason: "blocked" },
			{ label: "a bot-blocked direct render on a javascript-required deferral", direct: blocked(403), unsupportedReason: "javascript-required" },
		];

		it.each(blockEvidence)("settles $label through the Web Unlocker fetch after one budget unit and without a residential egress", async ({ direct, unsupportedReason }) => {
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
			expect(consumeRenderCrawlBudget).toHaveBeenCalledTimes(1);
			expect(consumeRenderCrawlBudget).toHaveBeenCalledWith({ messageId: "msg-1" });
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				metadata: expect.objectContaining({ renderedThrough: "web-unlocker-fetch" }),
			}));
			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] ladder settled", { url: URL, settledThrough: "web-unlocker-fetch", residentialSkipped: true });
		});

		it("claims the budget once, before the Web Unlocker fetch, then renders through the Web Unlocker", async () => {
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

			expect(order).toEqual(["budget", "web-unlocker-fetch"]);
			expect(consumeRenderCrawlBudget).toHaveBeenCalledTimes(1);
			expect(consumeRenderCrawlBudget).toHaveBeenCalledWith({ messageId: "msg-1" });
			expect(residentialEgress).not.toHaveBeenCalled();
			expect(renderPage).toHaveBeenNthCalledWith(2, { url: URL, egress: WEB_UNLOCKER_EGRESS, navigationTimeoutMilliseconds: 90_000 });
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				metadata: expect.objectContaining({ renderedThrough: "web-unlocker-render" }),
			}));
			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] ladder settled", { url: URL, settledThrough: "web-unlocker-render", residentialSkipped: true });
		});

		it("runs no Web Unlocker fetch once the window is spent, naming the Web Unlocker fetch as the gate", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: false });
			const proxiedCrawlArticle = jest.fn(refusedProxiedCrawl);
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT") });
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const warn = jest.fn();
			const handler = createHandler({ consumeRenderCrawlBudget, proxiedCrawlArticle, renderPage, transitionAndPersist, logger: { ...noopLogger, warn } });

			const response = await run(handler, { url: URL, unsupportedReason: "blocked" });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(proxiedCrawlArticle).not.toHaveBeenCalled();
			expect(consumeRenderCrawlBudget).toHaveBeenCalledTimes(1);
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith("[RenderCrawlCommand] render-crawl budget exhausted — failing crawl gracefully", {
				url: URL,
				gate: "web-unlocker-fetch",
				direct: { kind: "failed", detail: "net::ERR_TIMED_OUT", httpStatus: undefined, requests: oneRequest },
			});
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, { url: URL, input: { reason: { kind: "blocked", cause: "spend-capped" } } });
		});

		it("runs no Web Unlocker render once the window is spent and only the render fits, naming the Web Unlocker render as the gate", async () => {
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: false });
			const proxiedCrawlArticle = jest.fn(refusedProxiedCrawl);
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT") });
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const warn = jest.fn();
			const handler = createHandler({ consumeRenderCrawlBudget, proxiedCrawlArticle, renderPage, transitionAndPersist, logger: { ...noopLogger, warn } });

			const response = await run(handler, { url: URL, unsupportedReason: "blocked" }, 200_000);

			expect(response).toEqual({ batchItemFailures: [] });
			expect(proxiedCrawlArticle).not.toHaveBeenCalled();
			expect(consumeRenderCrawlBudget).toHaveBeenCalledTimes(1);
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith("[RenderCrawlCommand] render-crawl budget exhausted — failing crawl gracefully", {
				url: URL,
				gate: "web-unlocker-render",
				direct: { kind: "failed", detail: "net::ERR_TIMED_OUT", httpStatus: undefined, requests: oneRequest },
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
			const { publishEvent, published } = initRecordingPublishEvent();
			const handler = createHandler({
				prepareArticleIdentity: sourceBound,
				crawlArticle: async ({ url }) => {
					crawled.push(url);
					return captured ? { status: "fetched", html: "<html><body><p>archived</p></body></html>", bodyHash: "hash" } : { status: "failed", decision: undefined };
				},
				publishEvent,
			});

			await run(handler, { url: URL });

			expect(crawled).toEqual([captureUrl]);
			expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({ candidates }) });
		});

		it("does not re-crawl the capture on a refresh", async () => {
			const crawlArticle = jest.fn(unusedCrawl);
			const handler = createHandler({ prepareArticleIdentity: sourceBound, crawlArticle });

			const response = await run(handler, { url: URL, trigger: "refresh" });

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

		it("opens every render leg at the page the free crawl reached and reports both proxied legs", async () => {
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: blocked(403), webUnlocker: blocked(403) });
			const reportProxiedRenderAttempt = jest.fn();
			const handler = createHandler({
				prepareArticleIdentity: trackerIdentity,
				renderPage,
				proxiedCrawlArticle: recordingProxiedCrawl({ status: "blocked", httpStatus: 403 }),
				reportProxiedRenderAttempt,
			});

			await run(handler, { url: TRACKER, unsupportedReason: "javascript-required", finalUrl: PUBLISHER });

			expect(renderPage.mock.calls.map(([params]) => [params.egress.kind, params.url])).toEqual([
				["direct", PUBLISHER],
				["residential", PUBLISHER],
				["web-unlocker", PUBLISHER],
			]);
			expect(reportProxiedRenderAttempt.mock.calls.map(([attempt]) => attempt.renderedThrough)).toEqual(["residential-per-gb", "web-unlocker-render"]);
		});

		it("marks the processing log line as resumed, so render attempts that skipped the tracker can be counted", async () => {
			const info = jest.fn();
			const handler = createHandler({ prepareArticleIdentity: trackerIdentity, renderPage: renderPageAnswering({ direct: rendered({ finalUrl: PUBLISHER }) }), logger: { ...noopLogger, info } });

			await run(handler, { url: TRACKER, finalUrl: PUBLISHER });
			await run(handler, { url: TRACKER });

			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] processing", { url: TRACKER, trigger: "save", resumedAtObservedPage: 1 });
			expect(info).toHaveBeenCalledWith("[RenderCrawlCommand] processing", { url: TRACKER, trigger: "save", resumedAtObservedPage: 0 });
		});

		it("keeps the stored row, the save attempt and the selection hand-off on the tracker's identity", async () => {
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const { publishEvent, published } = initRecordingPublishEvent();
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
			expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({ url: TRACKER, userId: "user-1", saveAttemptId: "attempt-1" }) });
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
				fetchThumbnailImage: async ({ candidates }) => ({ image: undefined, provenUnusable: [], fetched: candidates }),
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

		it.each([{ trigger: "recrawl" as const }, { trigger: "refresh" as const }])("ignores the observed page on a %j crawl, which keeps its existing pin resolution", async (flag) => {
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
		{ label: "a command that fails its schema", overrides: {}, detail: { url: URL, trigger: undefined } },
	])("reports $label as a failed record", async ({ overrides, detail }) => {
		const handler = createHandler(overrides);

		const response = await run(handler, detail);

		expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	describe("residential recovery after a gateway failure", () => {
		const target = "https://publisher.test/article?token=private-query";
		const gatewayFailure = failed("main document answered HTTP 502", 502);
		const markerLines = (info: jest.Mock) => info.mock.calls
			.filter(([message]) => message === "[RenderCrawlCommand] recovery attempt")
			.map(([, fields]) => fields);

		it("records the bounded attempt and candidate outcome without URL secrets, then reuses its settled candidate on redelivery", async () => {
			const info = jest.fn();
			const residentialEgress = jest.fn(() => RESIDENTIAL_EGRESS);
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true, consumed: true });
			const reportProxiedRenderAttempt = jest.fn();
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const { publishEvent, published } = initRecordingPublishEvent();
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_HTTP2_PROTOCOL_ERROR"), webUnlocker: gatewayFailure, residential: rendered({ finalUrl: target }) });
			const handler = createHandler({ renderPage, residentialEgress, consumeRenderCrawlBudget, reportProxiedRenderAttempt, putTierSource, publishEvent, logger: { ...noopLogger, info } });
			const detail = { url: target, unsupportedReason: "blocked" as const, saveAttemptId: "gateway-recovery-attempt" };

			expect(await run(handler, detail)).toEqual({ batchItemFailures: [] });
			expect(consumeRenderCrawlBudget).toHaveBeenCalledTimes(1);
			expect(renderPage.mock.calls.map(([params]) => params.egress.kind)).toEqual(["direct", "web-unlocker", "residential"]);
			expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ renderedThrough: "residential-per-gb" }) }));
			expect(reportProxiedRenderAttempt).toHaveBeenCalledWith(expect.objectContaining({ readability: "readable", saveAttemptId: "gateway-recovery-attempt", renderedThrough: "residential-per-gb" }));
			const recorded = TierContentExtractedEvent.detailSchema.parse(published.find(({ detailType }) => detailType === TierContentExtractedEvent.detailType)?.detail).candidates[0];

			expect(await run(handler, detail)).toEqual({ batchItemFailures: [] });
			expect(residentialEgress).toHaveBeenCalledTimes(1);
			expect(putTierSource).toHaveBeenCalledTimes(1);
			expect(published.at(-1)).toEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({ candidates: [recorded], liveAttempt: { outcome: "no-body" } }) });
			expect(markerLines(info)).toEqual([
				{ stream: "render-recovery", policyVersion: "residential-after-gateway-502-v1", saveAttemptId: "gateway-recovery-attempt", host: "publisher.test", phase: "started" },
				{ stream: "render-recovery", policyVersion: "residential-after-gateway-502-v1", saveAttemptId: "gateway-recovery-attempt", host: "publisher.test", phase: "finished", outcome: "committed" },
			]);
		});

		it("retains the direct, fetch and both browser failures when the recovery also answers 502", async () => {
			const info = jest.fn();
			const logParseError = jest.fn();
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_HTTP2_PROTOCOL_ERROR"), webUnlocker: gatewayFailure, residential: failed("residential main document answered HTTP 502", 502) });
			const handler = createHandler({ renderPage, transitionAndPersist, logParseError, logger: { ...noopLogger, info } });

			expect(await run(handler, { url: target, unsupportedReason: "blocked" })).toEqual({ batchItemFailures: [] });

			const detail = "render-failed: direct-egress: net::ERR_HTTP2_PROTOCOL_ERROR; residential-per-gb: residential main document answered HTTP 502; web-unlocker-fetch: blocked; web-unlocker-render: main document answered HTTP 502";
			expect(logParseError).toHaveBeenCalledWith({ url: target, reason: detail });
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, { url: target, input: { reason: { kind: "fetch-failed", detail, httpStatus: 502 }, receiveCount: 1 } });
			expect(renderPage).toHaveBeenCalledTimes(3);
			expect(markerLines(info).at(-1)).toEqual({ stream: "render-recovery", policyVersion: "residential-after-gateway-502-v1", saveAttemptId: "attempt-1", host: "publisher.test", phase: "finished", outcome: "failed", httpStatus: 502 });
		});

		it.each([false, true])("honors a deferred recovery claim and preserves reader captures (carried: %s)", async (carried) => {
			const ledger = initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => new Date("2026-10-28T12:00:00.000Z") });
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const { publishEvent, published } = initRecordingPublishEvent();
			const residentialEgress = jest.fn(() => RESIDENTIAL_EGRESS);
			const info = jest.fn();
			const handler = createHandler({
				...ledger, transitionAndPersist, publishEvent, residentialEgress, logger: { ...noopLogger, info },
				claimMeteredLeg: (claim) => claim.leg === "render-residential-per-gb" ? Promise.resolve({ kind: "deferred" }) : ledger.claimMeteredLeg(claim),
				renderPage: renderPageAnswering({ direct: failed("net::ERR_HTTP2_PROTOCOL_ERROR"), webUnlocker: gatewayFailure }),
			});

			expect(await run(handler, { url: target, unsupportedReason: "blocked", ...(carried ? { candidates: wrapperRefs } : {}) })).toEqual({ batchItemFailures: [] });
			expect(residentialEgress).not.toHaveBeenCalled();
			expect(markerLines(info)).toEqual([]);
			if (carried) {
				expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({ candidates: wrapperRefs, liveAttempt: { outcome: "no-body" } }) });
				expect(transitionAndPersist).not.toHaveBeenCalled();
			} else {
				expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlAwaitingReader, { url: target, input: { deferredLeg: "render-residential-per-gb" } });
			}
		});
	});

	describe("the metered-leg ledger", () => {
		const NOW = new Date("2026-10-28T12:00:00.000Z");
		const deferringLedger = () => initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => true, now: () => NOW });

		it("claims the residential leg for the page the ladder starts at under the message id, until the queue's visibility timeout", async () => {
			const ledger = initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => NOW });
			const claimMeteredLeg = jest.fn(ledger.claimMeteredLeg);
			const handler = createHandler({
				...ledger,
				claimMeteredLeg,
				renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: rendered() }),
			});

			await run(handler, { url: URL });

			expect(claimMeteredLeg).toHaveBeenCalledWith({
				url: URL,
				leg: "render-residential-per-gb",
				inputHash: legInputHash({ url: URL, leg: "render-residential-per-gb", inputs: [URL, ""] }),
				claimId: "msg-1",
				expiresAt: "2026-10-28T12:10:00.000Z",
			});
		});

		it("settles a residential render with the candidate it committed", async () => {
			const ledger = initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => NOW });
			const settleMeteredLeg = jest.fn(ledger.settleMeteredLeg);
			const { publishEvent, published } = initRecordingPublishEvent();
			const handler = createHandler({
				...ledger,
				settleMeteredLeg,
				publishEvent,
				renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: rendered() }),
			});

			await run(handler, { url: URL });

			const announced = TierContentExtractedEvent.detailSchema.parse(published.find(({ detailType }) => detailType === TierContentExtractedEvent.detailType)?.detail);
			expect(settleMeteredLeg).toHaveBeenCalledWith({
				url: URL,
				permit: expect.objectContaining({ leg: "render-residential-per-gb", claimId: "msg-1" }),
				outcome: JSON.stringify(announced.candidates[0]),
				settledAt: "2026-10-28T12:00:00.000Z",
			});
		});

		it("replays a residential render already settled for the same page through the archive comparison instead of rendering again", async () => {
			const ledger = initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => NOW });
			const { publishEvent: firstPublish, published: firstPublished } = initRecordingPublishEvent();
			await run(createHandler({
				...ledger,
				publishEvent: firstPublish,
				renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: rendered() }),
			}), { url: URL });
			const recorded = TierContentExtractedEvent.detailSchema.parse(firstPublished.find(({ detailType }) => detailType === TierContentExtractedEvent.detailType)?.detail).candidates[0];
			const { publishEvent, published } = initRecordingPublishEvent();
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT") });

			const response = await run(createHandler({ ...ledger, publishEvent, renderPage }), { url: URL });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({
				candidates: [recorded],
				liveAttempt: { outcome: "no-body" },
			}) });
		});

		it("replays a settled leg after the reader's carried candidates", async () => {
			const recorded = { id: "recorded-candidate", tier: "tier-1" };
			const { publishEvent, published } = initRecordingPublishEvent();
			const handler = createHandler({
				claimMeteredLeg: async () => ({ kind: "settled", outcome: JSON.stringify(recorded) }),
				publishEvent,
				renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT") }),
			});

			await run(handler, { url: URL, candidates: wrapperRefs });

			expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({
				candidates: [...wrapperRefs, recorded],
			}) });
		});

		it("acks without a write while another message holds the leg's claim", async () => {
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT") });
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const { publishEvent, published } = initRecordingPublishEvent();
			const handler = createHandler({ claimMeteredLeg: async () => ({ kind: "in-flight" }), renderPage, transitionAndPersist, publishEvent });

			const response = await run(handler, { url: URL });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(transitionAndPersist).not.toHaveBeenCalled();
			expect(published).toEqual([]);
		});

		it("renders a refresh again after a save-time render of the same page settled its leg", async () => {
			const ledger = initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => NOW });
			await run(createHandler({
				...ledger,
				renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: rendered() }),
			}), { url: URL });
			const claimMeteredLeg = jest.fn(ledger.claimMeteredLeg);
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: rendered() });

			await run(createHandler({ ...ledger, claimMeteredLeg, renderPage }), { url: URL, trigger: "refresh", previousBodyHash: "previous-hash" });

			expect(await claimMeteredLeg.mock.results[0].value).toEqual(expect.objectContaining({ kind: "granted" }));
			expect(renderPage).toHaveBeenCalledTimes(2);
		});

		it("releases the residential claim when the render budget is denied", async () => {
			const ledger = initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => NOW });
			const releaseMeteredLeg = jest.fn(ledger.releaseMeteredLeg);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				...ledger,
				releaseMeteredLeg,
				transitionAndPersist,
				consumeRenderCrawlBudget: async () => ({ allowed: false }),
				renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT") }),
			});

			await run(handler, { url: URL });

			expect(releaseMeteredLeg).toHaveBeenCalledWith({ url: URL, permit: expect.objectContaining({ leg: "render-residential-per-gb" }) });
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, { url: URL, input: { reason: { kind: "blocked", cause: "spend-capped" } } });
		});

		const meteredLegLines = (info: jest.Mock) => info.mock.calls.filter(([message]) => message === "[metered-leg]").map(([, line]) => line);

		it("logs the residential leg's claim and settle", async () => {
			const info = jest.fn();
			const handler = createHandler({
				logger: { ...noopLogger, info },
				renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: rendered() }),
			});

			await run(handler, { url: URL });

			expect(meteredLegLines(info)).toEqual([
				{ url: URL, leg: "render-residential-per-gb", action: "claimed" },
				{ url: URL, leg: "render-residential-per-gb", action: "settled" },
			]);
		});

		it("logs a released leg before the leg that settled", async () => {
			const info = jest.fn();
			const handler = createHandler({
				logger: { ...noopLogger, info },
				proxiedCrawlArticle: proxiedCrawlFetching(200),
				renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT"), residential: blocked(403) }),
			});

			await run(handler, { url: URL });

			expect(meteredLegLines(info)).toEqual([
				{ url: URL, leg: "render-residential-per-gb", action: "claimed" },
				{ url: URL, leg: "render-residential-per-gb", action: "released" },
				{ url: URL, leg: "render-web-unlocker-fetch", action: "claimed" },
				{ url: URL, leg: "render-web-unlocker-fetch", action: "settled" },
			]);
		});

		it.each([
			{ kind: "deferred", claim: { kind: "deferred" as const }, action: "deferred" },
			{ kind: "settled", claim: { kind: "settled" as const, outcome: JSON.stringify({ id: "recorded-candidate", tier: "tier-1" }) }, action: "skipped-settled" },
			{ kind: "in-flight", claim: { kind: "in-flight" as const }, action: "skipped-in-flight" },
		])("logs a $kind claim as $action without running the leg", async ({ claim, action }) => {
			const info = jest.fn();
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT") });
			const handler = createHandler({ logger: { ...noopLogger, info }, claimMeteredLeg: async () => claim, renderPage });

			await run(handler, { url: URL });

			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(meteredLegLines(info)).toEqual([{ url: URL, leg: "render-residential-per-gb", action }]);
		});

		it("logs no paid-leg line for a leg the budget refuses", async () => {
			const info = jest.fn();
			const warn = jest.fn();
			const handler = createHandler({
				logger: { ...noopLogger, info, warn },
				consumeRenderCrawlBudget: async () => ({ allowed: false }),
				renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT") }),
			});

			await run(handler, { url: URL });

			expect(meteredLegLines(info)).toEqual([]);
			expect(warn).toHaveBeenCalledWith("[RenderCrawlCommand] render-crawl budget exhausted — failing crawl gracefully", expect.objectContaining({ url: URL, gate: "residential-per-gb" }));
		});

		it("parks the crawl awaiting a reader, before any residential render or budget, when the free legs saw no block evidence", async () => {
			const renderPage = renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT") });
			const consumeRenderCrawlBudget = jest.fn().mockResolvedValue({ allowed: true });
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ ...deferringLedger(), renderPage, consumeRenderCrawlBudget, transitionAndPersist });

			const response = await run(handler, { url: URL });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(renderPage).toHaveBeenCalledTimes(1);
			expect(consumeRenderCrawlBudget).not.toHaveBeenCalled();
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlAwaitingReader, { url: URL, input: { deferredLeg: "render-residential-per-gb" } });
		});

		it("hands the reader's carried candidates to selection when the residential render is deferred", async () => {
			const { publishEvent, published } = initRecordingPublishEvent();
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ ...deferringLedger(), publishEvent, transitionAndPersist, renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT") }) });

			await run(handler, { url: URL, candidates: wrapperRefs });

			expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({
				candidates: wrapperRefs,
				liveAttempt: { outcome: "no-body" },
			}) });
			expect(transitionAndPersist).not.toHaveBeenCalled();
		});

		it("commits today's blocked failure from the direct render's status when the paid legs are deferred on block evidence", async () => {
			const proxiedCrawlArticle = jest.fn(refusedProxiedCrawl);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ ...deferringLedger(), proxiedCrawlArticle, transitionAndPersist, renderPage: renderPageAnswering({ direct: blocked(429) }) });

			await run(handler, { url: URL });

			expect(proxiedCrawlArticle).not.toHaveBeenCalled();
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, { url: URL, input: { reason: { kind: "blocked", cause: "rate-limited" } } });
		});

		it("commits an edge-block failure when tier-1 saw the block and the direct render failed without one, with the paid legs deferred", async () => {
			const logParseError = jest.fn();
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ ...deferringLedger(), logParseError, transitionAndPersist, renderPage: renderPageAnswering({ direct: failed("net::ERR_TIMED_OUT") }) });

			await run(handler, { url: URL, unsupportedReason: "blocked" });

			expect(logParseError).toHaveBeenCalledWith({ url: URL, reason: "crawl-blocked: paid render legs deferred" });
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, { url: URL, input: { reason: { kind: "blocked", cause: "edge-block" } } });
		});
	});
});
