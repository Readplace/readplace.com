import assert from "node:assert/strict";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initRecordCrawlVersion } from "./record-crawl-version";

type DynamoSend = DynamoDBDocumentClient["send"];
type S3Send = S3Client["send"];

const TABLE = "articles-table";
const BUCKET = "content-bucket";
const URL = "https://example.com/post";
const CRAWLED_AT = "2026-07-10T09:41:32.123Z";
const MINUTE_ID = "2026-07-10T09:41Z";

interface Captured {
	input: Record<string, unknown>;
}

function createFakeS3(capture: (input: Record<string, unknown>) => void): Partial<S3Client> {
	return {
		send: (async (command: Captured) => {
			capture(command.input);
			return {};
		}) as unknown as S3Send,
	};
}

function createFakeDynamo(opts: {
	getItem?: Record<string, unknown>;
	captureUpdate?: (input: Record<string, unknown>) => void;
}): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (command: Captured) => {
			if (command.input.UpdateExpression !== undefined) {
				opts.captureUpdate?.(command.input);
				return {};
			}
			return opts.getItem === undefined ? {} : { Item: opts.getItem };
		}) as unknown as DynamoSend,
	};
}

describe("initRecordCrawlVersion", () => {
	it("snapshots the winning tier source into the per-minute version folder", async () => {
		let copy: Record<string, unknown> | undefined;
		const { recordCrawlVersion } = initRecordCrawlVersion({
			s3Client: createFakeS3((input) => {
				copy = input;
			}) as S3Client,
			dynamoClient: createFakeDynamo({ getItem: { crawlVersions: [] } }) as DynamoDBDocumentClient,
			tableName: TABLE,
			bucketName: BUCKET,
		});

		await recordCrawlVersion({ url: URL, tier: "tier-1", crawledAt: CRAWLED_AT });

		assert(copy, "a CopyObject must be issued");
		expect(copy.Bucket).toBe(BUCKET);
		expect(copy.Key).toBe("content-versions/example.com%2Fpost/2026-07-10T09-41Z/content.html");
		expect(copy.CopySource).toBe(
			`${BUCKET}/${encodeURIComponent("articles/example.com%2Fpost/sources/tier-1.html")}`,
		);
		expect(copy.MetadataDirective).toBe("REPLACE");
	});

	it("prepends the new entry to a legacy string log with a compare-and-swap on the raw stored value", async () => {
		let update: Record<string, unknown> | undefined;
		const { recordCrawlVersion } = initRecordCrawlVersion({
			s3Client: createFakeS3(() => {}) as S3Client,
			dynamoClient: createFakeDynamo({
				getItem: { crawlVersions: ["2026-07-09T08:00Z"] },
				captureUpdate: (input) => {
					update = input;
				},
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			bucketName: BUCKET,
		});

		await recordCrawlVersion({ url: URL, tier: "tier-1", crawledAt: CRAWLED_AT });

		assert(update, "the CAS update must be issued");
		expect(update.UpdateExpression).toContain("SET crawlVersions = :next");
		expect(update.ConditionExpression).toContain("attribute_not_exists(crawlVersions)");
		expect(update.ConditionExpression).toContain("crawlVersions = :old");
		const values = update.ExpressionAttributeValues as Record<string, unknown>;
		expect(values[":next"]).toEqual([{ minuteId: MINUTE_ID }, "2026-07-09T08:00Z"]);
		expect(values[":old"]).toEqual(["2026-07-09T08:00Z"]);
	});

	it("stamps the capture author onto the new log entry", async () => {
		let update: Record<string, unknown> | undefined;
		const { recordCrawlVersion } = initRecordCrawlVersion({
			s3Client: createFakeS3(() => {}) as S3Client,
			dynamoClient: createFakeDynamo({
				getItem: { crawlVersions: [{ minuteId: "2026-07-09T08:00Z", authorUserId: "user-2" }] },
				captureUpdate: (input) => {
					update = input;
				},
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			bucketName: BUCKET,
		});

		await recordCrawlVersion({
			url: URL,
			tier: "tier-0",
			crawledAt: CRAWLED_AT,
			authorUserId: "user-1",
		});

		assert(update, "the CAS update must be issued");
		const values = update.ExpressionAttributeValues as Record<string, unknown>;
		expect(values[":next"]).toEqual([
			{ minuteId: MINUTE_ID, authorUserId: "user-1" },
			{ minuteId: "2026-07-09T08:00Z", authorUserId: "user-2" },
		]);
		expect(values[":old"]).toEqual([{ minuteId: "2026-07-09T08:00Z", authorUserId: "user-2" }]);
	});

	it("records the first version on a row whose log attribute is absent", async () => {
		let update: Record<string, unknown> | undefined;
		const { recordCrawlVersion } = initRecordCrawlVersion({
			s3Client: createFakeS3(() => {}) as S3Client,
			dynamoClient: createFakeDynamo({
				getItem: {},
				captureUpdate: (input) => {
					update = input;
				},
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			bucketName: BUCKET,
		});

		await recordCrawlVersion({ url: URL, tier: "tier-0", crawledAt: CRAWLED_AT });

		assert(update, "the CAS update must be issued");
		const values = update.ExpressionAttributeValues as Record<string, unknown>;
		expect(values[":next"]).toEqual([{ minuteId: MINUTE_ID }]);
		expect(values[":old"]).toEqual([]);
	});

	it("records the first version when the row does not exist yet", async () => {
		let update: Record<string, unknown> | undefined;
		const { recordCrawlVersion } = initRecordCrawlVersion({
			s3Client: createFakeS3(() => {}) as S3Client,
			dynamoClient: createFakeDynamo({
				getItem: undefined,
				captureUpdate: (input) => {
					update = input;
				},
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			bucketName: BUCKET,
		});

		await recordCrawlVersion({ url: URL, tier: "tier-1", crawledAt: CRAWLED_AT });

		assert(update, "the CAS update must be issued for a brand-new row");
		const values = update.ExpressionAttributeValues as Record<string, unknown>;
		expect(values[":next"]).toEqual([{ minuteId: MINUTE_ID }]);
	});

	it("still snapshots but skips the log update when the minute is already recorded", async () => {
		let updateCalled = false;
		let copyCalled = false;
		const { recordCrawlVersion } = initRecordCrawlVersion({
			s3Client: createFakeS3(() => {
				copyCalled = true;
			}) as S3Client,
			dynamoClient: createFakeDynamo({
				getItem: { crawlVersions: [MINUTE_ID, "2026-07-09T08:00Z"] },
				captureUpdate: () => {
					updateCalled = true;
				},
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			bucketName: BUCKET,
		});

		await recordCrawlVersion({ url: URL, tier: "tier-1", crawledAt: CRAWLED_AT });

		expect(copyCalled).toBe(true);
		expect(updateCalled).toBe(false);
	});
});
