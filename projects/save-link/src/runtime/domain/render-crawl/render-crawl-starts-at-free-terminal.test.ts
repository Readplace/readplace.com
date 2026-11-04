import { UserIdSchema } from "@packages/domain/user";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { noopLogger } from "@packages/logger";
import type { CrawlArticle } from "@packages/crawl-article";
import type { FinalizeArticle } from "@packages/finalize-article";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { RenderCrawlCommand, SimpleCrawlUnsupportedEvent, TierContentExtractedEvent } from "@packages/infra-components";
import type { SQSEvent } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { initEmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import { initSaveLinkWork } from "../save-link/save-link-work";
import { initSimpleCrawlUnsupportedPolicyHandler } from "../simple-crawl-unsupported-policy/simple-crawl-unsupported-policy-handler";
import type { RenderOutcome, RenderPage } from "../../providers/render-page/render-page.types";
import { initRenderCrawlHandler } from "./render-crawl-handler";

const TRACKER = "https://links.tracker.example/r/abc?mid=1";
const PUBLISHER = "https://publisher.example/story";
const RENDERED_HTML = "<html><head><title>Story</title></head><body><article><p>Rendered body</p></article></body></html>";
const oneRequest = {
	proxiedRequestLimit: 40,
	continued: 1,
	continuedProxied: 1,
	continuedDirect: 0,
	continuedNavigations: 1,
	abortedByBudget: 0,
	abortedByType: 0,
	abortedBy: { type: 0, address: 0, budget: 0 },
	continuedByResourceType: { document: 1 },
};
const publisherDocument = {
	initialSite: "publisher.example",
	finalSite: "publisher.example",
	buckets: [{ documentSite: "publisher.example", requestHost: "publisher.example", resourceType: "document", navigation: true, route: "proxy" as const, requests: 1, response2xx: 1, responseOther: 0, failed: 0 }],
	overflowedRequests: 0,
};

type Published = { detailType: string; body: string };

function wire(published: Published[]): PublishEvent {
	return async (event, detail) => {
		published.push({ detailType: event.detailType, body: JSON.stringify({ detail: event.detailSchema.parse(detail) }) });
	};
}

function sqsEventFrom(message: Published): SQSEvent {
	return {
		Records: [{
			messageId: `${message.detailType}-1`,
			receiptHandle: "receipt-1",
			body: message.body,
			attributes: { ApproximateReceiveCount: "1", SentTimestamp: "1620000000000", SenderId: "TESTID", ApproximateFirstReceiveTimestamp: "1620000000001" },
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: `arn:aws:sqs:ap-southeast-2:123456789:${message.detailType}`,
			awsRegion: "ap-southeast-2",
		}],
	};
}

function takeOne(published: Published[], detailType: string): Published {
	const message = published.find((candidate) => candidate.detailType === detailType);
	if (message === undefined) throw new Error(`no ${detailType} was published`);
	return message;
}

describe("a tracker link whose publisher blocked the free crawl", () => {
	it("reaches the render crawl's paid legs as the publisher, through every real mapping and schema on the way", async () => {
		const published: Published[] = [];
		const publishEvent = wire(published);
		const saveAttemptId = SaveAttemptIdSchema.parse("attempt-1");

		const { saveLinkWork } = initSaveLinkWork({
			resolveOriginalUrl: async (url) => url,
			crawlAndFinalizeArticle: async () => ({ status: "blocked", httpStatus: 403, finalUrl: PUBLISHER }),
			emitSimpleCrawlUnsupported: initEmitSimpleCrawlUnsupported({ publishEvent }),
			putTierSource: async () => {},
			updateFetchTimestamp: async () => {},
			transitionAndPersist: async () => {},
			markCrawlStage: async () => {},
			adoptCanonicalIdentity: async () => {},
			isSiteRuleUrl: () => false,
			now: () => new Date("2026-11-03T00:00:00.000Z"),
			logger: noopLogger,
			logParseError: () => {},
			logCrawlOutcome: () => {},
			readTierSnapshot: async () => ({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
			publishEvent,
			logPrefix: "[composition]",
		});
		await saveLinkWork(TRACKER, { userId: UserIdSchema.parse("user-1"), saveAttemptId });

		const policy = initSimpleCrawlUnsupportedPolicyHandler({ publishEvent, logger: noopLogger });
		await policy(sqsEventFrom(takeOne(published, SimpleCrawlUnsupportedEvent.detailType)), buildLambdaContext(), () => {});

		const navigated: string[] = [];
		const fetched: string[] = [];
		const stored: string[] = [];
		const reportedLegs: string[] = [];
		const renderPage: RenderPage = async ({ url, egress }) => {
			navigated.push(url);
			const outcome: RenderOutcome = egress.kind === "web-unlocker"
				? { kind: "rendered", html: RENDERED_HTML, finalUrl: url, httpStatus: 200, requests: oneRequest, resourceHosts: publisherDocument }
				: { kind: "blocked", httpStatus: 403, requests: oneRequest, resourceHosts: publisherDocument };
			return outcome;
		};
		const proxiedCrawlArticle: CrawlArticle = async ({ url }) => {
			fetched.push(url);
			return { status: "blocked", httpStatus: 403 };
		};
		const finalizeArticle: FinalizeArticle = async () => ({
			ok: true,
			article: { html: "<p>Rendered body</p>", metadata: { title: "Story", siteName: "publisher.example", excerpt: "Rendered body", wordCount: 120, estimatedReadTime: 1 } },
		});
		const render = initRenderCrawlHandler({
			resolveOriginalUrl: async (url) => url,
			prepareArticleIdentity: async (url) => ({ status: "resolved", url, originalUrl: TRACKER }),
			findAdoptedFetchUrl: async () => undefined,
			verifyWrapperSource: async ({ articleUrl, sourceUrl }) => ({ originalUrl: articleUrl, sourceUrl }),
			crawlArticle: async () => ({ status: "failed" }),
			proxiedCrawlArticle,
			finalizeArticle,
			putTierSource: async (source) => { stored.push(source.url); },
			updateFetchTimestamp: async () => {},
			transitionAndPersist: async () => {},
			markCrawlStage: async () => {},
			consumeRenderCrawlBudget: async () => ({ allowed: true, consumed: true }),
			...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => new Date("2026-11-03T00:00:00.000Z") }),
			adoptCanonicalIdentity: async () => {},
			publishEvent,
			renderPage,
			reportProxiedRenderAttempt: ({ renderedThrough }) => { reportedLegs.push(renderedThrough); },
			residentialEgress: () => ({ kind: "residential", proxy: { server: "http://residential.example-egress.test:33335", username: "residential-user", password: "secret" } }),
			webUnlockerEgress: { kind: "web-unlocker", proxy: { server: "http://unlocker.example-egress.test:33335", username: "unlocker-user", password: "secret" } },
			now: () => new Date("2026-11-03T00:00:00.000Z"),
			logger: noopLogger,
			logParseError: () => {},
			logCrawlOutcome: () => {},
			readTierSnapshot: async () => ({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
		});
		const response = await render(sqsEventFrom(takeOne(published, RenderCrawlCommand.detailType)), { ...buildLambdaContext(), getRemainingTimeInMillis: () => 900_000 }, () => {});

		expect(response).toEqual({ batchItemFailures: [] });
		expect(navigated).toEqual([PUBLISHER, PUBLISHER]);
		expect(fetched).toEqual([PUBLISHER]);
		expect(reportedLegs).toEqual(["web-unlocker-render"]);
		expect(stored).toEqual([TRACKER]);
		expect(JSON.parse(takeOne(published, TierContentExtractedEvent.detailType).body).detail).toEqual(expect.objectContaining({ url: TRACKER, userId: "user-1", saveAttemptId: "attempt-1" }));
	});
});
