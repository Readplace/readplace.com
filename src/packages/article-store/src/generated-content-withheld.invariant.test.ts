import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	ANONYMOUS_VIEWER,
	SUMMARY_WITHHELD_REASON,
	generatedContentAccessFor,
} from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { initDynamoDbGeneratedSummary } from "./dynamodb-generated-summary";
import { initDynamoDbPastReads } from "./dynamodb-past-reads";
import { initDynamoDbRelatedArticles } from "./dynamodb-related-articles";
import { initDynamoDbClaimResolutionOnView } from "./dynamodb-resolution-on-view";

const WITHHELD = generatedContentAccessFor({ viewerCountry: "CN", storefront: undefined });
const URL = "https://example.com/article";
const KEY = ArticleResourceUniqueId.parse(URL).value;
const USER_ID = UserIdSchema.parse("user_abc");
const SENTINEL = "generated-text-sentinel-8d4f";
const now = () => new Date("2026-11-20T00:00:00.000Z");
const WITHHELD_SUMMARY = { status: "skipped", reason: SUMMARY_WITHHELD_REASON };

const STORED_SUMMARY_STATES: ReadonlyArray<{ name: string; row: Record<string, unknown> }> = [
	{ name: "no stored summary", row: { url: KEY, crawlStatus: "ready" } },
	{ name: "a pending summary", row: { url: KEY, crawlStatus: "ready", summaryStatus: "pending" } },
	{
		name: "a ready summary",
		row: { url: KEY, crawlStatus: "ready", summaryStatus: "ready", summary: SENTINEL, summaryExcerpt: SENTINEL },
	},
	{ name: "a failed summary", row: { url: KEY, crawlStatus: "ready", summaryStatus: "failed", summaryFailureReason: SENTINEL } },
	{ name: "a skipped summary", row: { url: KEY, crawlStatus: "ready", summaryStatus: "skipped", summarySkippedReason: SENTINEL } },
];

function answeringClient(answer: (input: { input: { RequestItems?: Record<string, unknown> } }) => unknown): DynamoDBDocumentClient {
	const send = async (command: { input: { RequestItems?: Record<string, unknown> } }) => answer(command);
	return { send } as Partial<DynamoDBDocumentClient> as DynamoDBDocumentClient;
}

function unreadableClient(): DynamoDBDocumentClient {
	return answeringClient(() => {
		throw new Error("a withheld read must not reach DynamoDB");
	});
}

describe("generated content withheld from a viewer in mainland China", () => {
	describe.each(STORED_SUMMARY_STATES)("with $name", ({ row }) => {
		it("findGeneratedSummary returns the withheld skip", async () => {
			const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
				client: answeringClient(() => ({ Item: row })),
				tableName: "test-table",
				now,
			});

			const result = await findGeneratedSummary({ url: URL, viewer: ANONYMOUS_VIEWER, generatedContent: WITHHELD });

			expect(result).toEqual(WITHHELD_SUMMARY);
			expect(JSON.stringify(result)).not.toContain(SENTINEL);
		});

		it("findGeneratedSummaries returns the withheld skip", async () => {
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({
				client: answeringClient(() => ({ Responses: { "test-table": [row] }, UnprocessedKeys: {} })),
				tableName: "test-table",
				now,
			});

			const result = await findGeneratedSummaries({ urls: [URL], viewer: ANONYMOUS_VIEWER, generatedContent: WITHHELD });

			expect(result.get(URL)).toEqual(WITHHELD_SUMMARY);
			expect(JSON.stringify([...result])).not.toContain(SENTINEL);
		});

		it("claimResolutionOnView returns the withheld skip", async () => {
			const claim = initDynamoDbClaimResolutionOnView({
				client: answeringClient(() => ({ Attributes: row })),
				tableName: "test-table",
				now,
			});

			const result = await claim({ url: URL, axes: "summary", viewer: ANONYMOUS_VIEWER, generatedContent: WITHHELD });

			expect(result).toEqual({ kind: "claimed", crawl: { status: "ready" }, summary: WITHHELD_SUMMARY });
			expect(JSON.stringify(result)).not.toContain(SENTINEL);
		});
	});

	it("findRelatedArticles reports skipped without reading the save", async () => {
		const store = initDynamoDbRelatedArticles({
			client: unreadableClient(),
			tableName: "articles",
			userArticlesTableName: "user-articles",
		});

		expect(await store.findRelatedArticles({ userId: USER_ID, url: URL, generatedContent: WITHHELD })).toEqual({
			status: "skipped",
		});
	});

	it("findPastReads reports no items without reading the save", async () => {
		const store = initDynamoDbPastReads({
			client: unreadableClient(),
			tableName: "articles",
			userArticlesTableName: "user-articles",
		});

		expect(await store.findPastReads({ userId: USER_ID, url: URL, generatedContent: WITHHELD })).toEqual({
			status: "ready",
			items: [],
		});
	});
});
