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

		it("leaves a row another invocation already settled untouched", async () => {
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
			).resolves.toBeUndefined();
		});

		it("treats a save deleted mid-computation as a no-op", async () => {
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
			).resolves.toBeUndefined();
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

			await store.markRelatedArticlesSkipped({ userId: USER_ID, url: TARGET_URL, at: AT });

			const update = sent[0];
			assert(update, "an update must have been issued");
			expect(String(update.input.UpdateExpression)).toContain("REMOVE relatedArticles");
			expect(update.input.ExpressionAttributeValues).toEqual({
				":status": "skipped",
				":at": AT.toISOString(),
			});
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

			const candidates = await store.findRelatedCandidateArticles({
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

			const candidates = await store.findRelatedCandidateArticles({
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

			const candidates = await store.findRelatedCandidateArticles({
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

			const candidates = await store.findRelatedCandidateArticles({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 10,
			});

			expect(candidates.map((candidate) => candidate.title)).toEqual(["Good"]);
		});

		it("returns nothing when the user has no other saves", async () => {
			const { store } = candidateClient({ pages: [{ urls: [] }], articles: [] });

			expect(
				await store.findRelatedCandidateArticles({
					userId: USER_ID,
					excludeUrl: TARGET_URL,
					limit: 10,
				}),
			).toEqual([]);
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

		it("joins stored relations to their article metadata, preserving the stored order", async () => {
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							relatedStatus: "ready",
							relatedArticles: [
								{ url: "example.com/second", reason: "Follow-up" },
								{ url: "example.com/first", reason: "Same event" },
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
								{ url: "example.com/second" },
								{ url: "example.com/first" },
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
				},
				{
					id: "0123456789abcdef0123456789abcdef",
					title: "First",
					siteName: "Example",
					reason: "Same event",
				},
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
						Responses: { [USER_ARTICLES_TABLE]: [{ url: "example.com/vanished" }] },
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
								{ url: "example.com/purged" },
								{ url: "example.com/kept" },
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
				},
			]);
		});
	});
});
