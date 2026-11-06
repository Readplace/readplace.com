import { noopLogger } from "@packages/logger";
import type { Article } from "@packages/domain/article-aggregate";
import { markCrawlExhausted, markSummaryExhausted } from "@packages/domain/article-aggregate";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initSubmitLinkDlqHandler } from "./submit-link-dlq-handler";

const POST_URL = "https://example.com/post";

function commandBody(detail: Record<string, unknown>): string {
	return JSON.stringify({ "detail-type": "SubmitLinkCommand", detail });
}

function resolutionBody(url: string): string {
	return JSON.stringify({
		"detail-type": "ResolveArticleOnViewCommand",
		detail: { url, saveAttemptId: "attempt-1", axes: "crawl-and-summary", surface: "reader" },
	});
}

const PENDING = { kind: "pending", pendingSince: "2026-11-05T09:00:00.000Z" } as const;

function storedArticle(axes: { crawl: Article["crawl"]; summary: Article["summary"] }): Article {
	return {
		url: POST_URL,
		metadata: { title: "Title", siteName: "example.com", excerpt: "x", wordCount: 10 },
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
		estimatedReadTime: 1,
		crawl: axes.crawl,
		summary: axes.summary,
		summaryAutoHeal: { attempts: 0 },
	};
}

function createHandler(
	publishEvent = async () => {},
	stored?: Article,
): {
	published: Array<{ detailType: string; detail: unknown }>;
	transitions: Array<{ transition: unknown; params: unknown }>;
	run: (bodies: string[]) => ReturnType<ReturnType<typeof initSubmitLinkDlqHandler>>;
} {
	const published: Array<{ detailType: string; detail: unknown }> = [];
	const transitions: Array<{ transition: unknown; params: unknown }> = [];
	const handler = initSubmitLinkDlqHandler({
		publishEvent: async (event, detail) => {
			await publishEvent();
			published.push({ detailType: event.detailType, detail });
		},
		loadArticle: async (url) => (url === POST_URL ? stored : undefined),
		transitionAndPersist: async (transition, params) => {
			transitions.push({ transition, params });
		},
		logger: noopLogger,
	});
	const run = (bodies: string[]) =>
		handler(
			buildSqsEvent(bodies.map((body, index) => ({ messageId: `m-${index}`, body }))),
			buildLambdaContext(),
			() => {},
		);
	return { published, transitions, run };
}

describe("submitLinkDlqHandler", () => {
	it("publishes the save failure with the dead-lettered url and its receive count", async () => {
		const { published, run } = createHandler();

		const result = await run([commandBody({ url: POST_URL, userId: "user-1" })]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(published).toEqual([
			{
				detailType: "LinkQueueFailed",
				detail: {
					url: POST_URL,
					userId: "user-1",
					reason: "accept-retries-exhausted",
					receiveCount: 1,
				},
			},
		]);
	});

	it("publishes nothing for an anonymous command, which has no read model to correct", async () => {
		const { published, run } = createHandler();

		const result = await run([commandBody({ url: POST_URL })]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(published).toEqual([]);
	});

	it("fails a malformed record so its visibility is restored and the alarm can fire", async () => {
		const { published, run } = createHandler();

		const result = await run(["not json"]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		expect(published).toEqual([]);
	});

	it("fails the record when publishing throws", async () => {
		const { run } = createHandler(async () => {
			throw new Error("event bus unavailable");
		});

		const result = await run([commandBody({ url: POST_URL, userId: "user-1" })]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});

	it("fails a pending crawl with exhausted retries and acks the resolution", async () => {
		const { transitions, run } = createHandler(undefined, storedArticle({ crawl: PENDING, summary: PENDING }));

		const result = await run([resolutionBody(POST_URL)]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitions).toEqual([{
			transition: markCrawlExhausted,
			params: { url: POST_URL, input: { reason: { kind: "exhausted-retries", receiveCount: 1 }, receiveCount: 1 } },
		}]);
	});

	it("fails a pending summary with exhausted retries when the crawl already settled", async () => {
		const { transitions, run } = createHandler(undefined, storedArticle({ crawl: { kind: "ready" }, summary: PENDING }));

		const result = await run([resolutionBody(POST_URL)]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitions).toEqual([{
			transition: markSummaryExhausted,
			params: { url: POST_URL, input: { reason: { kind: "exhausted-retries", receiveCount: 1 }, receiveCount: 1 } },
		}]);
	});

	it("marks nothing and acks a resolution whose row moved on or is gone", async () => {
		const { transitions, run } = createHandler(undefined, storedArticle({ crawl: { kind: "ready" }, summary: { kind: "skipped" } }));

		const result = await run([resolutionBody(POST_URL), resolutionBody("https://example.com/gone")]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitions).toEqual([]);
	});

	it("fails a resolution whose detail cannot be read", async () => {
		const { transitions, run } = createHandler();

		const result = await run([JSON.stringify({ "detail-type": "ResolveArticleOnViewCommand", detail: {} })]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		expect(transitions).toEqual([]);
	});
});
