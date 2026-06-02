import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import type { UserId } from "@packages/domain/user";
import { initDynamoDbArticleStore } from "./dynamodb-article-store";

const USER = "abc123" as UserId;
const URL = "https://example.com/article";

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

/** Records every command sent and replays canned responses keyed by command
 * type, so a test can assert the exact UpdateExpression / ConditionExpression /
 * IndexName the store builds. `updateError` lets a test simulate a failed
 * conditional write. */
function createFakeClient(opts: {
	queryItems?: Record<string, unknown>[];
	updateError?: Error;
} = {}): { client: DynamoDBDocumentClient; commands: CapturedCommand[] } {
	const commands: CapturedCommand[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "QueryCommand") {
				return { Items: opts.queryItems ?? [], Count: (opts.queryItems ?? []).length };
			}
			if (name === "UpdateCommand") {
				if (opts.updateError) throw opts.updateError;
				return {};
			}
			return {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

function initStore(client: DynamoDBDocumentClient) {
	return initDynamoDbArticleStore({
		client,
		tableName: "articles",
		userArticlesTableName: "user-articles",
	});
}

describe("initDynamoDbArticleStore reader-ready columns", () => {
	it("markArticleViewed sets viewedAt unconditionally so a tracking write never errors the reader", async () => {
		const { client, commands } = createFakeClient();
		await initStore(client).markArticleViewed({ userId: USER, url: URL, at: new Date("2026-05-30T10:00:00.000Z") });

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toContain("SET viewedAt = :at");
		expect(update?.input.ConditionExpression).toBeUndefined();
		expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":at"]).toBe(
			"2026-05-30T10:00:00.000Z",
		);
	});

	it("markReaderViewSucceeded writes succeededAt set-once via if_not_exists", async () => {
		const { client, commands } = createFakeClient();
		await initStore(client).markReaderViewSucceeded({ userId: USER, url: URL, at: new Date("2026-05-30T10:00:00.000Z") });

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toContain("if_not_exists(succeededAt, :at)");
	});

	it("markReaderReadyEmailSent guards on attribute_not_exists(emailSentAt) so it is set-once", async () => {
		const { client, commands } = createFakeClient();
		await initStore(client).markReaderReadyEmailSent({ userId: USER, url: URL, at: new Date("2026-05-30T10:05:00.000Z") });

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.ConditionExpression).toBe("attribute_not_exists(emailSentAt)");
	});

	it("markReaderReadyEmailSent swallows ConditionalCheckFailedException so a duplicate stamp is a no-op", async () => {
		const { client } = createFakeClient({
			updateError: new ConditionalCheckFailedException({ $metadata: {}, message: "exists" }),
		});

		await expect(
			initStore(client).markReaderReadyEmailSent({ userId: USER, url: URL, at: new Date() }),
		).resolves.toBeUndefined();
	});

	it("markReaderReadyEmailSent rethrows non-conditional errors", async () => {
		const { client } = createFakeClient({ updateError: new Error("throttled") });

		await expect(
			initStore(client).markReaderReadyEmailSent({ userId: USER, url: URL, at: new Date() }),
		).rejects.toThrow("throttled");
	});

	it("findUserArticlesByUrl queries the url-index (never a Scan) and maps savers with their viewedAt", async () => {
		const { client, commands } = createFakeClient({
			queryItems: [
				{ userId: "abc123", url: "x", status: "unread", savedAt: "2026-05-30T09:00:00.000Z", viewedAt: "2026-05-30T09:30:00.000Z" },
				{ userId: "def456", url: "x", status: "unread", savedAt: "2026-05-30T09:00:00.000Z" },
			],
		});

		const savers = await initStore(client).findUserArticlesByUrl(URL);

		const query = commands.find((c) => c.name === "QueryCommand");
		expect(query?.input.IndexName).toBe("url-index");
		expect(commands.some((c) => c.name === "ScanCommand")).toBe(false);
		expect(savers).toEqual([
			{ userId: "abc123", viewedAt: new Date("2026-05-30T09:30:00.000Z") },
			{ userId: "def456", viewedAt: undefined },
		]);
	});
});
