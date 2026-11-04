import assert from "node:assert/strict";
import { ReaderArticleHashId } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	TransactionCanceledException,
} from "@packages/hutch-storage-client";
import { initDynamoDbPrivateItem } from "./dynamodb-private-item";

type SendFn = DynamoDBDocumentClient["send"];

interface Sent {
	command: string;
	input: Record<string, unknown>;
}

function harness(answer: (sent: Sent) => unknown) {
	const sent: Sent[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const call = { command: command.constructor.name, input: command.input };
			sent.push(call);
			return answer(call);
		}) as unknown as SendFn,
	} as Partial<DynamoDBDocumentClient> as DynamoDBDocumentClient;
	const store = initDynamoDbPrivateItem({ client, tableName: "articles", userArticlesTableName: "user-articles" });
	return { store, sent };
}

const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const KEY = "uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const OWNER = UserIdSchema.parse("owner-user");
const SAVED_AT = new Date("2026-11-05T10:00:00.000Z");
const SAVE = { url: PRIVATE_URL, ownerUserId: OWNER, media: { kind: "book" as const, fileName: "dune.epub" }, savedAt: SAVED_AT };

function lostCondition() {
	return new TransactionCanceledException({
		$metadata: {},
		message: "cancelled",
		CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
	});
}

describe("initDynamoDbPrivateItem savePrivateItem", () => {
	it("writes the owner's articles row and user-articles row in one transaction", async () => {
		const { store, sent } = harness(() => ({}));

		assert.equal(await store.savePrivateItem(SAVE), "saved");

		const routeId = ReaderArticleHashId.from(PRIVATE_URL).value;
		assert.equal(sent.length, 1);
		assert.equal(sent[0].command, "TransactWriteCommand");
		assert.deepEqual(sent[0].input.TransactItems, [
			{
				Put: {
					TableName: "articles",
					Item: {
						url: KEY,
						routeId,
						originalUrl: PRIVATE_URL,
						title: "dune.epub",
						siteName: "Book",
						excerpt: "",
						wordCount: 0,
						estimatedReadTime: 0,
						savedAt: "2026-11-05T10:00:00.000Z",
						imageUrl: null,
						publishedOn: null,
						contentSelectionRevision: 1,
						ownerUserId: OWNER,
						media: { kind: "book", fileName: "dune.epub", routeId },
						crawlStatus: "pending",
						crawlPendingSince: "2026-11-05T10:00:00.000Z",
					},
					ConditionExpression: "attribute_not_exists(#url)",
					ExpressionAttributeNames: { "#url": "url" },
				},
			},
			{
				Put: {
					TableName: "user-articles",
					Item: {
						userId: OWNER,
						url: KEY,
						savedAt: "2026-11-05T10:00:00.000Z",
						status: "unread",
						provenance: { kind: "upload" },
					},
				},
			},
		]);
	});

	it("answers already-saved when the same owner's row exists", async () => {
		const { store, sent } = harness(({ command }) => {
			if (command === "TransactWriteCommand") throw lostCondition();
			return { Item: { ownerUserId: "owner-user" } };
		});

		assert.equal(await store.savePrivateItem(SAVE), "already-saved");
		assert.deepEqual(sent[1], {
			command: "GetCommand",
			input: {
				TableName: "articles",
				Key: { url: KEY },
				ConsistentRead: true,
				ProjectionExpression: "#ownerUserId",
				ExpressionAttributeNames: { "#ownerUserId": "ownerUserId" },
			},
		});
	});

	it("refuses to treat another owner's row as already saved", async () => {
		const { store } = harness(({ command }) => {
			if (command === "TransactWriteCommand") throw lostCondition();
			return { Item: { ownerUserId: "someone-else" } };
		});

		await assert.rejects(store.savePrivateItem(SAVE), /saved by its uploader only/);
	});

	it.each([
		new Error("offline"),
		new TransactionCanceledException({ $metadata: {}, message: "unknown" }),
		new TransactionCanceledException({
			$metadata: {},
			message: "capacity",
			CancellationReasons: [{ Code: "ProvisionedThroughputExceeded" }],
		}),
	])("rethrows a failure that is not a lost condition: %s", async (failure) => {
		const { store } = harness(() => {
			throw failure;
		});

		await assert.rejects(store.savePrivateItem(SAVE), (error: unknown) => error === failure);
	});
});

describe("initDynamoDbPrivateItem recordPrivateItemFailure", () => {
	it("marks the owned row failed with the processing notice", async () => {
		const { store, sent } = harness(() => ({}));

		assert.equal(await store.recordPrivateItemFailure({ url: PRIVATE_URL, notice: "This book is protected by DRM." }), "recorded");

		assert.deepEqual(sent[0].input, {
			TableName: "articles",
			Key: { url: KEY },
			UpdateExpression: "SET crawlStatus = :failed, crawlFailureReason = :reason, processingNotice = :notice",
			ConditionExpression: "attribute_exists(ownerUserId)",
			ExpressionAttributeValues: {
				":failed": "failed",
				":reason": JSON.stringify({ kind: "processing-failed", notice: "This book is protected by DRM." }),
				":notice": "This book is protected by DRM.",
			},
		});
	});

	it("answers not-found when the row is gone", async () => {
		const { store } = harness(() => {
			throw new ConditionalCheckFailedException({ $metadata: {}, message: "missing" });
		});

		assert.equal(await store.recordPrivateItemFailure({ url: PRIVATE_URL, notice: "gone" }), "not-found");
	});

	it("rethrows any other failure", async () => {
		const failure = new Error("offline");
		const { store } = harness(() => {
			throw failure;
		});

		await assert.rejects(store.recordPrivateItemFailure({ url: PRIVATE_URL, notice: "gone" }), (error: unknown) => error === failure);
	});
});

describe("initDynamoDbPrivateItem recordPrivateItemSections", () => {
	it("records the section count on an owned row that was not purged", async () => {
		const { store, sent } = harness(() => ({}));

		assert.equal(await store.recordPrivateItemSections({ url: PRIVATE_URL, sectionCount: 12 }), "recorded");

		assert.deepEqual(sent[0].input, {
			TableName: "articles",
			Key: { url: KEY },
			UpdateExpression: "SET media.sectionCount = :sectionCount",
			ConditionExpression: "attribute_exists(ownerUserId) AND attribute_not_exists(purgedAt)",
			ExpressionAttributeValues: { ":sectionCount": 12 },
		});
	});

	it("answers not-found when the row is missing or carries purgedAt", async () => {
		const { store } = harness(() => {
			throw new ConditionalCheckFailedException({ $metadata: {}, message: "missing or purged" });
		});

		assert.equal(await store.recordPrivateItemSections({ url: PRIVATE_URL, sectionCount: 12 }), "not-found");
	});
});
