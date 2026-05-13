import type { AggregateField, Article } from "@packages/domain/article-aggregate";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initDynamoDbArticleStore } from "./dynamodb-article-store";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(
	impl: (input: unknown) => unknown,
): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	};
}

const TABLE = "test-articles";
const URL = "https://example.com/article";
const PENDING_SINCE = "2026-05-10T12:00:00.000Z";
const REFRESH_WRITES: readonly AggregateField[] = [
	"metadata",
	"freshness",
	"summary",
];

function buildArticle(overrides: Partial<Article> = {}): Article {
	return {
		url: URL,
		metadata: {
			title: "New title",
			siteName: "Example",
			excerpt: "New excerpt",
			wordCount: 250,
			imageUrl: "https://example.com/image.jpg",
		},
		freshness: {
			etag: '"new-etag"',
			lastModified: "Sun, 10 May 2026 12:00:00 GMT",
			contentFetchedAt: "2026-05-10T12:00:00.000Z",
		},
		estimatedReadTime: 2,
		crawl: { kind: "ready" },
		summary: { kind: "pending", pendingSince: PENDING_SINCE },
		...overrides,
	};
}

describe("initDynamoDbArticleStore (unit)", () => {
	describe("load", () => {
		it("returns undefined when no row exists for the URL", async () => {
			const client = createFakeClient(() => ({ Item: undefined }));
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const article = await store.load(URL);

			expect(article).toBeUndefined();
		});

		it("maps a populated row into an Article aggregate", async () => {
			const client = createFakeClient(() => ({
				Item: {
					title: "Old title",
					siteName: "Example",
					excerpt: "Old excerpt",
					wordCount: 100,
					estimatedReadTime: 1,
					imageUrl: "https://example.com/img.jpg",
					etag: '"old-etag"',
					lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
					contentFetchedAt: "2026-01-01T00:00:00.000Z",
					crawlStatus: "ready",
					summaryStatus: "ready",
					summary: "Old summary",
					summaryExcerpt: "Old summary excerpt",
					summaryInputTokens: 1234,
					summaryOutputTokens: 567,
				},
			}));
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const article = await store.load(URL);

			expect(article).toEqual({
				url: URL,
				metadata: {
					title: "Old title",
					siteName: "Example",
					excerpt: "Old excerpt",
					wordCount: 100,
					imageUrl: "https://example.com/img.jpg",
				},
				freshness: {
					etag: '"old-etag"',
					lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
					contentFetchedAt: "2026-01-01T00:00:00.000Z",
				},
				estimatedReadTime: 1,
				crawl: { kind: "ready" },
				summary: {
					kind: "ready",
					summary: "Old summary",
					excerpt: "Old summary excerpt",
					inputTokens: 1234,
					outputTokens: 567,
				},
			});
		});

		it("maps a crawl-failed row into a failed crawl state with the persisted reason", async () => {
			const client = createFakeClient(() => ({
				Item: {
					crawlStatus: "failed",
					crawlFailureReason: "fetch timeout",
					summaryStatus: "pending",
					contentFetchedAt: "2026-01-01T00:00:00.000Z",
				},
			}));
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const article = await store.load(URL);

			expect(article?.crawl).toEqual({ kind: "failed", reason: "fetch timeout" });
		});

		it("maps a crawl-unsupported row into an unsupported crawl state", async () => {
			const client = createFakeClient(() => ({
				Item: {
					crawlStatus: "unsupported",
					crawlUnsupportedReason: "non-html content type: application/pdf",
					summaryStatus: "skipped",
					summarySkippedReason: "crawl-unsupported",
					contentFetchedAt: "2026-01-01T00:00:00.000Z",
				},
			}));
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const article = await store.load(URL);

			expect(article?.crawl).toEqual({
				kind: "unsupported",
				reason: "non-html content type: application/pdf",
			});
			expect(article?.summary).toEqual({
				kind: "skipped",
				reason: "crawl-unsupported",
			});
		});

		it("defaults missing fields to safe values so legacy rows load cleanly", async () => {
			const client = createFakeClient(() => ({ Item: {} }));
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const article = await store.load(URL);

			expect(article).toEqual({
				url: URL,
				metadata: {
					title: "",
					siteName: "",
					excerpt: "",
					wordCount: 0,
				},
				freshness: { contentFetchedAt: "" },
				estimatedReadTime: 0,
				crawl: { kind: "pending", pendingSince: "1970-01-01T00:00:00.000Z" },
				summary: { kind: "pending", pendingSince: "1970-01-01T00:00:00.000Z" },
			});
		});

		it("maps a summary-failed row into a failed summary state with the persisted reason", async () => {
			const client = createFakeClient(() => ({
				Item: {
					crawlStatus: "ready",
					summaryStatus: "failed",
					summaryFailureReason: "rate limited",
					contentFetchedAt: "2026-01-01T00:00:00.000Z",
				},
			}));
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const article = await store.load(URL);

			expect(article?.summary).toEqual({ kind: "failed", reason: "rate limited" });
		});

		it("maps a summary-skipped row without a reason to a skipped state with no reason", async () => {
			const client = createFakeClient(() => ({
				Item: {
					crawlStatus: "ready",
					summaryStatus: "skipped",
					contentFetchedAt: "2026-01-01T00:00:00.000Z",
				},
			}));
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const article = await store.load(URL);

			expect(article?.summary).toEqual({ kind: "skipped" });
		});

		it("normalizes the URL to derive the partition key but preserves the original on the aggregate", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return { Item: { contentFetchedAt: "2026-01-01T00:00:00.000Z" } };
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const article = await store.load("https://example.com/article?utm_source=x");

			const command = received as { input: { Key?: Record<string, unknown> } };
			expect(command.input.Key).toEqual({ url: "example.com/article" });
			expect(article?.url).toBe("https://example.com/article?utm_source=x");
		});

		it("hydrates pendingSince on the summary axis when the row carries the column", async () => {
			const client = createFakeClient(() => ({
				Item: {
					summaryStatus: "pending",
					summaryPendingSince: "2026-05-10T12:00:00.000Z",
					contentFetchedAt: "2026-05-10T12:00:00.000Z",
				},
			}));
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const article = await store.load(URL);

			expect(article?.summary).toEqual({
				kind: "pending",
				pendingSince: "2026-05-10T12:00:00.000Z",
			});
		});

		it("hydrates pendingSince on the crawl axis when the row carries the column", async () => {
			const client = createFakeClient(() => ({
				Item: {
					crawlStatus: "pending",
					crawlPendingSince: "2026-05-10T12:00:00.000Z",
					summaryStatus: "pending",
					summaryPendingSince: "2026-05-10T12:00:00.000Z",
					contentFetchedAt: "2026-05-10T12:00:00.000Z",
				},
			}));
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const article = await store.load(URL);

			expect(article?.crawl).toEqual({
				kind: "pending",
				pendingSince: "2026-05-10T12:00:00.000Z",
			});
		});
	});

	describe("save (refresh-content shape: writes metadata, freshness, summary)", () => {
		it("issues an UpdateItem that writes metadata, freshness, estimatedReadTime, and resets summary to pending", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle(),
				transitionName: "refreshContent",
				writes: REFRESH_WRITES,
			});

			const command = received as {
				input: {
					Key?: Record<string, unknown>;
					UpdateExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.Key).toEqual({ url: "example.com/article" });
			expect(command.input.UpdateExpression).toContain("title = :title");
			expect(command.input.UpdateExpression).toContain("siteName = :siteName");
			expect(command.input.UpdateExpression).toContain("excerpt = :excerpt");
			expect(command.input.UpdateExpression).toContain("wordCount = :wordCount");
			expect(command.input.UpdateExpression).toContain("estimatedReadTime = :ert");
			expect(command.input.UpdateExpression).toContain("contentFetchedAt = :cfa");
			expect(command.input.UpdateExpression).toContain("etag = :etag");
			expect(command.input.UpdateExpression).toContain("lastModified = :lm");
			expect(command.input.UpdateExpression).toContain("imageUrl = :img");
			expect(command.input.UpdateExpression).toContain(
				"summaryStatus = :summaryStatus",
			);
			expect(command.input.UpdateExpression).toContain("REMOVE summary");
			expect(command.input.UpdateExpression).toContain("summaryExcerpt");
			expect(command.input.UpdateExpression).toContain("summaryInputTokens");
			expect(command.input.UpdateExpression).toContain("summaryOutputTokens");
			expect(command.input.UpdateExpression).toContain("summaryStage");
			expect(command.input.UpdateExpression).toContain("summaryFailureReason");
			expect(command.input.UpdateExpression).toContain("summarySkippedReason");
			expect(command.input.ExpressionAttributeValues?.[":title"]).toBe(
				"New title",
			);
			expect(command.input.ExpressionAttributeValues?.[":summaryStatus"]).toBe(
				"pending",
			);
		});

		it("stamps summaryPendingSince when the summary axis is pending", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({
					summary: { kind: "pending", pendingSince: PENDING_SINCE },
				}),
				transitionName: "refreshContent",
				writes: REFRESH_WRITES,
			});

			const command = received as {
				input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.UpdateExpression).toContain(
				"summaryPendingSince = :summaryPendingSince",
			);
			expect(
				command.input.ExpressionAttributeValues?.[":summaryPendingSince"],
			).toBe(PENDING_SINCE);
		});

		it("removes summaryPendingSince when the summary axis transitions to ready", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({ summary: { kind: "ready", summary: "abc" } }),
				transitionName: "markSummaryReady",
				writes: ["summary"],
			});

			const command = received as { input: { UpdateExpression?: string } };
			expect(command.input.UpdateExpression).toContain(
				"summaryPendingSince",
			);
			expect(command.input.UpdateExpression).toMatch(/REMOVE.*summaryPendingSince/);
		});

		it("stamps crawlPendingSince when the crawl axis is pending", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({
					crawl: { kind: "pending", pendingSince: PENDING_SINCE },
				}),
				transitionName: "rePrimeCrawl",
				writes: ["crawl"],
			});

			const command = received as {
				input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.UpdateExpression).toContain(
				"crawlPendingSince = :crawlPendingSince",
			);
			expect(
				command.input.ExpressionAttributeValues?.[":crawlPendingSince"],
			).toBe(PENDING_SINCE);
		});

		it("removes crawlPendingSince when the crawl axis transitions to ready", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({ crawl: { kind: "ready" } }),
				transitionName: "recrawlTieKeptCanonical",
				writes: ["crawl"],
			});

			const command = received as { input: { UpdateExpression?: string } };
			expect(command.input.UpdateExpression).toMatch(/REMOVE.*crawlPendingSince/);
		});

		it("never touches crawl attributes when the transition does not declare a crawl write", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({ crawl: { kind: "failed", reason: "x" } }),
				transitionName: "refreshContent",
				writes: REFRESH_WRITES,
			});

			const command = received as {
				input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.UpdateExpression).not.toContain("crawlStatus");
			expect(command.input.UpdateExpression).not.toContain("crawlFailureReason");
			expect(command.input.UpdateExpression).not.toContain(
				"crawlUnsupportedReason",
			);
		});

		it("writes a ready summary with body, excerpt, and tokens", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({
					summary: {
						kind: "ready",
						summary: "abc",
						excerpt: "abridged",
						inputTokens: 100,
						outputTokens: 50,
					},
				}),
				transitionName: "refreshContent",
				writes: REFRESH_WRITES,
			});

			const command = received as {
				input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.UpdateExpression).toContain("summary = :summary");
			expect(command.input.UpdateExpression).toContain(
				"summaryExcerpt = :summaryExcerpt",
			);
			expect(command.input.UpdateExpression).toContain(
				"summaryInputTokens = :summaryInputTokens",
			);
			expect(command.input.UpdateExpression).toContain(
				"summaryOutputTokens = :summaryOutputTokens",
			);
			expect(command.input.UpdateExpression).toContain(
				"REMOVE summaryFailureReason, summarySkippedReason",
			);
			expect(command.input.ExpressionAttributeValues?.[":summary"]).toBe("abc");
			expect(command.input.ExpressionAttributeValues?.[":summaryStatus"]).toBe(
				"ready",
			);
			expect(command.input.ExpressionAttributeValues?.[":summaryInputTokens"]).toBe(
				100,
			);
			expect(command.input.ExpressionAttributeValues?.[":summaryOutputTokens"]).toBe(
				50,
			);
		});

		it("writes a ready summary with null excerpt/tokens when those fields are omitted", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({ summary: { kind: "ready", summary: "abc" } }),
				transitionName: "refreshContent",
				writes: REFRESH_WRITES,
			});

			const command = received as {
				input: { ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.ExpressionAttributeValues?.[":summaryExcerpt"]).toBeNull();
			expect(
				command.input.ExpressionAttributeValues?.[":summaryInputTokens"],
			).toBeNull();
			expect(
				command.input.ExpressionAttributeValues?.[":summaryOutputTokens"],
			).toBeNull();
		});

		it("writes a failed summary with status, reason, and clears any prior skipped marker", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({
					summary: { kind: "failed", reason: "rate limited" },
				}),
				transitionName: "refreshContent",
				writes: REFRESH_WRITES,
			});

			const command = received as {
				input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.UpdateExpression).toContain(
				"summaryFailureReason = :summaryFailureReason",
			);
			expect(command.input.UpdateExpression).toContain(
				"REMOVE summarySkippedReason",
			);
			expect(command.input.ExpressionAttributeValues?.[":summaryStatus"]).toBe(
				"failed",
			);
			expect(
				command.input.ExpressionAttributeValues?.[":summaryFailureReason"],
			).toBe("rate limited");
		});

		it("writes a skipped summary with reason and clears any prior failure marker", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({
					summary: { kind: "skipped", reason: "content-too-short" },
				}),
				transitionName: "refreshContent",
				writes: REFRESH_WRITES,
			});

			const command = received as {
				input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.UpdateExpression).toContain(
				"summarySkippedReason = :summarySkippedReason",
			);
			expect(command.input.UpdateExpression).toContain(
				"REMOVE summaryFailureReason",
			);
			expect(command.input.ExpressionAttributeValues?.[":summaryStatus"]).toBe(
				"skipped",
			);
			expect(
				command.input.ExpressionAttributeValues?.[":summarySkippedReason"],
			).toBe("content-too-short");
		});

		it("writes a skipped summary without reason and removes both reason attributes", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({ summary: { kind: "skipped" } }),
				transitionName: "refreshContent",
				writes: REFRESH_WRITES,
			});

			const command = received as {
				input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.UpdateExpression).toContain(
				"REMOVE summarySkippedReason, summaryFailureReason",
			);
			expect(
				command.input.ExpressionAttributeValues?.[":summarySkippedReason"],
			).toBeUndefined();
		});

		it("encodes missing freshness fields as nulls so DynamoDB stores them as null (not the prior value)", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({
					freshness: { contentFetchedAt: "2026-05-10T12:00:00.000Z" },
					metadata: {
						title: "x",
						siteName: "x",
						excerpt: "x",
						wordCount: 1,
					},
				}),
				transitionName: "refreshContent",
				writes: REFRESH_WRITES,
			});

			const command = received as {
				input: { ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.ExpressionAttributeValues?.[":etag"]).toBeNull();
			expect(command.input.ExpressionAttributeValues?.[":lm"]).toBeNull();
			expect(command.input.ExpressionAttributeValues?.[":img"]).toBeNull();
		});
	});

	describe("save (canary marker)", () => {
		it("always writes aggregateTransitionName so the check-stuck-articles scan can attribute the row", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle(),
				transitionName: "markCrawlExhausted",
				writes: ["crawl", "summary"],
			});

			const command = received as {
				input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.UpdateExpression).toContain(
				"aggregateTransitionName = :atn",
			);
			expect(command.input.ExpressionAttributeValues?.[":atn"]).toBe(
				"markCrawlExhausted",
			);
		});
	});

	describe("save (markCrawlExhausted shape: writes crawl, summary)", () => {
		it("writes crawlStatus=failed with the supplied reason and clears crawlUnsupportedReason", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({
					crawl: { kind: "failed", reason: "exceeded SQS maxReceiveCount" },
					summary: { kind: "failed", reason: "crawl failed" },
				}),
				transitionName: "markCrawlExhausted",
				writes: ["crawl", "summary"],
			});

			const command = received as {
				input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.UpdateExpression).toContain(
				"crawlStatus = :crawlStatus",
			);
			expect(command.input.UpdateExpression).toContain(
				"crawlFailureReason = :crawlFailureReason",
			);
			expect(command.input.UpdateExpression).toContain(
				"REMOVE",
			);
			expect(command.input.UpdateExpression).toContain("crawlUnsupportedReason");
			expect(command.input.ExpressionAttributeValues?.[":crawlStatus"]).toBe(
				"failed",
			);
			expect(
				command.input.ExpressionAttributeValues?.[":crawlFailureReason"],
			).toBe("exceeded SQS maxReceiveCount");
		});

		it("writes summaryStatus=failed with 'crawl failed' reason when both axes mark failed together", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({
					crawl: { kind: "failed", reason: "x" },
					summary: { kind: "failed", reason: "crawl failed" },
				}),
				transitionName: "markCrawlExhausted",
				writes: ["crawl", "summary"],
			});

			const command = received as {
				input: { ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.ExpressionAttributeValues?.[":summaryStatus"]).toBe(
				"failed",
			);
			expect(
				command.input.ExpressionAttributeValues?.[":summaryFailureReason"],
			).toBe("crawl failed");
		});

		it("does not touch metadata or freshness attributes when the transition only writes crawl + summary", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({
					crawl: { kind: "failed", reason: "x" },
					summary: { kind: "failed", reason: "crawl failed" },
				}),
				transitionName: "markCrawlExhausted",
				writes: ["crawl", "summary"],
			});

			const command = received as {
				input: { UpdateExpression?: string };
			};
			expect(command.input.UpdateExpression).not.toContain("title = :title");
			expect(command.input.UpdateExpression).not.toContain(
				"contentFetchedAt = :cfa",
			);
			expect(command.input.UpdateExpression).not.toContain("etag = :etag");
			expect(command.input.UpdateExpression).not.toContain("imageUrl = :img");
		});
	});

	describe("save (other crawl states, writes crawl)", () => {
		it("writes crawlStatus=unsupported with the supplied reason and clears crawlFailureReason", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({
					crawl: {
						kind: "unsupported",
						reason: "non-html content type: application/pdf",
					},
				}),
				transitionName: "markCrawlUnsupportedFromAggregate",
				writes: ["crawl"],
			});

			const command = received as {
				input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.UpdateExpression).toContain(
				"crawlUnsupportedReason = :crawlUnsupportedReason",
			);
			expect(command.input.UpdateExpression).toContain(
				"crawlFailureReason",
			);
			expect(command.input.ExpressionAttributeValues?.[":crawlStatus"]).toBe(
				"unsupported",
			);
			expect(
				command.input.ExpressionAttributeValues?.[":crawlUnsupportedReason"],
			).toBe("non-html content type: application/pdf");
		});

		it("writes crawlStatus=pending and removes both failure / unsupported reasons (a future re-prime transition's shape)", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({ crawl: { kind: "pending", pendingSince: PENDING_SINCE } }),
				transitionName: "rePrimeCrawl",
				writes: ["crawl"],
			});

			const command = received as {
				input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.UpdateExpression).toContain(
				"crawlStatus = :crawlStatus",
			);
			expect(command.input.UpdateExpression).toContain("crawlFailureReason");
			expect(command.input.UpdateExpression).toContain("crawlUnsupportedReason");
			expect(command.input.ExpressionAttributeValues?.[":crawlStatus"]).toBe(
				"pending",
			);
		});
	});

	describe("save (recrawl-tie-kept-canonical shape: writes crawl only)", () => {
		it("writes crawlStatus=ready and REMOVEs lingering failure / failedAt attributes", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({ crawl: { kind: "ready" } }),
				transitionName: "recrawlTieKeptCanonical",
				writes: ["crawl"],
			});

			const command = received as {
				input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
			};
			expect(command.input.UpdateExpression).toContain(
				"crawlStatus = :crawlStatus",
			);
			expect(command.input.UpdateExpression).toContain("crawlFailureReason");
			expect(command.input.UpdateExpression).toContain("crawlUnsupportedReason");
			expect(command.input.UpdateExpression).toContain("crawlFailedAt");
			expect(command.input.ExpressionAttributeValues?.[":crawlStatus"]).toBe(
				"ready",
			);
		});

		it("does not touch summary when only crawl is in writes (preserves a freshly-generated summary on recrawl)", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { store } = initDynamoDbArticleStore({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await store.save({
				article: buildArticle({
					crawl: { kind: "ready" },
					summary: { kind: "ready", summary: "kept" },
				}),
				transitionName: "recrawlTieKeptCanonical",
				writes: ["crawl"],
			});

			const command = received as {
				input: { UpdateExpression?: string };
			};
			expect(command.input.UpdateExpression).not.toContain(
				"summaryStatus = :summaryStatus",
			);
			expect(command.input.UpdateExpression).not.toContain("summary = :summary");
		});
	});
});
