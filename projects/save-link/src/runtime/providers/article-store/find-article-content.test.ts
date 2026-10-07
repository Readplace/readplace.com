import type { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initFindArticleContent } from "./find-article-content";

const URL = "https://example.com/post";

function setup(row: Record<string, unknown>) {
	const reads: { ConsistentRead?: boolean }[] = [];
	const fetched: GetObjectCommand["input"][] = [];
	const dynamoClient = { send: async (command: { input: { ConsistentRead?: boolean } }) => {
		reads.push(command.input);
		return { Item: row };
	} } as unknown as DynamoDBDocumentClient;
	const s3Client = { send: async (command: GetObjectCommand) => {
		fetched.push(command.input);
		return { Body: { transformToString: async () => "<p>Stored article</p>" } };
	} } as unknown as Pick<S3Client, "send">;
	return { ...initFindArticleContent({ dynamoClient, s3Client, tableName: "articles" }), reads, fetched };
}

describe("findArticleContent", () => {
	it("returns the committed content and image with a consistent read", async () => {
		const { findArticleContent, reads, fetched } = setup({ originalUrl: URL, contentLocation: "s3://content/articles/post/content.html", imageUrl: "https://cdn.example.com/hero.png" });
		expect(await findArticleContent(URL)).toEqual({ content: "<p>Stored article</p>", imageUrl: "https://cdn.example.com/hero.png" });
		expect(reads[0].ConsistentRead).toBe(true);
		expect(fetched).toEqual([{ Bucket: "content", Key: "articles/post/content.html" }]);
	});

	it.each([
		["a purged row", { contentLocation: "s3://content/purged.html", purgedAt: "2026-10-05T00:00:00.000Z" }],
		["unverified wrapper content", { contentLocation: "s3://content/archive.html", contentSourceTier: "tier-2" }],
		["a row without committed content", { originalUrl: URL }],
	])("withholds %s without reading storage", async (_name, row) => {
		const { findArticleContent, fetched } = setup(row);
		expect(await findArticleContent(URL)).toBeUndefined();
		expect(fetched).toEqual([]);
	});
});
