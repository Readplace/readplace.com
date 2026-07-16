import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { initTombstoneArticle } from "./tombstone-article";

/**
 * 1. The DocumentClient `send` is a heavily-overloaded generic the test fake
 *    cannot structurally satisfy; the single contained cast is the isolated
 *    SDK-wrapper exception in CLAUDE.md "Avoid TypeScript Type Assertions".
 */
function createFakeDynamo(impl: (input: Record<string, unknown>) => unknown): DynamoDBDocumentClient {
	const send = async (command: { input: Record<string, unknown> }) => impl(command.input);
	return { send } as unknown as DynamoDBDocumentClient /* 1 */;
}

const TABLE = "articles";
const PURGED_AT = new Date("2026-07-16T10:00:00.000Z");

describe("initTombstoneArticle", () => {
	it("stamps purgedAt set-once, terminalizes both axes, re-stubs metadata to the hostname, and strips every content-bearing column", async () => {
		let update: Record<string, unknown> | undefined;
		const { tombstoneArticle } = initTombstoneArticle({
			client: createFakeDynamo((input) => {
				update = input;
				return {};
			}),
			tableName: TABLE,
		});

		await tombstoneArticle({ url: "https://example.com/secret-doc", at: PURGED_AT });

		assert(update, "the tombstone update must be issued");
		expect(update.Key).toEqual({ url: "example.com/secret-doc" });
		const expression = String(update.UpdateExpression);
		expect(expression).toContain("purgedAt = if_not_exists(purgedAt, :now)");
		expect(expression).toContain("crawlStatus = :ready");
		expect(expression).toContain("summaryStatus = :skipped");
		expect(expression).toContain("summarySkippedReason = :skippedReason");
		expect(expression).toContain("title = :hostname, siteName = :hostname");
		expect(expression).toContain("excerpt = :empty, wordCount = :zero, estimatedReadTime = :zero");
		for (const column of [
			"content",
			"contentLocation",
			"contentSourceTier",
			"canonicalSourceTier",
			"crawlVersions",
			"summary",
			"summaryExcerpt",
			"canonicalContentHash",
			"bodyHash",
			"etag",
			"lastModified",
			"contentFetchedAt",
			"imageUrl",
		]) {
			const removeClause = expression.slice(expression.indexOf("REMOVE"));
			expect(removeClause).toContain(column);
		}
		expect(update.ConditionExpression).toBe("attribute_exists(#url)");
		expect(update.ExpressionAttributeNames).toEqual({ "#url": "url" });
		expect(update.ExpressionAttributeValues).toEqual({
			":now": "2026-07-16T10:00:00.000Z",
			":ready": "ready",
			":skipped": "skipped",
			":skippedReason": "content-purged",
			":hostname": "example.com",
			":empty": "",
			":zero": 0,
		});
	});

	it("treats a vanished row as already tombstoned (conditional failure swallowed)", async () => {
		const { tombstoneArticle } = initTombstoneArticle({
			client: createFakeDynamo(() => {
				throw new ConditionalCheckFailedException({
					$metadata: {},
					message: "The conditional request failed",
				});
			}),
			tableName: TABLE,
		});

		await expect(
			tombstoneArticle({ url: "https://example.com/secret-doc", at: PURGED_AT }),
		).resolves.toBeUndefined();
	});

	it("rethrows every other write failure so the purge redelivers", async () => {
		const { tombstoneArticle } = initTombstoneArticle({
			client: createFakeDynamo(() => {
				throw new Error("throughput exceeded");
			}),
			tableName: TABLE,
		});

		await expect(
			tombstoneArticle({ url: "https://example.com/secret-doc", at: PURGED_AT }),
		).rejects.toThrow("throughput exceeded");
	});
});
