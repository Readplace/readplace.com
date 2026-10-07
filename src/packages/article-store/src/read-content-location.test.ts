import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { z } from "zod";
import { initReadContentLocation } from "./read-content-location";

const articleId = ArticleResourceUniqueId.parse("https://example.com/post");
function read(row: Record<string, unknown> | undefined) {
	const client = { send: async () => ({ Item: row }) } as unknown as Pick<DynamoDBDocumentClient, "send">;
	return initReadContentLocation({ client, tableName: "articles", bucketName: "content" })(articleId);
}

describe("content reader provenance", () => {
	it("follows the committed immutable pointer instead of the mutable legacy key", async () => {
		expect(await read({ contentLocation: "s3://content/immutable/article.html", canonicalCandidateId: "candidate", canonicalOriginalUrl: "https://example.com/post", contentSourceTier: "tier-2" })).toEqual({ bucket: "content", key: "immutable/article.html" });
	});
	it("keeps an ordinary old article readable", async () => {
		expect(await read({ originalUrl: "https://example.com/post" })).toEqual({ bucket: "content", key: articleId.toS3ContentKey() });
	});
	it.each([
		undefined,
		{ purgedAt: "2026-10-05T00:00:00Z" },
		{ originalUrl: "https://archive.today/unknown/path" },
	])("withholds an absent, purged or unverifiable wrapper row %j", async (row) => {
		expect(await read(row)).toBeUndefined();
	});
	it("uses a consistent DynamoDB read so a committed decision is visible immediately", async () => {
		let command: unknown;
		const client = { send: async (input: unknown) => { command = input; return { Item: {} }; } } as unknown as Pick<DynamoDBDocumentClient, "send">;
		await initReadContentLocation({ client, tableName: "articles", bucketName: "content" })(articleId);
		expect(z.object({ input: z.object({ ConsistentRead: z.boolean() }) }).parse(command).input.ConsistentRead).toBe(true);
	});
});
