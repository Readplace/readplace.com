import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { initDynamoDbPastReads } from "./dynamodb-past-reads";

type SendFn = DynamoDBDocumentClient["send"];

interface SentCommand {
	constructorName: string;
	input: Record<string, unknown>;
}

function createFakeClient(impl: (command: SentCommand) => unknown): DynamoDBDocumentClient {
	return {
		send: (async (input: unknown) => {
			const command = input as {
				constructor: { name: string };
				input: Record<string, unknown>;
			};
			return impl({ constructorName: command.constructor.name, input: command.input });
		}) as unknown as SendFn,
	} as DynamoDBDocumentClient;
}

const ARTICLES_TABLE = "articles-table";
const USER_ARTICLES_TABLE = "user-articles-table";
const USER_ID = UserIdSchema.parse("00000000000000000000000000000001");
const WORK = ReadlistSlugSchema.parse("work");
const READING = ReadlistSlugSchema.parse("reading");
const TARGET_URL = "https://example.com/target";
const AT = new Date("2026-09-12T10:00:00.000Z");

function build(impl: (command: SentCommand) => unknown) {
	const sent: SentCommand[] = [];
	const store = initDynamoDbPastReads({
		client: createFakeClient((command) => {
			sent.push(command);
			return impl(command);
		}),
		tableName: ARTICLES_TABLE,
		userArticlesTableName: USER_ARTICLES_TABLE,
	});
	return { sent, store };
}

function isDefinitionsQuery(command: SentCommand): boolean {
	const values = command.input.ExpressionAttributeValues as Record<string, unknown> | undefined;
	return values?.[":prefix"] !== undefined;
}

function partitionOf(command: SentCommand): string {
	const values = command.input.ExpressionAttributeValues as Record<string, string>;
	return values[":userId"];
}

function tableOf(command: SentCommand): string {
	const requestItems = (command.input as { RequestItems: Record<string, unknown> }).RequestItems;
	return Object.keys(requestItems)[0];
}

