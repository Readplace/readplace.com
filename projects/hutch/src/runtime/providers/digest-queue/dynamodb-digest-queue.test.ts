import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbDigestQueue } from "./dynamodb-digest-queue";

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

type SendFn = DynamoDBDocumentClient["send"];

/** Records every command and replays canned Query/Scan pages in order so
 * pagination + dedupe can be asserted. */
function createFakeClient(opts: {
	queryPages?: Array<Record<string, unknown>>;
	scanPages?: Array<Record<string, unknown>>;
}): { client: Partial<DynamoDBDocumentClient>; commands: CapturedCommand[] } {
	const commands: CapturedCommand[] = [];
	const queryPages = [...(opts.queryPages ?? [])];
	const scanPages = [...(opts.scanPages ?? [])];
	const client: Partial<DynamoDBDocumentClient> = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "QueryCommand") return queryPages.shift() ?? { Items: [] };
			if (name === "ScanCommand") return scanPages.shift() ?? { Items: [] };
			return {};
		}) as unknown as SendFn,
	};
	return { client, commands };
}

function initQueue(client: Partial<DynamoDBDocumentClient>) {
	return initDynamoDbDigestQueue({
		client: client as DynamoDBDocumentClient,
		tableName: "digest-queue",
	});
}

const USER = UserIdSchema.parse("user-1");
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

describe("initDynamoDbDigestQueue", () => {
	describe("enqueueDigestItem", () => {
		it("puts a row keyed by the canonical url, retaining the original url and a TTL derived from enqueuedAt", async () => {
			const { client, commands } = createFakeClient({});

			await initQueue(client).enqueueDigestItem({
				userId: USER,
				url: "https://example.com/article?utm_source=x",
				enqueuedAt: "2026-06-01T00:00:00.000Z",
				retentionMs: RETENTION_MS,
			});

			const put = commands.find((c) => c.name === "PutCommand");
			const item = put?.input.Item as Record<string, unknown>;
			expect(item.userId).toBe(USER);
			// Canonical sort key: schemeless + tracking params stripped.
			expect(item.url).toBe("example.com/article");
			expect(item.originalUrl).toBe("https://example.com/article?utm_source=x");
			expect(item.enqueuedAt).toBe("2026-06-01T00:00:00.000Z");
			// 2026-06-01T00:00:00Z is 1780272000s; + 30 days (2592000s).
			expect(item.expiresAt).toBe(1780272000 + 2592000);
		});
	});

	describe("listDigestItemsByUser", () => {
		it("queries the user partition and pages until the queue is drained", async () => {
			const { client, commands } = createFakeClient({
				queryPages: [
					{
						Items: [
							{ userId: USER, url: "example.com/a", originalUrl: "https://example.com/a", enqueuedAt: "t1" },
						],
						LastEvaluatedKey: { userId: USER, url: "example.com/a" },
					},
					{
						Items: [
							{ userId: USER, url: "example.com/b", originalUrl: "https://example.com/b", enqueuedAt: "t2" },
						],
					},
				],
			});

			const items = await initQueue(client).listDigestItemsByUser(USER);

			expect(items).toEqual([
				{ userId: USER, url: "example.com/a", originalUrl: "https://example.com/a", enqueuedAt: "t1" },
				{ userId: USER, url: "example.com/b", originalUrl: "https://example.com/b", enqueuedAt: "t2" },
			]);
			const queries = commands.filter((c) => c.name === "QueryCommand");
			expect(queries).toHaveLength(2);
			expect(queries[0]?.input.KeyConditionExpression).toBe("userId = :userId");
			expect((queries[0]?.input.ExpressionAttributeValues as Record<string, unknown>)[":userId"]).toBe(USER);
			expect(queries[1]?.input.ExclusiveStartKey).toEqual({ userId: USER, url: "example.com/a" });
		});
	});

	describe("deleteDigestItem", () => {
		it("deletes by the canonical key verbatim without re-canonicalizing", async () => {
			const { client, commands } = createFakeClient({});

			await initQueue(client).deleteDigestItem({ userId: USER, url: "example.com/a" });

			const del = commands.find((c) => c.name === "DeleteCommand");
			expect(del?.input.Key).toEqual({ userId: USER, url: "example.com/a" });
		});
	});

	describe("scanPendingDigestUsers", () => {
		it("scans every page and returns each distinct userId once", async () => {
			const other = UserIdSchema.parse("user-2");
			const { client, commands } = createFakeClient({
				scanPages: [
					{
						Items: [
							{ userId: USER, url: "example.com/a", originalUrl: "https://example.com/a", enqueuedAt: "t1" },
							{ userId: USER, url: "example.com/b", originalUrl: "https://example.com/b", enqueuedAt: "t2" },
						],
						LastEvaluatedKey: { userId: USER, url: "example.com/b" },
					},
					{
						Items: [
							{ userId: other, url: "example.com/c", originalUrl: "https://example.com/c", enqueuedAt: "t3" },
						],
					},
				],
			});

			const users = await initQueue(client).scanPendingDigestUsers();

			expect(users).toEqual([USER, other]);
			expect(commands.filter((c) => c.name === "ScanCommand")).toHaveLength(2);
		});
	});
});
