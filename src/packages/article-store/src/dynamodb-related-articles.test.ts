import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { initDynamoDbRelatedArticles } from "./dynamodb-related-articles";

type SendFn = DynamoDBDocumentClient["send"];

interface SentCommand {
	constructorName: string;
	input: Record<string, unknown>;
}

function createFakeClient(
	impl: (command: SentCommand) => unknown,
): DynamoDBDocumentClient {
	return {
		send: (async (input: unknown) => {
			const command = input as { constructor: { name: string }; input: Record<string, unknown> };
			return impl({
				constructorName: command.constructor.name,
				input: command.input,
			});
		}) as unknown as SendFn,
	} as DynamoDBDocumentClient;
}

const ARTICLES_TABLE = "articles-table";
const USER_ARTICLES_TABLE = "user-articles-table";
const USER_ID = UserIdSchema.parse("00000000000000000000000000000001");
const TARGET_URL = "https://example.com/target";
const AT = new Date("2026-08-04T10:00:00.000Z");

function build(impl: (command: SentCommand) => unknown) {
	const sent: SentCommand[] = [];
	const store = initDynamoDbRelatedArticles({
		client: createFakeClient((command) => {
			sent.push(command);
			return impl(command);
		}),
		tableName: ARTICLES_TABLE,
		userArticlesTableName: USER_ARTICLES_TABLE,
	});
	return { sent, store };
}

