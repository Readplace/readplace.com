import type { Article, TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted, markSummaryPending } from "@packages/domain/article-aggregate";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { TierContentExtractedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { type HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { ClassifiedCrawlError } from "../save-link/save-link-work";
import type { RunCrawlFromTier1 } from "../save-link/run-crawl-from-tier1";
import { initResolveArticleOnViewHandler } from "./resolve-article-on-view-handler";

const URL = "https://example.com/post";
const NOW = new Date("2026-11-05T10:00:00.000Z");
const ATTEMPT = SaveAttemptIdSchema.parse("attempt-1");

function article(axes: { crawl: Article["crawl"]; summary: Article["summary"] }): Article {
	return {
		url: URL,
		metadata: { title: "Title", siteName: "example.com", excerpt: "x", wordCount: 10 },
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
		estimatedReadTime: 1,
		crawl: axes.crawl,
		summary: axes.summary,
		summaryAutoHeal: { attempts: 0 },
	};
}

const PENDING = { kind: "pending", pendingSince: "2026-11-05T09:00:00.000Z" } as const;
const SKIPPED = { kind: "skipped", reason: "awaiting-reader" } as const;

function commandBody(axes: "crawl-and-summary" | "summary"): string {
	return JSON.stringify({
		"detail-type": "ResolveArticleOnViewCommand",
		detail: { url: URL, saveAttemptId: ATTEMPT, axes, surface: "reader" },
	});
}

function createHandler(overrides: {
	stored?: Article;
	runCrawlFromTier1?: RunCrawlFromTier1;
	transitionAndPersist?: TransitionAndPersist;
} = {}) {
	const transitions: Array<{ transition: unknown; params: unknown }> = [];
	const published: Array<{ detailType: string; detail: unknown }> = [];
	const crawls: Array<Parameters<RunCrawlFromTier1>[0]> = [];
	const infos: unknown[][] = [];
	const logger: HutchLogger = { ...noopLogger, info: (...args: unknown[]) => { infos.push(args); } };
	const publishEvent: PublishEvent = async (event, detail) => {
		published.push({ detailType: event.detailType, detail });
	};
	const transitionAndPersist: TransitionAndPersist = overrides.transitionAndPersist ?? (async (transition, params) => {
		transitions.push({ transition, params });
	});
	const runCrawlFromTier1: RunCrawlFromTier1 = async (params) => {
		crawls.push(params);
		return overrides.runCrawlFromTier1 === undefined
			? { candidates: [], liveAttempt: { outcome: "body" } }
			: overrides.runCrawlFromTier1(params);
	};
	const handler = initResolveArticleOnViewHandler({
		loadArticle: async (url) => (url === URL ? overrides.stored : undefined),
		transitionAndPersist,
		runCrawlFromTier1,
		publishEvent,
		now: () => NOW,
		logger,
	});
	const run = (bodies: string[]) =>
		handler(buildSqsEvent(bodies.map((body, index) => ({ messageId: `m-${index}`, body }))), buildLambdaContext(), () => {});
	return { run, transitions, published, crawls, infos };
}

describe("initResolveArticleOnViewHandler", () => {
	it("re-primes a pending summary so its generate-summary command is dispatched, and logs the dispatch", async () => {
		const { run, transitions, crawls, infos } = createHandler({ stored: article({ crawl: { kind: "ready" }, summary: PENDING }) });

		const result = await run([commandBody("summary")]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitions).toEqual([{ transition: markSummaryPending, params: { url: URL, input: { now: NOW.toISOString() } } }]);
		expect(crawls).toEqual([]);
		expect(infos[0]).toEqual(["[ResolveOnView] dispatched", { url: URL, surface: "reader", axes: "summary" }]);
	});

	it("acks a summary command whose row already moved on", async () => {
		const { run, transitions } = createHandler({ stored: article({ crawl: { kind: "ready" }, summary: SKIPPED }) });

		const result = await run([commandBody("summary")]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitions).toEqual([]);
	});

	it("acks a command for an article that no longer exists", async () => {
		const { run, transitions, crawls } = createHandler();

		const result = await run([commandBody("crawl-and-summary")]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitions).toEqual([]);
		expect(crawls).toEqual([]);
	});

	it("acks a crawl command whose crawl already moved on", async () => {
		const { run, crawls } = createHandler({ stored: article({ crawl: { kind: "ready" }, summary: PENDING }) });

		const result = await run([commandBody("crawl-and-summary")]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(crawls).toEqual([]);
	});

	it("crawls a pending row as a first pass and publishes the extracted candidates", async () => {
		const { run, crawls, published } = createHandler({ stored: article({ crawl: PENDING, summary: PENDING }) });

		const result = await run([commandBody("crawl-and-summary")]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(crawls).toEqual([{ url: URL, saveAttemptId: ATTEMPT, recrawl: false, sourceOriginalUrl: undefined }]);
		expect(published).toEqual([{
			detailType: TierContentExtractedEvent.detailType,
			detail: { url: URL, saveAttemptId: ATTEMPT, candidates: [], liveAttempt: { outcome: "body" }, extractedAt: NOW.toISOString() },
		}]);
	});

	it("publishes nothing when the crawl deferred to the unsupported policy", async () => {
		const { run, published } = createHandler({
			stored: article({ crawl: PENDING, summary: PENDING }),
			runCrawlFromTier1: async () => undefined,
		});

		const result = await run([commandBody("crawl-and-summary")]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(published).toEqual([]);
	});

	it("terminalises a classified crawl failure in-process with its reason", async () => {
		const { run, transitions } = createHandler({
			stored: article({ crawl: PENDING, summary: PENDING }),
			runCrawlFromTier1: async () => {
				throw new ClassifiedCrawlError({ url: URL, message: "refused", crawlFailureReason: { kind: "fetch-failed", httpStatus: 403 } });
			},
		});

		const result = await run([commandBody("crawl-and-summary")]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitions).toEqual([{
			transition: markCrawlExhausted,
			params: { url: URL, input: { reason: { kind: "fetch-failed", httpStatus: 403 }, receiveCount: 1 } },
		}]);
	});

	it("fails the record on an unclassified crawl error so it retries", async () => {
		const { run } = createHandler({
			stored: article({ crawl: PENDING, summary: PENDING }),
			runCrawlFromTier1: async () => {
				throw new Error("socket hang up");
			},
		});

		const result = await run([commandBody("crawl-and-summary")]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});

	it("fails a malformed record", async () => {
		const { run } = createHandler();

		const result = await run(["not json"]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});
});
