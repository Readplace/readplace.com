import { CandidateIdSchema } from "@packages/domain/article";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { ConditionalCheckFailedException } from "@packages/hutch-storage-client";
import { z } from "zod";
import { initRecordCrawlVersion } from "./record-crawl-version";

const cid = (id: string) => CandidateIdSchema.parse(id);

const URL = "https://example.com/post";
const CRAWLED_AT = "2026-07-10T09:41:32.123Z";
const canonicalCommit = { expected: { revision: 4 }, candidateId: cid("candidate"), contentLocation: "s3://content/immutable-candidate/content.html", originalUrl: URL, tier: "tier-0" as const };
const Input = z.object({ UpdateExpression: z.string(), ConditionExpression: z.string(), ExpressionAttributeValues: z.record(z.string(), z.unknown()) });

function setup(row: Record<string, unknown> | undefined, onUpdate: (input: z.infer<typeof Input>) => void = () => {}) {
	const updates: z.infer<typeof Input>[] = [];
	const client = { send: async (command: { input: Record<string, unknown> }) => {
		if (command.input.UpdateExpression !== undefined) {
			const input = Input.parse(command.input); updates.push(input); onUpdate(input); return {};
		}
		expect(command.input.ConsistentRead).toBe(true);
		return { Item: row };
	} } as unknown as DynamoDBDocumentClient;
	return { ...initRecordCrawlVersion({ dynamoClient: client, tableName: "articles" }), updates };
}

const params = { url: URL, crawledAt: CRAWLED_AT, authorUserId: "alice", canonicalCommit };

describe("immutable crawl version references", () => {
	it("records the committed immutable body and capture identity while retaining legacy entries", async () => {
		const { recordCrawlVersion, updates } = setup({ crawlVersions: ["2026-07-09T08:00Z"] });
		await recordCrawlVersion(params);
		expect(updates[0].ExpressionAttributeValues).toEqual({ ":next": [{ minuteId: "2026-07-10T09:41Z", authorUserId: "alice", candidateId: cid("candidate") }, "2026-07-09T08:00Z"], ":old": ["2026-07-09T08:00Z"], ":candidate": "candidate", ":revision": 5 });
		expect(updates[0].ConditionExpression).toContain("canonicalCandidateId = :candidate AND contentSelectionRevision = :revision");
	});
	it.each([undefined, {}])("records public content without assigning an author (%#)", async (row) => {
		const { recordCrawlVersion, updates } = setup(row);
		await recordCrawlVersion({ ...params, authorUserId: undefined, canonicalCommit: { ...canonicalCommit, expected: undefined } });
		expect(updates[0].ExpressionAttributeValues[":next"]).toEqual([{ minuteId: "2026-07-10T09:41Z", candidateId: cid("candidate") }]);
		expect(updates[0].ExpressionAttributeValues[":revision"]).toBe(1);
	});
	it("does not replace an earlier capture's attribution within the same minute", async () => {
		const { recordCrawlVersion, updates } = setup({ crawlVersions: [{ minuteId: "2026-07-10T09:41Z", authorUserId: "bob" }] });
		await recordCrawlVersion(params);
		expect(updates).toEqual([]);
	});
	it("refuses a postcommit append after the selection revision moves on", async () => {
		const { recordCrawlVersion } = setup({}, (input) => {
			expect(input.ConditionExpression).toContain("contentSelectionRevision = :revision");
			throw new ConditionalCheckFailedException({ message: "erased after selection commit", $metadata: {} });
		});
		await expect(recordCrawlVersion(params)).rejects.toThrow("erased after selection commit");
	});
	it("leaves a purged row alone when the selection commit was skipped by the purge fence", async () => {
		const { recordCrawlVersion, updates } = setup({}, () => {
			throw new ConditionalCheckFailedException({ message: "purged", $metadata: {}, Item: { purgedAt: { S: "2026-07-10T09:42:00.000Z" } } });
		});
		await expect(recordCrawlVersion(params)).resolves.toBeUndefined();
		expect(updates).toHaveLength(1);
	});
});