describe("initDynamoDbRelatedArticles", () => {
	describe("markRelatedArticlesReady", () => {
		it("writes the relations, the timestamp and the token counts, guarded on the save still existing", async () => {
			const { sent, store } = build(() => ({}));

			await store.markRelatedArticlesReady({
				userId: USER_ID,
				url: TARGET_URL,
				relatedArticles: [{ url: "example.com/earlier", reason: "Same argument" }],
				inputTokens: 120,
				outputTokens: 30,
				at: AT,
			});

			const update = sent[0];
			assert(update, "an update must have been issued");
			expect(update.input.TableName).toBe(USER_ARTICLES_TABLE);
			expect(update.input.Key).toEqual({
				userId: USER_ID,
				url: "example.com/target",
			});
			expect(String(update.input.UpdateExpression)).toContain("relatedStatus = :status");
			expect(String(update.input.UpdateExpression)).toContain("relatedArticles = :articles");
			expect(String(update.input.ConditionExpression)).toContain("attribute_exists(savedAt)");
			expect(String(update.input.ConditionExpression)).toContain(
				"attribute_not_exists(relatedStatus)",
			);
			expect(update.input.ExpressionAttributeValues).toEqual({
				":status": "ready",
				":articles": [{ url: "example.com/earlier", reason: "Same argument" }],
				":at": AT.toISOString(),
				":inputTokens": 120,
				":outputTokens": 30,
			});
		});

		it("reports a stored write when the guarded update lands", async () => {
			const { store } = build(() => ({}));

			await expect(
				store.markRelatedArticlesReady({
					userId: USER_ID,
					url: TARGET_URL,
					relatedArticles: [],
					inputTokens: 0,
					outputTokens: 0,
					at: AT,
				}),
			).resolves.toBe("stored");
		});

		it("reports a row another invocation already settled as superseded", async () => {
			const { store } = build(() => {
				throw new ConditionalCheckFailedException({ $metadata: {}, message: "settled" });
			});

			await expect(
				store.markRelatedArticlesReady({
					userId: USER_ID,
					url: TARGET_URL,
					relatedArticles: [{ url: "https://example.com/earlier", reason: "Same argument" }],
					inputTokens: 120,
					outputTokens: 30,
					at: AT,
				}),
			).resolves.toBe("superseded");
		});

		it("treats a save deleted mid-computation as superseded", async () => {
			const { store } = build(() => {
				throw new ConditionalCheckFailedException({ $metadata: {}, message: "gone" });
			});

			await expect(
				store.markRelatedArticlesReady({
					userId: USER_ID,
					url: TARGET_URL,
					relatedArticles: [],
					inputTokens: 0,
					outputTokens: 0,
					at: AT,
				}),
			).resolves.toBe("superseded");
		});

		it("propagates any other write failure", async () => {
			const { store } = build(() => {
				throw new Error("throttled");
			});

			await expect(
				store.markRelatedArticlesReady({
					userId: USER_ID,
					url: TARGET_URL,
					relatedArticles: [],
					inputTokens: 0,
					outputTokens: 0,
					at: AT,
				}),
			).rejects.toThrow("throttled");
		});
	});

	describe("markRelatedArticlesSkipped", () => {
		it("records the skip and drops any earlier relations", async () => {
			const { sent, store } = build(() => ({}));

			const outcome = await store.markRelatedArticlesSkipped({
				userId: USER_ID,
				url: TARGET_URL,
				at: AT,
			});

			const update = sent[0];
			assert(update, "an update must have been issued");
			expect(String(update.input.UpdateExpression)).toContain("REMOVE relatedArticles");
			expect(update.input.ExpressionAttributeValues).toEqual({
				":status": "skipped",
				":at": AT.toISOString(),
			});
			expect(outcome).toBe("stored");
		});

		it("reports a row another invocation already settled as superseded", async () => {
			const { store } = build(() => {
				throw new ConditionalCheckFailedException({ $metadata: {}, message: "settled" });
			});

			await expect(
				store.markRelatedArticlesSkipped({ userId: USER_ID, url: TARGET_URL, at: AT }),
			).resolves.toBe("superseded");
		});
	});

	describe("findRelatedTargetArticle", () => {
		it("describes a fully crawled article by its summary when one exists", async () => {
			const { store } = build(() => ({
				Item: {
					url: "example.com/target",
					originalUrl: TARGET_URL,
					title: "A real title",
					siteName: "Example",
					excerpt: "An excerpt",
					summary: "The full TLDR of the piece.",
					summaryExcerpt: "A TLDR",
					crawlStatus: "ready",
				},
			}));

			expect(await store.findRelatedTargetArticle(TARGET_URL)).toEqual({
				crawlStatus: "ready",
				title: "A real title",
				siteName: "Example",
				description: "The full TLDR of the piece.",
				hasStubMetadata: false,
			});
		});

		it("falls back to the summary excerpt, then the crawl excerpt, when no summary exists", async () => {
			const { store } = build(() => ({
				Item: {
					url: "example.com/target",
					originalUrl: TARGET_URL,
					title: "A real title",
					siteName: "Example",
					excerpt: "An excerpt",
					summaryExcerpt: "A TLDR",
					crawlStatus: "ready",
				},
			}));

			const withExcerptOnly = build(() => ({
				Item: {
					url: "example.com/target",
					originalUrl: TARGET_URL,
					title: "A real title",
					siteName: "Example",
					excerpt: "An excerpt",
					crawlStatus: "ready",
				},
			}));

			const target = await store.findRelatedTargetArticle(TARGET_URL);
			expect(target?.description).toBe("A TLDR");
			const fallback = await withExcerptOnly.store.findRelatedTargetArticle(TARGET_URL);
			expect(fallback?.description).toBe("An excerpt");
		});

		it("flags the placeholder title a fresh save starts with as stub metadata", async () => {
			const { store } = build(() => ({
				Item: {
					url: "example.com/target",
					originalUrl: TARGET_URL,
					title: "Article from example.com",
					siteName: "example.com",
					excerpt: "Saved from example.com.",
					crawlStatus: "failed",
				},
			}));

			const target = await store.findRelatedTargetArticle(TARGET_URL);
			assert(target, "the row exists so a target must be returned");
			expect(target.hasStubMetadata).toBe(true);
		});

		it("treats a purged article as absent", async () => {
			const { store } = build(() => ({
				Item: {
					url: "example.com/target",
					originalUrl: TARGET_URL,
					title: "A real title",
					siteName: "Example",
					excerpt: "An excerpt",
					purgedAt: AT.toISOString(),
				},
			}));

			expect(await store.findRelatedTargetArticle(TARGET_URL)).toBeUndefined();
		});

		it("treats a missing article row as absent", async () => {
			const { store } = build(() => ({ Item: undefined }));

			expect(await store.findRelatedTargetArticle(TARGET_URL)).toBeUndefined();
		});
	});

	describe("findRelatedCandidateArticles", () => {
		function savedRows(urls: string[]): Record<string, unknown>[] {
			return urls.map((url) => ({ userId: USER_ID, url, savedAt: AT.toISOString() }));
		}

		function candidateClient(params: {
			pages: Array<{ urls: string[]; lastEvaluatedKey?: Record<string, unknown> }>;
			articles: Record<string, unknown>[];
		}) {
			let page = 0;
			return build((command) => {
				if (command.constructorName === "QueryCommand") {
					const current = params.pages[page];
					page += 1;
					assert(current, "the query asked for more pages than the test supplies");
					return {
						Items: savedRows(current.urls),
						LastEvaluatedKey: current.lastEvaluatedKey,
					};
				}
				return {
					Responses: { [ARTICLES_TABLE]: params.articles },
					UnprocessedKeys: {},
				};
			});
		}

		it("reads the user's newest saves, skipping the article being read", async () => {
			const { sent, store } = candidateClient({
				pages: [{ urls: ["example.com/target", "example.com/earlier"] }],
				articles: [
					{
						url: "example.com/earlier",
						title: "Earlier",
						siteName: "Example",
						excerpt: "Earlier excerpt",
						summary: "Earlier full summary.",
						summaryExcerpt: "Earlier TLDR",
					},
				],
			});

			const { candidates } = await store.findRelatedCandidateArticles({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 10,
			});

			expect(candidates).toEqual([
				{
					url: "example.com/earlier",
					title: "Earlier",
					siteName: "Example",
					description: "Earlier full summary.",
				},
			]);
			const query = sent[0];
			assert(query, "a query must have been issued");
			expect(query.input.IndexName).toBe("userId-savedAt-index");
			expect(query.input.ScanIndexForward).toBe(false);
			expect(query.input.FilterExpression).toBe("#status = :status");
			expect(query.input.ExpressionAttributeNames).toEqual({ "#status": "status" });
			expect(query.input.ExpressionAttributeValues).toEqual({
				":userId": USER_ID,
				":status": "unread",
			});
		});

		it("stops paging once the limit is filled", async () => {
			const { store } = candidateClient({
				pages: [
					{
						urls: ["example.com/a", "example.com/b"],
						lastEvaluatedKey: { userId: USER_ID },
					},
				],
				articles: [
					{ url: "example.com/a", title: "A", siteName: "Example", excerpt: "" },
					{ url: "example.com/b", title: "B", siteName: "Example", excerpt: "" },
				],
			});

			const { candidates } = await store.findRelatedCandidateArticles({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 2,
			});

			expect(candidates.map((candidate) => candidate.title)).toEqual(["A", "B"]);
		});

		it("follows the next page when the first one did not fill the limit", async () => {
			const { store } = candidateClient({
				pages: [
					{ urls: ["example.com/a"], lastEvaluatedKey: { userId: USER_ID } },
					{ urls: ["example.com/b"] },
				],
				articles: [
					{ url: "example.com/a", title: "A", siteName: "Example", excerpt: "" },
					{ url: "example.com/b", title: "B", siteName: "Example", excerpt: "" },
				],
			});

			const { candidates } = await store.findRelatedCandidateArticles({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 5,
			});

			expect(candidates.map((candidate) => candidate.title)).toEqual(["A", "B"]);
		});

		it("drops saves whose article was purged or never got a title", async () => {
			const { store } = candidateClient({
				pages: [
					{
						urls: [
							"example.com/purged",
							"example.com/untitled",
							"example.com/missing",
							"example.com/good",
						],
					},
				],
				articles: [
					{
						url: "example.com/purged",
						title: "Purged",
						siteName: "Example",
						excerpt: "",
						purgedAt: AT.toISOString(),
					},
					{ url: "example.com/untitled", siteName: "Example" },
					{ url: "example.com/good", title: "Good", siteName: "Example", excerpt: "" },
				],
			});

			const { candidates } = await store.findRelatedCandidateArticles({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 10,
			});

			expect(candidates.map((candidate) => candidate.title)).toEqual(["Good"]);
		});

		it("holds back saves whose crawl has not yet replaced the placeholder metadata", async () => {
			const { store } = candidateClient({
				pages: [{ urls: ["example.com/just-saved", "example.com/crawled"] }],
				articles: [
					{
						url: "example.com/just-saved",
						title: "Article from example.com",
						siteName: "example.com",
						excerpt: "Saved from example.com.",
						crawlStatus: "pending",
					},
					{ url: "example.com/crawled", title: "Crawled", siteName: "Example", excerpt: "" },
				],
			});

			const pool = await store.findRelatedCandidateArticles({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 10,
			});

			expect(pool.candidates.map((candidate) => candidate.title)).toEqual(["Crawled"]);
			expect(pool.awaitingCrawl).toBe(1);
		});

		it.each(["failed", "unsupported"] as const)(
			"drops a placeholder whose crawl terminally %sed without counting it as awaited, so a dead link can never hold a thin pool in retry",
			async (crawlStatus) => {
				const { store } = candidateClient({
					pages: [{ urls: ["example.com/dead-link", "example.com/crawled"] }],
					articles: [
						{
							url: "example.com/dead-link",
							title: "Article from example.com",
							siteName: "example.com",
							excerpt: "Saved from example.com.",
							crawlStatus,
						},
						{ url: "example.com/crawled", title: "Crawled", siteName: "Example", excerpt: "" },
					],
				});

				const pool = await store.findRelatedCandidateArticles({
					userId: USER_ID,
					excludeUrl: TARGET_URL,
					limit: 10,
				});

				expect(pool.candidates.map((candidate) => candidate.title)).toEqual(["Crawled"]);
				expect(pool.awaitingCrawl).toBe(0);
			},
		);

		it("returns nothing when the user has no other saves", async () => {
			const { store } = candidateClient({ pages: [{ urls: [] }], articles: [] });

			expect(
				await store.findRelatedCandidateArticles({
					userId: USER_ID,
					excludeUrl: TARGET_URL,
					limit: 10,
				}),
			).toEqual({ candidates: [], awaitingCrawl: 0 });
		});
	});

	describe("findRelatedReadCandidateArticles", () => {
		function readRows(urls: string[]): Record<string, unknown>[] {
			return urls.map((url) => ({
				userId: USER_ID,
				url,
				savedAt: AT.toISOString(),
			}));
		}

		function readCandidateClient(params: {
			pages: Array<{ urls: string[]; lastEvaluatedKey?: Record<string, unknown> }>;
			articles: Record<string, unknown>[];
		}) {
			let page = 0;
			return build((command) => {
				if (command.constructorName === "QueryCommand") {
					const current = params.pages[page];
					page += 1;
					assert(current, "the query asked for more pages than the test supplies");
					return {
						Items: readRows(current.urls),
						LastEvaluatedKey: current.lastEvaluatedKey,
					};
				}
				return {
					Responses: { [ARTICLES_TABLE]: params.articles },
					UnprocessedKeys: {},
				};
			});
		}

		it("reads the reader's most recently finished saves off the sparse read index, skipping the article being read", async () => {
			const { sent, store } = readCandidateClient({
				pages: [{ urls: ["example.com/target", "example.com/finished"] }],
				articles: [
					{
						url: "example.com/finished",
						title: "Finished",
						siteName: "Example",
						excerpt: "Finished excerpt",
						summary: "Finished full summary.",
					},
				],
			});

			const { candidates } = await store.findRelatedReadCandidateArticles({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 10,
			});

			expect(candidates).toEqual([
				{
					url: "example.com/finished",
					title: "Finished",
					siteName: "Example",
					description: "Finished full summary.",
				},
			]);
			const query = sent[0];
			assert(query, "a query must have been issued");
			expect({
				index: query.input.IndexName,
				forward: query.input.ScanIndexForward,
				filter: query.input.FilterExpression,
				values: query.input.ExpressionAttributeValues,
			}).toEqual({
				index: "userId-readAt-index",
				forward: false,
				filter: undefined,
				values: { ":userId": USER_ID },
			});
		});

		it("stops paging once the limit is filled", async () => {
			const { store } = readCandidateClient({
				pages: [
					{
						urls: ["example.com/a", "example.com/b"],
						lastEvaluatedKey: { userId: USER_ID },
					},
				],
				articles: [
					{ url: "example.com/a", title: "A", siteName: "Example", excerpt: "" },
					{ url: "example.com/b", title: "B", siteName: "Example", excerpt: "" },
				],
			});

			const { candidates } = await store.findRelatedReadCandidateArticles({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 2,
			});

			expect(candidates.map((candidate) => candidate.title)).toEqual(["A", "B"]);
		});

		it("follows the next page when the first one did not fill the limit", async () => {
			const { store } = readCandidateClient({
				pages: [
					{ urls: ["example.com/a"], lastEvaluatedKey: { userId: USER_ID } },
					{ urls: ["example.com/b"] },
				],
				articles: [
					{ url: "example.com/a", title: "A", siteName: "Example", excerpt: "" },
					{ url: "example.com/b", title: "B", siteName: "Example", excerpt: "" },
				],
			});

			const { candidates } = await store.findRelatedReadCandidateArticles({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 5,
			});

			expect(candidates.map((candidate) => candidate.title)).toEqual(["A", "B"]);
		});

		it("drops saves whose article was purged or never got a title", async () => {
			const { store } = readCandidateClient({
				pages: [
					{
						urls: [
							"example.com/purged",
							"example.com/untitled",
							"example.com/missing",
							"example.com/good",
						],
					},
				],
				articles: [
					{
						url: "example.com/purged",
						title: "Purged",
						siteName: "Example",
						excerpt: "",
						purgedAt: AT.toISOString(),
					},
					{ url: "example.com/untitled", siteName: "Example" },
					{ url: "example.com/good", title: "Good", siteName: "Example", excerpt: "" },
				],
			});

			const { candidates } = await store.findRelatedReadCandidateArticles({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 10,
			});

			expect(candidates.map((candidate) => candidate.title)).toEqual(["Good"]);
		});

		it("holds back finished saves whose crawl has not yet replaced the placeholder metadata", async () => {
			const { store } = readCandidateClient({
				pages: [{ urls: ["example.com/just-saved", "example.com/crawled"] }],
				articles: [
					{
						url: "example.com/just-saved",
						title: "Article from example.com",
						siteName: "example.com",
						excerpt: "Saved from example.com.",
						crawlStatus: "pending",
					},
					{ url: "example.com/crawled", title: "Crawled", siteName: "Example", excerpt: "" },
				],
			});

			const pool = await store.findRelatedReadCandidateArticles({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 10,
			});

			expect(pool.candidates.map((candidate) => candidate.title)).toEqual(["Crawled"]);
			expect(pool.awaitingCrawl).toBe(1);
		});

		it("returns nothing when the reader has finished nothing else", async () => {
			const { store } = readCandidateClient({ pages: [{ urls: [] }], articles: [] });

			expect(
				await store.findRelatedReadCandidateArticles({
					userId: USER_ID,
					excludeUrl: TARGET_URL,
					limit: 10,
				}),
			).toEqual({ candidates: [], awaitingCrawl: 0 });
		});
	});

	describe("findRelatedArticles", () => {
		it("reports pending while nothing has been computed", async () => {
			const { store } = build(() => ({ Item: { userId: USER_ID, url: "example.com/target" } }));

			expect(
				await store.findRelatedArticles({ userId: USER_ID, url: TARGET_URL }),
			).toEqual({ status: "pending" });
		});

		it("reports pending when the save row is gone", async () => {
			const { store } = build(() => ({ Item: undefined }));

			expect(
				await store.findRelatedArticles({ userId: USER_ID, url: TARGET_URL }),
			).toEqual({ status: "pending" });
		});

		it("reports a skip", async () => {
			const { store } = build(() => ({
				Item: { userId: USER_ID, url: "example.com/target", relatedStatus: "skipped" },
			}));

			expect(
				await store.findRelatedArticles({ userId: USER_ID, url: TARGET_URL }),
			).toEqual({ status: "skipped" });
		});

		it("reports an empty result without reading any article", async () => {
			const { sent, store } = build(() => ({
				Item: {
					userId: USER_ID,
					url: "example.com/target",
					relatedStatus: "ready",
					relatedArticles: [],
				},
			}));

			expect(
				await store.findRelatedArticles({ userId: USER_ID, url: TARGET_URL }),
			).toEqual({ status: "ready", items: [] });
			expect(sent).toHaveLength(1);
		});

		it("resolves every relation the reader still has, with its live read state and the stored order", async () => {
			let savedRowProjection: string | undefined;
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							relatedStatus: "ready",
							relatedArticles: [
								{ url: "example.com/second", reason: "Follow-up" },
								{ url: "example.com/finished", reason: "Already read" },
								{ url: "example.com/first", reason: "Same event" },
							],
						},
					};
				}
				const requestItems = (
					command.input as {
						RequestItems: Record<string, { ProjectionExpression: string }>;
					}
				).RequestItems;
				const tableName = Object.keys(requestItems)[0];
				if (tableName === USER_ARTICLES_TABLE) {
					savedRowProjection = requestItems[tableName].ProjectionExpression;
					return {
						Responses: {
							[USER_ARTICLES_TABLE]: [
								{ url: "example.com/second", status: "unread", savedAt: "2026-06-01T00:00:00.000Z" },
								{
									url: "example.com/finished",
									status: "read",
									savedAt: "2026-05-15T00:00:00.000Z",
									readAt: "2026-07-02T00:00:00.000Z",
								},
								{ url: "example.com/first", status: "unread", savedAt: "2026-05-01T00:00:00.000Z" },
							],
						},
						UnprocessedKeys: {},
					};
				}
				return {
					Responses: {
						[ARTICLES_TABLE]: [
							{
								url: "example.com/first",
								routeId: "0123456789abcdef0123456789abcdef",
								title: "First",
								siteName: "Example",
								excerpt: "",
							},
							{
								url: "example.com/second",
								routeId: "fedcba9876543210fedcba9876543210",
								title: "Second",
								siteName: "Example",
								excerpt: "",
							},
							{
								url: "example.com/finished",
								routeId: "33333333333333333333333333333333",
								title: "Finished",
								siteName: "Example",
								excerpt: "",
							},
						],
					},
					UnprocessedKeys: {},
				};
			});

			const result = await store.findRelatedArticles({ userId: USER_ID, url: TARGET_URL });

			assert(result.status === "ready", "a computed row reports ready");
			expect(
				result.items.map((item) => ({ ...item, id: item.id.value })),
			).toEqual([
				{
					id: "fedcba9876543210fedcba9876543210",
					title: "Second",
					siteName: "Example",
					reason: "Follow-up",
					status: "unread",
					savedAt: new Date("2026-06-01T00:00:00.000Z"),
				},
				{
					id: "33333333333333333333333333333333",
					title: "Finished",
					siteName: "Example",
					reason: "Already read",
					status: "read",
					savedAt: new Date("2026-05-15T00:00:00.000Z"),
					readAt: new Date("2026-07-02T00:00:00.000Z"),
				},
				{
					id: "0123456789abcdef0123456789abcdef",
					title: "First",
					siteName: "Example",
					reason: "Same event",
					status: "unread",
					savedAt: new Date("2026-05-01T00:00:00.000Z"),
				},
			]);
			expect(savedRowProjection).toContain("#status");
			expect(savedRowProjection).toContain("#readAt");
		});

		it("carries a read relation whose row predates the read timestamp without one", async () => {
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							relatedStatus: "ready",
							relatedArticles: [{ url: "example.com/finished", reason: "Already read" }],
						},
					};
				}
				const tableName = Object.keys(
					(command.input as { RequestItems: Record<string, unknown> }).RequestItems,
				)[0];
				if (tableName === USER_ARTICLES_TABLE) {
					return {
						Responses: {
							[USER_ARTICLES_TABLE]: [
								{ url: "example.com/finished", status: "read", savedAt: "2026-05-15T00:00:00.000Z" },
							],
						},
						UnprocessedKeys: {},
					};
				}
				return {
					Responses: {
						[ARTICLES_TABLE]: [
							{
								url: "example.com/finished",
								routeId: "33333333333333333333333333333333",
								title: "Finished",
								siteName: "Example",
								excerpt: "",
							},
						],
					},
					UnprocessedKeys: {},
				};
			});

			const result = await store.findRelatedArticles({ userId: USER_ID, url: TARGET_URL });

			assert(result.status === "ready", "a computed row reports ready");
			expect(
				result.items.map((item) => ({ ...item, id: item.id.value })),
			).toEqual([
				{
					id: "33333333333333333333333333333333",
					title: "Finished",
					siteName: "Example",
					reason: "Already read",
					status: "read",
					savedAt: new Date("2026-05-15T00:00:00.000Z"),
				},
			]);
		});

		it("never reads an article row when every relation has left the reader's queue", async () => {
			const { sent, store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							relatedStatus: "ready",
							relatedArticles: [{ url: "example.com/deleted", reason: "Gone" }],
						},
					};
				}
				return {
					Responses: { [USER_ARTICLES_TABLE]: [] },
					UnprocessedKeys: {},
				};
			});

			expect(
				await store.findRelatedArticles({ userId: USER_ID, url: TARGET_URL }),
			).toEqual({ status: "ready", items: [] });
			expect(sent.map((command) => command.constructorName)).toEqual([
				"GetCommand",
				"BatchGetCommand",
			]);
		});

		it("drops a relation whose article row has gone missing entirely", async () => {
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							relatedStatus: "ready",
							relatedArticles: [{ url: "example.com/vanished", reason: "Gone" }],
						},
					};
				}
				const tableName = Object.keys(
					(command.input as { RequestItems: Record<string, unknown> }).RequestItems,
				)[0];
				if (tableName === USER_ARTICLES_TABLE) {
					return {
						Responses: {
							[USER_ARTICLES_TABLE]: [
								{ url: "example.com/vanished", status: "unread", savedAt: "2026-06-01T00:00:00.000Z" },
							],
						},
						UnprocessedKeys: {},
					};
				}
				return { Responses: { [ARTICLES_TABLE]: [] }, UnprocessedKeys: {} };
			});

			expect(
				await store.findRelatedArticles({ userId: USER_ID, url: TARGET_URL }),
			).toEqual({ status: "ready", items: [] });
		});

		it("drops a relation the user has since deleted or whose article was purged", async () => {
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							relatedStatus: "ready",
							relatedArticles: [
								{ url: "example.com/deleted", reason: "Gone" },
								{ url: "example.com/purged", reason: "Purged" },
								{ url: "example.com/kept", reason: "Same argument" },
							],
						},
					};
				}
				const tableName = Object.keys(
					(command.input as { RequestItems: Record<string, unknown> }).RequestItems,
				)[0];
				if (tableName === USER_ARTICLES_TABLE) {
					return {
						Responses: {
							[USER_ARTICLES_TABLE]: [
								{ url: "example.com/purged", status: "unread", savedAt: "2026-06-01T00:00:00.000Z" },
								{ url: "example.com/kept", status: "unread", savedAt: "2026-05-20T00:00:00.000Z" },
							],
						},
						UnprocessedKeys: {},
					};
				}
				return {
					Responses: {
						[ARTICLES_TABLE]: [
							{
								url: "example.com/purged",
								routeId: "11111111111111111111111111111111",
								title: "Purged",
								siteName: "Example",
								excerpt: "",
								purgedAt: AT.toISOString(),
							},
							{
								url: "example.com/kept",
								routeId: "22222222222222222222222222222222",
								title: "Kept",
								siteName: "Example",
								excerpt: "",
							},
						],
					},
					UnprocessedKeys: {},
				};
			});

			const result = await store.findRelatedArticles({ userId: USER_ID, url: TARGET_URL });

			assert(result.status === "ready", "a computed row reports ready");
			expect(
				result.items.map((item) => ({ ...item, id: item.id.value })),
			).toEqual([
				{
					id: "22222222222222222222222222222222",
					title: "Kept",
					siteName: "Example",
					reason: "Same argument",
					status: "unread",
					savedAt: new Date("2026-05-20T00:00:00.000Z"),
				},
			]);
		});
	});
});