describe("initDynamoDbPastReads", () => {
	describe("markPastReadsReady", () => {
		it("writes the matches, fingerprint, timestamp and tokens under a recompute-safe guard", async () => {
			const { sent, store } = build(() => ({}));

			const outcome = await store.markPastReadsReady({
				userId: USER_ID,
				url: TARGET_URL,
				pastReads: [
					{ url: "example.com/a", reason: "Same subject", readlist: WORK },
					{ url: "example.com/b", reason: "Also same subject" },
				],
				fingerprint: "fp-1",
				inputTokens: 200,
				outputTokens: 40,
				at: AT,
			});

			const update = sent[0];
			assert(update, "an update must have been issued");
			expect(update.input.TableName).toBe(USER_ARTICLES_TABLE);
			expect(update.input.Key).toEqual({ userId: USER_ID, url: "example.com/target" });
			expect(String(update.input.ConditionExpression)).toContain("attribute_exists(savedAt)");
			expect(String(update.input.ConditionExpression)).toContain("pastReadsComputedAt < :at");
			expect(update.input.ExpressionAttributeValues).toEqual({
				":articles": [
					{ url: "example.com/a", reason: "Same subject", readlist: "work" },
					{ url: "example.com/b", reason: "Also same subject" },
				],
				":fingerprint": "fp-1",
				":at": AT.toISOString(),
				":inputTokens": 200,
				":outputTokens": 40,
			});
			expect(outcome).toBe("stored");
		});

		it("reports a row a newer computation already settled as superseded", async () => {
			const { store } = build(() => {
				throw new ConditionalCheckFailedException({ $metadata: {}, message: "newer" });
			});

			await expect(
				store.markPastReadsReady({
					userId: USER_ID,
					url: TARGET_URL,
					pastReads: [],
					fingerprint: "fp",
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
				store.markPastReadsReady({
					userId: USER_ID,
					url: TARGET_URL,
					pastReads: [],
					fingerprint: "fp",
					inputTokens: 0,
					outputTokens: 0,
					at: AT,
				}),
			).rejects.toThrow("throttled");
		});
	});

	describe("readPastReadsState", () => {
		it("returns the last fingerprint and computed timestamp", async () => {
			const { store } = build(() => ({
				Item: {
					userId: USER_ID,
					url: "example.com/target",
					pastReadsFingerprint: "fp-9",
					pastReadsComputedAt: AT.toISOString(),
				},
			}));

			expect(await store.readPastReadsState({ userId: USER_ID, url: TARGET_URL })).toEqual({
				fingerprint: "fp-9",
				computedAt: AT,
			});
		});

		it("returns an empty state before anything has been computed", async () => {
			const { store } = build(() => ({ Item: undefined }));

			expect(await store.readPastReadsState({ userId: USER_ID, url: TARGET_URL })).toEqual({});
		});
	});

	describe("findReadCandidatesAcrossReadlists", () => {
		function client(params: {
			definitions: { slug: string; createdAt: string }[];
			readsByPartition: Record<string, { url: string; readAt: string; lastEvaluatedKey?: unknown }[]>;
			articles: Record<string, unknown>[];
		}) {
			return build((command) => {
				if (command.constructorName === "QueryCommand") {
					if (isDefinitionsQuery(command)) {
						return { Items: params.definitions.map((d) => ({ queueSlug: d.slug, createdAt: d.createdAt })) };
					}
					const rows = params.readsByPartition[partitionOf(command)] ?? [];
					return {
						Items: rows.map((row) => ({ userId: partitionOf(command), url: row.url, readAt: row.readAt })),
						LastEvaluatedKey: rows.find((row) => row.lastEvaluatedKey)?.lastEvaluatedKey,
					};
				}
				return { Responses: { [ARTICLES_TABLE]: params.articles }, UnprocessedKeys: {} };
			});
		}

		it("gathers read candidates from the default list when the reader owns no custom lists", async () => {
			const { store } = client({
				definitions: [],
				readsByPartition: {
					[USER_ID]: [
						{ url: "example.com/target", readAt: "2026-09-10T00:00:00.000Z" },
						{ url: "example.com/read", readAt: "2026-09-09T00:00:00.000Z" },
					],
				},
				articles: [
					{ url: "example.com/read", title: "Read", siteName: "Example", excerpt: "An excerpt" },
				],
			});

			const result = await store.findReadCandidatesAcrossReadlists({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 10,
			});

			expect(result.candidates).toEqual([
				{ url: "example.com/read", title: "Read", siteName: "Example", description: "An excerpt" },
			]);
		});

		it("dedupes a url read in two lists to its most recent read, tagged with that list", async () => {
			const workPartition = `${USER_ID}#queue/work`;
			const { store } = client({
				definitions: [{ slug: "work", createdAt: "2026-01-01T00:00:00.000Z" }],
				readsByPartition: {
					[USER_ID]: [{ url: "example.com/shared", readAt: "2026-09-01T00:00:00.000Z" }],
					[workPartition]: [{ url: "example.com/shared", readAt: "2026-09-08T00:00:00.000Z" }],
				},
				articles: [
					{ url: "example.com/shared", title: "Shared", siteName: "Example", excerpt: "Shared excerpt" },
				],
			});

			const result = await store.findReadCandidatesAcrossReadlists({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 10,
			});

			expect(result.candidates).toEqual([
				{
					url: "example.com/shared",
					title: "Shared",
					siteName: "Example",
					description: "Shared excerpt",
					readlist: "work",
				},
			]);
		});

		it("keeps the earlier list's read when it is the more recent one", async () => {
			const workPartition = `${USER_ID}#queue/work`;
			const { store } = client({
				definitions: [{ slug: "work", createdAt: "2026-01-01T00:00:00.000Z" }],
				readsByPartition: {
					[USER_ID]: [{ url: "example.com/shared", readAt: "2026-09-09T00:00:00.000Z" }],
					[workPartition]: [{ url: "example.com/shared", readAt: "2026-09-01T00:00:00.000Z" }],
				},
				articles: [
					{ url: "example.com/shared", title: "Shared", siteName: "Example", excerpt: "Shared excerpt" },
				],
			});

			const result = await store.findReadCandidatesAcrossReadlists({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 10,
			});

			expect(result.candidates).toEqual([
				{ url: "example.com/shared", title: "Shared", siteName: "Example", description: "Shared excerpt" },
			]);
		});

		it("orders by most-recent read across lists and caps at the limit", async () => {
			const workPartition = `${USER_ID}#queue/work`;
			const { store } = client({
				definitions: [{ slug: "work", createdAt: "2026-01-01T00:00:00.000Z" }],
				readsByPartition: {
					[USER_ID]: [{ url: "example.com/older", readAt: "2026-09-01T00:00:00.000Z" }],
					[workPartition]: [{ url: "example.com/newer", readAt: "2026-09-08T00:00:00.000Z" }],
				},
				articles: [
					{ url: "example.com/newer", title: "Newer", siteName: "Example", excerpt: "" },
					{ url: "example.com/older", title: "Older", siteName: "Example", excerpt: "" },
				],
			});

			const result = await store.findReadCandidatesAcrossReadlists({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 1,
			});

			expect(result.candidates.map((candidate) => candidate.title)).toEqual(["Newer"]);
		});

		it("stops paging a partition once the limit is filled and follows a page that has not", async () => {
			const { store } = client({
				definitions: [],
				readsByPartition: {
					[USER_ID]: [
						{ url: "example.com/a", readAt: "2026-09-09T00:00:00.000Z", lastEvaluatedKey: { url: "a" } },
						{ url: "example.com/b", readAt: "2026-09-08T00:00:00.000Z" },
					],
				},
				articles: [
					{ url: "example.com/a", title: "A", siteName: "Example", excerpt: "" },
					{ url: "example.com/b", title: "B", siteName: "Example", excerpt: "" },
				],
			});

			const result = await store.findReadCandidatesAcrossReadlists({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 5,
			});

			expect(result.candidates.map((candidate) => candidate.title)).toEqual(["A", "B"]);
		});

		it("skips the article being read", async () => {
			const { store } = client({
				definitions: [],
				readsByPartition: {
					[USER_ID]: [
						{ url: "example.com/target", readAt: "2026-09-10T00:00:00.000Z" },
						{ url: "example.com/other", readAt: "2026-09-09T00:00:00.000Z" },
					],
				},
				articles: [{ url: "example.com/other", title: "Other", siteName: "Example", excerpt: "" }],
			});

			const result = await store.findReadCandidatesAcrossReadlists({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 10,
			});

			expect(result.candidates.map((candidate) => candidate.url)).toEqual(["example.com/other"]);
		});

		it("describes a candidate by its summary, then summary excerpt, then crawl excerpt", async () => {
			const { store } = client({
				definitions: [],
				readsByPartition: {
					[USER_ID]: [
						{ url: "example.com/s", readAt: "2026-09-03T00:00:00.000Z" },
						{ url: "example.com/se", readAt: "2026-09-02T00:00:00.000Z" },
						{ url: "example.com/e", readAt: "2026-09-01T00:00:00.000Z" },
					],
				},
				articles: [
					{
						url: "example.com/s",
						title: "S",
						siteName: "Example",
						excerpt: "ex",
						summary: "Full summary",
						summaryExcerpt: "se",
					},
					{ url: "example.com/se", title: "SE", siteName: "Example", excerpt: "ex", summaryExcerpt: "Summary excerpt" },
					{ url: "example.com/e", title: "E", siteName: "Example", excerpt: "Just excerpt" },
				],
			});

			const result = await store.findReadCandidatesAcrossReadlists({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 10,
			});

			expect(result.candidates.map((candidate) => candidate.description)).toEqual([
				"Full summary",
				"Summary excerpt",
				"Just excerpt",
			]);
		});

		it("holds back a read still awaiting crawl metadata and drops a terminally failed one", async () => {
			const { store } = client({
				definitions: [],
				readsByPartition: {
					[USER_ID]: [
						{ url: "example.com/pending", readAt: "2026-09-03T00:00:00.000Z" },
						{ url: "example.com/dead", readAt: "2026-09-02T00:00:00.000Z" },
						{ url: "example.com/good", readAt: "2026-09-01T00:00:00.000Z" },
					],
				},
				articles: [
					{
						url: "example.com/pending",
						title: "Article from example.com",
						siteName: "example.com",
						excerpt: "Saved from example.com.",
						crawlStatus: "pending",
					},
					{
						url: "example.com/dead",
						title: "Article from example.com",
						siteName: "example.com",
						excerpt: "Saved from example.com.",
						crawlStatus: "failed",
					},
					{ url: "example.com/good", title: "Good", siteName: "Example", excerpt: "" },
				],
			});

			const result = await store.findReadCandidatesAcrossReadlists({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 10,
			});

			expect(result.candidates.map((candidate) => candidate.title)).toEqual(["Good"]);
			expect(result.awaitingCrawl).toBe(1);
		});

		it("returns nothing when the reader has read nothing else", async () => {
			const { store } = client({ definitions: [], readsByPartition: {}, articles: [] });

			expect(
				await store.findReadCandidatesAcrossReadlists({
					userId: USER_ID,
					excludeUrl: TARGET_URL,
					limit: 10,
				}),
			).toEqual({ candidates: [], awaitingCrawl: 0 });
		});

		it("orders owned lists by creation time then slug and breaks equal-read ties by canonical id", async () => {
			const alphaPartition = `${USER_ID}#queue/alpha`;
			const { store } = client({
				definitions: [
					{ slug: "alpha", createdAt: "2026-01-02T00:00:00.000Z" },
					{ slug: "beta", createdAt: "2026-01-01T00:00:00.000Z" },
					{ slug: "gamma", createdAt: "2026-01-01T00:00:00.000Z" },
				],
				readsByPartition: {
					[USER_ID]: [{ url: "example.com/z", readAt: "2026-09-05T00:00:00.000Z" }],
					[alphaPartition]: [{ url: "example.com/a", readAt: "2026-09-05T00:00:00.000Z" }],
				},
				articles: [
					{ url: "example.com/a", title: "A", siteName: "Example", excerpt: "" },
					{ url: "example.com/z", title: "Z", siteName: "Example", excerpt: "" },
				],
			});

			const result = await store.findReadCandidatesAcrossReadlists({
				userId: USER_ID,
				excludeUrl: TARGET_URL,
				limit: 10,
			});

			expect(result.candidates.map((candidate) => candidate.url)).toEqual([
				"example.com/a",
				"example.com/z",
			]);
			expect(result.candidates.find((candidate) => candidate.url === "example.com/a")?.readlist).toBe("alpha");
		});
	});

	describe("findPastReads", () => {
		it("reports pending before anything has been computed", async () => {
			const { store } = build(() => ({ Item: { userId: USER_ID, url: "example.com/target" } }));

			expect(await store.findPastReads({ userId: USER_ID, url: TARGET_URL })).toEqual({
				status: "pending",
			});
		});

		it("reports a cached empty result without reading further", async () => {
			const { sent, store } = build(() => ({
				Item: {
					userId: USER_ID,
					url: "example.com/target",
					pastReadsComputedAt: AT.toISOString(),
					pastReadsArticles: [],
				},
			}));

			expect(await store.findPastReads({ userId: USER_ID, url: TARGET_URL })).toEqual({
				status: "ready",
				items: [],
			});
			expect(sent).toHaveLength(1);
		});

		it("resolves a match to the default list and drops one no longer read anywhere", async () => {
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							pastReadsComputedAt: AT.toISOString(),
							pastReadsArticles: [
								{ url: "example.com/kept", reason: "Same subject" },
								{ url: "example.com/unread-now", reason: "Same subject too" },
							],
						},
					};
				}
				if (command.constructorName === "QueryCommand") return { Items: [] };
				if (tableOf(command) === USER_ARTICLES_TABLE) {
					return {
						Responses: {
							[USER_ARTICLES_TABLE]: [
								{ userId: USER_ID, url: "example.com/kept", status: "read" },
								{ userId: USER_ID, url: "example.com/unread-now", status: "unread" },
							],
						},
						UnprocessedKeys: {},
					};
				}
				return {
					Responses: {
						[ARTICLES_TABLE]: [
							{
								url: "example.com/kept",
								originalUrl: "https://example.com/kept",
								routeId: "0123456789abcdef0123456789abcdef",
								title: "Kept",
								siteName: "Example",
								excerpt: "",
							},
						],
					},
					UnprocessedKeys: {},
				};
			});

			const result = await store.findPastReads({ userId: USER_ID, url: TARGET_URL });

			assert(result.status === "ready", "a computed row reports ready");
			expect(result.items.map((item) => ({ ...item, id: item.id.value }))).toEqual([
				{
					id: "0123456789abcdef0123456789abcdef",
					title: "Kept",
					siteName: "Example",
					reason: "Same subject",
				},
			]);
		});

		it("names a match that redirected across hosts after its destination, not the saved link's host", async () => {
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							pastReadsComputedAt: AT.toISOString(),
							pastReadsArticles: [{ url: "nodeweekly.com/link/190528", reason: "Same subject" }],
						},
					};
				}
				if (command.constructorName === "QueryCommand") return { Items: [] };
				if (tableOf(command) === USER_ARTICLES_TABLE) {
					return {
						Responses: {
							[USER_ARTICLES_TABLE]: [{ userId: USER_ID, url: "nodeweekly.com/link/190528", status: "read" }],
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

			const result = await store.findPastReads({ userId: USER_ID, url: TARGET_URL });

			assert(result.status === "ready", "a computed row reports ready");
			expect(result.items.map((item) => ({ title: item.title, siteName: item.siteName }))).toEqual([
				{ title: "Article from memcached.org", siteName: "memcached.org" },
			]);
		});

		it("names when a match was last read, taking the most recent read across its lists", async () => {
			const workPartition = `${USER_ID}#queue/work`;
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							pastReadsComputedAt: AT.toISOString(),
							pastReadsArticles: [
								{ url: "example.com/newer-in-work", reason: "Same subject" },
								{ url: "example.com/newer-in-default", reason: "Also the subject" },
							],
						},
					};
				}
				if (command.constructorName === "QueryCommand") {
					return { Items: [{ queueSlug: "work", createdAt: "2026-01-01T00:00:00.000Z" }] };
				}
				if (tableOf(command) === USER_ARTICLES_TABLE) {
					return {
						Responses: {
							[USER_ARTICLES_TABLE]: [
								// Read later in work than in the default list: the newer instant wins.
								{ userId: USER_ID, url: "example.com/newer-in-work", status: "read", readAt: "2026-09-01T00:00:00.000Z" },
								{ userId: workPartition, url: "example.com/newer-in-work", status: "read", readAt: "2026-09-10T00:00:00.000Z" },
								// Read later in the default list than in work: the earlier work read is kept out.
								{ userId: USER_ID, url: "example.com/newer-in-default", status: "read", readAt: "2026-09-12T00:00:00.000Z" },
								{ userId: workPartition, url: "example.com/newer-in-default", status: "read", readAt: "2026-09-02T00:00:00.000Z" },
							],
						},
						UnprocessedKeys: {},
					};
				}
				return {
					Responses: {
						[ARTICLES_TABLE]: [
							{
								url: "example.com/newer-in-work",
								originalUrl: "https://example.com/newer-in-work",
								routeId: "44444444444444444444444444444444",
								title: "Newer in work",
								siteName: "Example",
								excerpt: "",
							},
							{
								url: "example.com/newer-in-default",
								originalUrl: "https://example.com/newer-in-default",
								routeId: "55555555555555555555555555555555",
								title: "Newer in default",
								siteName: "Example",
								excerpt: "",
							},
						],
					},
					UnprocessedKeys: {},
				};
			});

			const result = await store.findPastReads({ userId: USER_ID, url: TARGET_URL });

			assert(result.status === "ready", "a computed row reports ready");
			expect(result.items.map((item) => ({ id: item.id.value, readAt: item.readAt }))).toEqual([
				{ id: "44444444444444444444444444444444", readAt: new Date("2026-09-10T00:00:00.000Z") },
				{ id: "55555555555555555555555555555555", readAt: new Date("2026-09-12T00:00:00.000Z") },
			]);
		});

		it("omits the last-read line for a read match whose row carries no timestamp", async () => {
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							pastReadsComputedAt: AT.toISOString(),
							pastReadsArticles: [{ url: "example.com/legacy", reason: "Same subject" }],
						},
					};
				}
				if (command.constructorName === "QueryCommand") return { Items: [] };
				if (tableOf(command) === USER_ARTICLES_TABLE) {
					return {
						Responses: {
							[USER_ARTICLES_TABLE]: [
								{ userId: USER_ID, url: "example.com/legacy", status: "read" },
							],
						},
						UnprocessedKeys: {},
					};
				}
				return {
					Responses: {
						[ARTICLES_TABLE]: [
							{
								url: "example.com/legacy",
								originalUrl: "https://example.com/legacy",
								routeId: "66666666666666666666666666666666",
								title: "Legacy",
								siteName: "Example",
								excerpt: "",
							},
						],
					},
					UnprocessedKeys: {},
				};
			});

			const result = await store.findPastReads({ userId: USER_ID, url: TARGET_URL });

			assert(result.status === "ready", "a computed row reports ready");
			expect(result.items).toHaveLength(1);
			expect(result.items[0]?.readAt).toBeUndefined();
		});

		it("reports a cached-but-now-empty result when no match is still read", async () => {
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							pastReadsComputedAt: AT.toISOString(),
							pastReadsArticles: [{ url: "example.com/gone", reason: "Same subject" }],
						},
					};
				}
				if (command.constructorName === "QueryCommand") return { Items: [] };
				return { Responses: { [USER_ARTICLES_TABLE]: [] }, UnprocessedKeys: {} };
			});

			expect(await store.findPastReads({ userId: USER_ID, url: TARGET_URL })).toEqual({
				status: "ready",
				items: [],
			});
		});

		it("opens a match in the source list, preferring it over the default, and drops a purged article", async () => {
			const workPartition = `${USER_ID}#queue/work`;
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							pastReadsComputedAt: AT.toISOString(),
							pastReadsArticles: [
								{ url: "example.com/in-work", reason: "Same subject", readlist: "work" },
								{ url: "example.com/purged", reason: "Same subject" },
							],
						},
					};
				}
				if (command.constructorName === "QueryCommand") {
					return {
						Items: [{ queueSlug: "work", createdAt: "2026-01-01T00:00:00.000Z" }],
					};
				}
				if (tableOf(command) === USER_ARTICLES_TABLE) {
					return {
						Responses: {
							[USER_ARTICLES_TABLE]: [
								{ userId: USER_ID, url: "example.com/in-work", status: "read" },
								{ userId: workPartition, url: "example.com/in-work", status: "read" },
								{ userId: USER_ID, url: "example.com/purged", status: "read" },
							],
						},
						UnprocessedKeys: {},
					};
				}
				return {
					Responses: {
						[ARTICLES_TABLE]: [
							{
								url: "example.com/in-work",
								originalUrl: "https://example.com/in-work",
								routeId: "11111111111111111111111111111111",
								title: "In Work",
								siteName: "Example",
								excerpt: "",
							},
							{
								url: "example.com/purged",
								originalUrl: "https://example.com/purged",
								routeId: "22222222222222222222222222222222",
								title: "Purged",
								siteName: "Example",
								excerpt: "",
								purgedAt: AT.toISOString(),
							},
						],
					},
					UnprocessedKeys: {},
				};
			});

			const result = await store.findPastReads({
				userId: USER_ID,
				url: TARGET_URL,
				sourceReadlist: WORK,
			});

			assert(result.status === "ready", "a computed row reports ready");
			expect(result.items.map((item) => ({ ...item, id: item.id.value }))).toEqual([
				{
					id: "11111111111111111111111111111111",
					title: "In Work",
					siteName: "Example",
					reason: "Same subject",
					readlist: "work",
				},
			]);
		});

		it("falls back to a remaining owned list when neither source nor default holds the match", async () => {
			const readingPartition = `${USER_ID}#queue/reading`;
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							pastReadsComputedAt: AT.toISOString(),
							pastReadsArticles: [{ url: "example.com/in-reading", reason: "Same subject", readlist: "reading" }],
						},
					};
				}
				if (command.constructorName === "QueryCommand") {
					return { Items: [{ queueSlug: "reading", createdAt: "2026-01-01T00:00:00.000Z" }] };
				}
				if (tableOf(command) === USER_ARTICLES_TABLE) {
					return {
						Responses: {
							[USER_ARTICLES_TABLE]: [
								{ userId: readingPartition, url: "example.com/in-reading", status: "read" },
							],
						},
						UnprocessedKeys: {},
					};
				}
				return {
					Responses: {
						[ARTICLES_TABLE]: [
							{
								url: "example.com/in-reading",
								originalUrl: "https://example.com/in-reading",
								routeId: "33333333333333333333333333333333",
								title: "In Reading",
								siteName: "Example",
								excerpt: "",
							},
						],
					},
					UnprocessedKeys: {},
				};
			});

			const result = await store.findPastReads({
				userId: USER_ID,
				url: TARGET_URL,
				sourceReadlist: WORK,
			});

			assert(result.status === "ready", "a computed row reports ready");
			expect(result.items.map((item) => ({ id: item.id.value, readlist: item.readlist }))).toEqual([
				{ id: "33333333333333333333333333333333", readlist: READING },
			]);
		});

		it("drops a match whose article row has gone missing", async () => {
			const { store } = build((command) => {
				if (command.constructorName === "GetCommand") {
					return {
						Item: {
							userId: USER_ID,
							url: "example.com/target",
							pastReadsComputedAt: AT.toISOString(),
							pastReadsArticles: [{ url: "example.com/vanished", reason: "Same subject" }],
						},
					};
				}
				if (command.constructorName === "QueryCommand") return { Items: [] };
				if (tableOf(command) === USER_ARTICLES_TABLE) {
					return {
						Responses: {
							[USER_ARTICLES_TABLE]: [{ userId: USER_ID, url: "example.com/vanished", status: "read" }],
						},
						UnprocessedKeys: {},
					};
				}
				return { Responses: { [ARTICLES_TABLE]: [] }, UnprocessedKeys: {} };
			});

			expect(await store.findPastReads({ userId: USER_ID, url: TARGET_URL })).toEqual({
				status: "ready",
				items: [],
			});
		});
	});
});
