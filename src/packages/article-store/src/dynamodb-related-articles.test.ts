import assert from "node:assert/strict";
import { articleDestinationUrl } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { z } from "zod";
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
				state: "found",
				article: {
					crawlStatus: "ready",
					destinationUrl: articleDestinationUrl({ url: TARGET_URL, displayUrl: undefined }),
					title: "A real title",
					siteName: "Example",
					description: "The full TLDR of the piece.",
					hasStubMetadata: false,
					hasSummary: true,
				},
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
			assert(target.state === "found", "a crawled row resolves to a found target");
			expect(target.article.description).toBe("A TLDR");
			expect(target.article.hasSummary).toBe(false);
			const fallback = await withExcerptOnly.store.findRelatedTargetArticle(TARGET_URL);
			assert(fallback.state === "found", "a crawled row resolves to a found target");
			expect(fallback.article.description).toBe("An excerpt");
			expect(fallback.article.hasSummary).toBe(false);
		});

		it.each([
			{ originalUrl: "https://origin.example/target", displayUrl: "https://display.example/target", expected: "https://display.example/target" },
			{ originalUrl: "https://origin.example/target", displayUrl: undefined, expected: "https://origin.example/target" },
			{ originalUrl: undefined, displayUrl: undefined, expected: "example.com/target" },
		])("hydrates the target destination as $expected from the existing projection", async ({ originalUrl, displayUrl, expected }) => {
			const { store, sent } = build(() => ({ Item: {
				url: "example.com/target", originalUrl, displayUrl,
				title: "A real title", siteName: "Example", excerpt: "An excerpt", crawlStatus: "ready",
			} }));
			const lookup = await store.findRelatedTargetArticle(TARGET_URL);
			assert(lookup.state === "found");
			expect(lookup.article.destinationUrl).toBe(expected);
			expect(lookup.article.hasSummary).toBe(false);
			expect(sent).toHaveLength(1);
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
			assert(target.state === "found", "the row exists so a target must be found");
			expect(target.article.hasStubMetadata).toBe(true);
		});

		it.each([
			{ excerpt: "", expected: true },
			{ excerpt: "A page named after its site.", expected: false },
		])("flags a title equal to the site name as stub metadata only when the excerpt is empty: $excerpt", async ({ excerpt, expected }) => {
			const { store } = build(() => ({
				Item: {
					url: "example.com/target",
					originalUrl: TARGET_URL,
					title: "example.com",
					siteName: "example.com",
					excerpt,
					crawlStatus: "failed",
				},
			}));

			const target = await store.findRelatedTargetArticle(TARGET_URL);
			assert(target.state === "found", "the row exists so a target must be found");
			expect(target.article.hasStubMetadata).toBe(expected);
		});

		it("reports a purged article as purged, distinct from an absent row", async () => {
			const { store } = build(() => ({
				Item: {
					url: "example.com/target",
					title: "example.com",
					siteName: "example.com",
					excerpt: "",
					crawlStatus: "ready",
					purgedAt: AT.toISOString(),
				},
			}));

			expect(await store.findRelatedTargetArticle(TARGET_URL)).toEqual({ state: "purged" });
		});

		it("reports a missing article row as absent", async () => {
			const { store } = build(() => ({ Item: undefined }));

			expect(await store.findRelatedTargetArticle(TARGET_URL)).toEqual({ state: "absent" });
		});

		it("reports a webmail page as not an article without reading its row", async () => {
			const { sent, store } = build(() => ({
				Item: {
					url: "mail.google.com/mail/u/2/",
					originalUrl: "https://mail.google.com/mail/u/2/",
					title: "Inbox (12) - private.person@example.com",
					siteName: "Gmail",
					excerpt: "A private message",
					summary: "Private inbox summary",
					crawlStatus: "ready",
				},
			}));

			expect(await store.findRelatedTargetArticle("https://mail.google.com/mail/u/2/")).toEqual({
				state: "not-an-article",
			});
			expect(sent).toEqual([]);
		});

		it("reports a half-written row whose metadata the crawl has not filled in yet as absent", async () => {
			const { store } = build(() => ({
				Item: {
					url: "example.com/target",
					originalUrl: TARGET_URL,
					crawlStatus: "pending",
				},
			}));

			expect(await store.findRelatedTargetArticle(TARGET_URL)).toEqual({ state: "absent" });
		});

		it.each([
			{ options: undefined, expected: undefined },
			{ options: { consistentRead: false }, expected: undefined },
			{ options: { consistentRead: true }, expected: true },
		])("sends ConsistentRead only when asked: $options", async ({ options, expected }) => {
			const { sent, store } = build(() => ({ Item: undefined }));

			await store.findRelatedTargetArticle(TARGET_URL, options);

			const get = sent[0];
			assert(get, "a get must have been issued");
			expect(get.input.ConsistentRead).toBe(expected);
		});

		it("returns when the article became readable as a Date", async () => {
			const { store } = build(() => ({
				Item: {
					url: "example.com/target",
					originalUrl: TARGET_URL,
					title: "A real title",
					siteName: "Example",
					excerpt: "An excerpt",
					crawlStatus: "ready",
					readerAvailableAt: AT.toISOString(),
				},
			}));

			const lookup = await store.findRelatedTargetArticle(TARGET_URL);
			assert(lookup.state === "found", "a crawled row resolves to a found target");
			expect(lookup.article.readerAvailableAt).toEqual(AT);
		});

		it("leaves readerAvailableAt undefined when the row has none", async () => {
			const { store } = build(() => ({
				Item: {
					url: "example.com/target",
					originalUrl: TARGET_URL,
					title: "A real title",
					siteName: "Example",
					excerpt: "An excerpt",
					crawlStatus: "failed",
				},
			}));

			const lookup = await store.findRelatedTargetArticle(TARGET_URL);
			assert(lookup.state === "found", "a crawled row resolves to a found target");
			expect(lookup.article.readerAvailableAt).toBeUndefined();
		});
	});

	describe("findSkippedNextReadSaves", () => {
		const OTHER_USER_ID = UserIdSchema.parse("00000000000000000000000000000002");
		const SKIPPED_AT = new Date("2026-08-03T09:00:00.000Z");

		it("queries the url index for skipped rows of the article", async () => {
			const { sent, store } = build(() => ({ Items: [] }));

			await store.findSkippedNextReadSaves(TARGET_URL);

			expect(sent).toEqual([
				{
					constructorName: "QueryCommand",
					input: {
						TableName: USER_ARTICLES_TABLE,
						IndexName: "url-index",
						KeyConditionExpression: "#url = :url",
						FilterExpression: "relatedStatus = :skipped",
						ExpressionAttributeNames: { "#url": "url" },
						ExpressionAttributeValues: {
							":url": "example.com/target",
							":skipped": "skipped",
						},
						ExclusiveStartKey: undefined,
					},
				},
			]);
		});

		it("follows LastEvaluatedKey across pages and returns each saver with when it was skipped", async () => {
			const pages = [
				{
					Items: [{ userId: USER_ID, url: "example.com/target", relatedStatus: "skipped", relatedComputedAt: SKIPPED_AT.toISOString() }],
					LastEvaluatedKey: { userId: USER_ID, url: "example.com/target" },
				},
				{
					Items: [{ userId: OTHER_USER_ID, url: "example.com/target", relatedStatus: "skipped", relatedComputedAt: AT.toISOString() }],
				},
			];
			let page = 0;
			const { sent, store } = build(() => {
				const current = pages[page];
				page += 1;
				assert(current, "the query asked for more pages than the test supplies");
				return current;
			});

			const saves = await store.findSkippedNextReadSaves(TARGET_URL);

			expect(saves).toEqual([
				{ userId: USER_ID, skippedAt: SKIPPED_AT },
				{ userId: OTHER_USER_ID, skippedAt: AT },
			]);
			expect(sent.map((command) => command.input.ExclusiveStartKey)).toEqual([
				undefined,
				{ userId: USER_ID, url: "example.com/target" },
			]);
		});

		it("throws on a skipped row without relatedComputedAt", async () => {
			const { store } = build(() => ({
				Items: [{ userId: USER_ID, url: "example.com/target", relatedStatus: "skipped" }],
			}));

			await expect(store.findSkippedNextReadSaves(TARGET_URL)).rejects.toThrow(
				"every Next-read skip write stamps relatedComputedAt",
			);
		});

		it("throws on a skipped row in a reading-list partition", async () => {
			const { store } = build(() => ({
				Items: [{
					userId: `${USER_ID}#queue/later`,
					url: "example.com/target",
					relatedStatus: "skipped",
					relatedComputedAt: SKIPPED_AT.toISOString(),
				}],
			}));

			await expect(store.findSkippedNextReadSaves(TARGET_URL)).rejects.toThrow(
				"Next read is written only on the default partition",
			);
		});
	});

	describe("replaceSkippedRelatedArticlesWithReady", () => {
		const params = {
			userId: USER_ID,
			url: TARGET_URL,
			relatedArticles: [{ url: "example.com/earlier", reason: "Same argument" }],
			inputTokens: 120,
			outputTokens: 30,
			at: AT,
		};

		it("replaces only a skipped row with the relations, the timestamp and the token counts", async () => {
			const { sent, store } = build(() => ({}));

			await store.replaceSkippedRelatedArticlesWithReady(params);

			expect(sent).toEqual([
				{
					constructorName: "UpdateCommand",
					input: {
						TableName: USER_ARTICLES_TABLE,
						Key: { userId: USER_ID, url: "example.com/target" },
						UpdateExpression:
							"SET relatedStatus = :status, relatedArticles = :articles, relatedComputedAt = :at, relatedInputTokens = :inputTokens, relatedOutputTokens = :outputTokens",
						ConditionExpression: "attribute_exists(savedAt) AND relatedStatus = :skipped",
						ExpressionAttributeValues: {
							":status": "ready",
							":articles": [{ url: "example.com/earlier", reason: "Same argument" }],
							":at": AT.toISOString(),
							":inputTokens": 120,
							":outputTokens": 30,
							":skipped": "skipped",
						},
					},
				},
			]);
		});

		it("reports a stored write when the guarded update lands", async () => {
			const { store } = build(() => ({}));

			await expect(store.replaceSkippedRelatedArticlesWithReady(params)).resolves.toBe("stored");
		});

		it("reports a row that is no longer skipped as superseded", async () => {
			const { store } = build(() => {
				throw new ConditionalCheckFailedException({ $metadata: {}, message: "not skipped" });
			});

			await expect(store.replaceSkippedRelatedArticlesWithReady(params)).resolves.toBe("superseded");
		});

		it("propagates any other write failure", async () => {
			const { store } = build(() => {
				throw new Error("throttled");
			});

			await expect(store.replaceSkippedRelatedArticlesWithReady(params)).rejects.toThrow("throttled");
		});
	});

	describe("replaceSkippedRelatedArticlesWithSkip", () => {
		const params = { userId: USER_ID, url: TARGET_URL, at: AT };

		it("replaces only a skipped row with a fresh skip timestamp and drops any relations", async () => {
			const { sent, store } = build(() => ({}));

			await store.replaceSkippedRelatedArticlesWithSkip(params);

			expect(sent).toEqual([
				{
					constructorName: "UpdateCommand",
					input: {
						TableName: USER_ARTICLES_TABLE,
						Key: { userId: USER_ID, url: "example.com/target" },
						UpdateExpression: "SET relatedStatus = :status, relatedComputedAt = :at REMOVE relatedArticles",
						ConditionExpression: "attribute_exists(savedAt) AND relatedStatus = :skipped",
						ExpressionAttributeValues: {
							":status": "skipped",
							":at": AT.toISOString(),
							":skipped": "skipped",
						},
					},
				},
			]);
		});

		it("reports a stored write when the guarded update lands", async () => {
			const { store } = build(() => ({}));

			await expect(store.replaceSkippedRelatedArticlesWithSkip(params)).resolves.toBe("stored");
		});

		it("reports a row that is no longer skipped as superseded", async () => {
			const { store } = build(() => {
				throw new ConditionalCheckFailedException({ $metadata: {}, message: "not skipped" });
			});

			await expect(store.replaceSkippedRelatedArticlesWithSkip(params)).resolves.toBe("superseded");
		});

		it("propagates any other write failure", async () => {
			const { store } = build(() => {
				throw new Error("throttled");
			});

			await expect(store.replaceSkippedRelatedArticlesWithSkip(params)).rejects.toThrow("throttled");
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
					destinationUrl: articleDestinationUrl({ url: "example.com/earlier", displayUrl: undefined }),
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

		it.each([
			{ originalUrl: "https://origin.example/earlier", displayUrl: "https://display.example/earlier", expected: "https://display.example/earlier" },
			{ originalUrl: "https://origin.example/earlier", displayUrl: undefined, expected: "https://origin.example/earlier" },
			{ originalUrl: undefined, displayUrl: undefined, expected: "example.com/earlier" },
		])("hydrates the candidate destination as $expected without another read", async ({ originalUrl, displayUrl, expected }) => {
			const { store, sent } = candidateClient({
				pages: [{ urls: ["example.com/earlier"] }],
				articles: [{ url: "example.com/earlier", originalUrl, displayUrl, title: "Earlier", siteName: "Example", excerpt: "An excerpt" }],
			});
			const result = await store.findRelatedCandidateArticles({ userId: USER_ID, excludeUrl: TARGET_URL, limit: 10 });
			expect(result.candidates.map((candidate) => candidate.destinationUrl)).toEqual([expected]);
			expect(sent).toHaveLength(2);
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

		it("drops saves of a webmail page, whether or not the row records its original URL", async () => {
			const { candidates } = await candidateClient({
				pages: [
					{
						urls: ["mail.google.com/mail/u/2/", "mail.google.com/mail/u/0/", "example.com/good"],
					},
				],
				articles: [
					{
						url: "mail.google.com/mail/u/2/",
						originalUrl: "https://mail.google.com/mail/u/2/#inbox",
						title: "Inbox (12) - private.person@example.com",
						siteName: "Gmail",
						excerpt: "A private message",
						summary: "Private inbox summary",
					},
					{
						url: "mail.google.com/mail/u/0/",
						title: "Inbox (3) - another.person@example.com",
						siteName: "Gmail",
						excerpt: "Another private message",
						summary: "Another private summary",
					},
					{ url: "example.com/good", title: "Good", siteName: "Example", excerpt: "" },
				],
			}).store.findRelatedCandidateArticles({
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
					destinationUrl: articleDestinationUrl({ url: "example.com/finished", displayUrl: undefined }),
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
								originalUrl: "https://example.com/first",
								routeId: "0123456789abcdef0123456789abcdef",
								title: "First",
								siteName: "Example",
								excerpt: "",
							},
							{
								url: "example.com/second",
								originalUrl: "https://example.com/second",
								routeId: "fedcba9876543210fedcba9876543210",
								title: "Second",
								siteName: "Example",
								excerpt: "",
							},
							{
								url: "example.com/finished",
								originalUrl: "https://example.com/finished",
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

		it("names a relation that redirected across hosts after its destination, not the saved link's host", async () => {
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							relatedStatus: "ready",
							relatedArticles: [{ url: "nodeweekly.com/link/190528", reason: "Same event" }],
						},
					};
				}
				const requestItems = (command.input as { RequestItems: Record<string, unknown> }).RequestItems;
				if (Object.keys(requestItems)[0] === USER_ARTICLES_TABLE) {
					return {
						Responses: {
							[USER_ARTICLES_TABLE]: [
								{ url: "nodeweekly.com/link/190528", status: "unread", savedAt: "2026-06-01T00:00:00.000Z" },
							],
						},
						UnprocessedKeys: {},
					};
				}
				return {
					Responses: {
						[ARTICLES_TABLE]: [
							{
								url: "nodeweekly.com/link/190528",
								originalUrl: "https://nodeweekly.com/link/190528",
								displayUrl: "https://memcached.org/",
								routeId: "0123456789abcdef0123456789abcdef",
								title: "Article from nodeweekly.com",
								siteName: "nodeweekly.com",
								excerpt: "",
							},
						],
					},
					UnprocessedKeys: {},
				};
			});

			const result = await store.findRelatedArticles({ userId: USER_ID, url: TARGET_URL });

			assert(result.status === "ready", "a computed row reports ready");
			expect(result.items.map((item) => ({ title: item.title, siteName: item.siteName }))).toEqual([
				{ title: "Article from memcached.org", siteName: "memcached.org" },
			]);
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
								originalUrl: "https://example.com/finished",
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

		it("never reads an article row when every relation has left the reader's readlist", async () => {
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
								originalUrl: "https://example.com/purged",
								routeId: "11111111111111111111111111111111",
								title: "Purged",
								siteName: "Example",
								excerpt: "",
								purgedAt: AT.toISOString(),
							},
							{
								url: "example.com/kept",
								originalUrl: "https://example.com/kept",
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

		it("drops a relation to a webmail page", async () => {
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							relatedStatus: "ready",
							relatedArticles: [
								{ url: "mail.google.com/mail/u/2/", reason: "Inbox" },
								{ url: "example.com/kept", reason: "Same argument" },
							],
						},
					};
				}
				const tableName = Object.keys(
					z.object({ RequestItems: z.record(z.string(), z.unknown()) }).parse(command.input).RequestItems,
				)[0];
				if (tableName === USER_ARTICLES_TABLE) {
					return {
						Responses: {
							[USER_ARTICLES_TABLE]: [
								{ url: "mail.google.com/mail/u/2/", status: "unread", savedAt: "2026-06-01T00:00:00.000Z" },
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
								url: "mail.google.com/mail/u/2/",
								originalUrl: "https://mail.google.com/mail/u/2/#inbox",
								routeId: "11111111111111111111111111111111",
								title: "Inbox (12) - private.person@example.com",
								siteName: "Gmail",
								excerpt: "",
							},
							{
								url: "example.com/kept",
								originalUrl: "https://example.com/kept",
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
			expect(result.items.map((item) => item.title)).toEqual(["Kept"]);
		});

		describe("copies of the saved article and repeated picks", () => {
			const BatchGetInput = z.object({
				RequestItems: z.record(z.string(), z.object({ Keys: z.array(z.object({ url: z.string() })) })),
			});

			function pickClient(params: {
				links: { url: string; reason: string }[];
				saved: Record<string, unknown>[];
				articles: Record<string, unknown>[];
			}) {
				const articleKeys: string[][] = [];
				const built = build((command) => {
					if (command.constructorName === "GetCommand") {
						return {
							Item: {
								userId: USER_ID,
								url: "example.com/target",
								relatedStatus: "ready",
								relatedArticles: params.links,
							},
						};
					}
					const requestItems = BatchGetInput.parse(command.input).RequestItems;
					const userArticleKeys = requestItems[USER_ARTICLES_TABLE];
					if (userArticleKeys) {
						return { Responses: { [USER_ARTICLES_TABLE]: params.saved }, UnprocessedKeys: {} };
					}
					const keys = requestItems[ARTICLES_TABLE];
					assert(keys, "the only other batch read is the articles table");
					articleKeys.push(keys.Keys.map((key) => key.url));
					return { Responses: { [ARTICLES_TABLE]: params.articles }, UnprocessedKeys: {} };
				});
				return { ...built, articleKeys };
			}

			function unreadSave(url: string) {
				return { url, status: "unread", savedAt: "2026-06-01T00:00:00.000Z" };
			}

			it("reads the saved article in the same batch as its picks and hides every copy of it, by title or by destination", async () => {
				const { store, articleKeys } = pickClient({
					links: [
						{ url: "javascriptweekly.com/link/1001/web", reason: "The same release" },
						{ url: "nodeweekly.com/link/2002/web", reason: "The same post again" },
						{ url: "example.com/release-notes", reason: "Covers the next version" },
					],
					saved: [
						unreadSave("javascriptweekly.com/link/1001/web"),
						unreadSave("nodeweekly.com/link/2002/web"),
						unreadSave("example.com/release-notes"),
					],
					articles: [
						{ url: "example.com/target", title: "Widgets 4.0 Is Out", siteName: "Example", excerpt: "" },
						{
							url: "javascriptweekly.com/link/1001/web",
							originalUrl: "https://javascriptweekly.com/link/1001/web",
							routeId: "11111111111111111111111111111111",
							title: "  widgets 4.0   is out ",
							siteName: "javascriptweekly.com",
							excerpt: "",
						},
						{
							url: "nodeweekly.com/link/2002/web",
							originalUrl: "https://nodeweekly.com/link/2002/web",
							displayUrl: "https://www.example.com/target/#changelog",
							routeId: "22222222222222222222222222222222",
							title: "Announcing the widgets release",
							siteName: "nodeweekly.com",
							excerpt: "",
						},
						{
							url: "example.com/release-notes",
							originalUrl: "https://example.com/release-notes",
							routeId: "33333333333333333333333333333333",
							title: "Widgets 4.1 release notes",
							siteName: "Example",
							excerpt: "",
						},
					],
				});

				const result = await store.findRelatedArticles({ userId: USER_ID, url: TARGET_URL });

				assert(result.status === "ready", "a computed row reports ready");
				expect(result.items.map((item) => item.title)).toEqual(["Widgets 4.1 release notes"]);
				expect(articleKeys).toEqual([
					[
						"javascriptweekly.com/link/1001/web",
						"nodeweekly.com/link/2002/web",
						"example.com/release-notes",
						"example.com/target",
					],
				]);
			});

			it("reports ready with no items when every pick is a copy of the saved article", async () => {
				const { store } = pickClient({
					links: [{ url: "nodeweekly.com/link/2002/web", reason: "The same post" }],
					saved: [unreadSave("nodeweekly.com/link/2002/web")],
					articles: [
						{
							url: "example.com/target",
							originalUrl: "https://example.com/target",
							routeId: "00000000000000000000000000000000",
							title: "Widgets 4.0 is out",
							siteName: "Example",
							excerpt: "",
						},
						{
							url: "nodeweekly.com/link/2002/web",
							originalUrl: "https://nodeweekly.com/link/2002/web",
							routeId: "22222222222222222222222222222222",
							title: "Widgets 4.0 is out",
							siteName: "nodeweekly.com",
							excerpt: "",
						},
					],
				});

				expect(await store.findRelatedArticles({ userId: USER_ID, url: TARGET_URL })).toEqual({
					status: "ready",
					items: [],
				});
			});

			it("keeps the first copy of a repeated pick in rank order, even when the saved article's row is gone", async () => {
				const { store } = pickClient({
					links: [
						{ url: "nodeweekly.com/link/2002/web", reason: "First copy" },
						{ url: "javascriptweekly.com/link/1001/web", reason: "Second copy" },
						{ url: "example.com/release-notes", reason: "Next version" },
					],
					saved: [
						unreadSave("nodeweekly.com/link/2002/web"),
						unreadSave("javascriptweekly.com/link/1001/web"),
						unreadSave("example.com/release-notes"),
					],
					articles: [
						{
							url: "nodeweekly.com/link/2002/web",
							originalUrl: "https://nodeweekly.com/link/2002/web",
							routeId: "22222222222222222222222222222222",
							title: "Publishing packages safely",
							siteName: "nodeweekly.com",
							excerpt: "",
						},
						{
							url: "javascriptweekly.com/link/1001/web",
							originalUrl: "https://javascriptweekly.com/link/1001/web",
							routeId: "11111111111111111111111111111111",
							title: "Publishing Packages Safely",
							siteName: "javascriptweekly.com",
							excerpt: "",
						},
						{
							url: "example.com/release-notes",
							originalUrl: "https://example.com/release-notes",
							routeId: "33333333333333333333333333333333",
							title: "Widgets 4.1 release notes",
							siteName: "Example",
							excerpt: "",
						},
					],
				});

				const result = await store.findRelatedArticles({ userId: USER_ID, url: TARGET_URL });

				assert(result.status === "ready", "a computed row reports ready");
				expect(result.items.map((item) => ({ title: item.title, reason: item.reason }))).toEqual([
					{ title: "Publishing packages safely", reason: "First copy" },
					{ title: "Widgets 4.1 release notes", reason: "Next version" },
				]);
			});

			it("lets a pick the reader deleted or whose article was purged leave its later copy in place", async () => {
				const { store } = pickClient({
					links: [
						{ url: "example.com/deleted-copy", reason: "Deleted copy" },
						{ url: "example.com/purged-copy", reason: "Purged copy" },
						{ url: "nodeweekly.com/link/2002/web", reason: "Live copy" },
					],
					saved: [unreadSave("example.com/purged-copy"), unreadSave("nodeweekly.com/link/2002/web")],
					articles: [
						{
							url: "example.com/deleted-copy",
							originalUrl: "https://example.com/deleted-copy",
							routeId: "00000000000000000000000000000000",
							title: "Publishing packages safely",
							siteName: "Example",
							excerpt: "",
						},
						{
							url: "example.com/purged-copy",
							originalUrl: "https://example.com/purged-copy",
							routeId: "11111111111111111111111111111111",
							title: "Publishing packages safely",
							siteName: "Example",
							excerpt: "",
							purgedAt: AT.toISOString(),
						},
						{
							url: "nodeweekly.com/link/2002/web",
							originalUrl: "https://nodeweekly.com/link/2002/web",
							routeId: "22222222222222222222222222222222",
							title: "Publishing packages safely",
							siteName: "nodeweekly.com",
							excerpt: "",
						},
					],
				});

				const result = await store.findRelatedArticles({ userId: USER_ID, url: TARGET_URL });

				assert(result.status === "ready", "a computed row reports ready");
				expect(result.items.map((item) => item.reason)).toEqual(["Live copy"]);
			});
		});
	});
});
