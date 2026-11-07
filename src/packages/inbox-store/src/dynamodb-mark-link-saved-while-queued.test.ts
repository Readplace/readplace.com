import { TransactionCanceledException } from "@packages/storage-client";
import { inboxSavedLinkKey } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbMarkLinkSavedWhileQueued } from "./dynamodb-mark-link-saved-while-queued";

const SAVED_LINKS_TABLE = "hutch-inbox-saved-links-test";
const USER_ARTICLES_TABLE = "user-articles-test";
const userId = UserIdSchema.parse("user-1");
const now = () => new Date("2026-11-03T10:00:00.000Z");
const queueRowKey = { userId: "user-1#queue/work", url: "example.com/post" };

type TransactInput = { TransactItems?: Record<string, unknown>[] };

function fakeClient(answer: () => Promise<unknown> = async () => ({})) {
	const sent: TransactInput[] = [];
	const client = {
		send: async (command: { input: TransactInput }) => {
			sent.push(command.input);
			return answer();
		},
	};
	const markLinkSavedWhileQueued = initDynamoDbMarkLinkSavedWhileQueued({
		client,
		savedLinksTableName: SAVED_LINKS_TABLE,
		userArticlesTableName: USER_ARTICLES_TABLE,
		now,
	});
	return { markLinkSavedWhileQueued, sent };
}

function cancelledBy(code: string): TransactionCanceledException {
	return new TransactionCanceledException({
		$metadata: {},
		message: "Transaction cancelled",
		CancellationReasons: [{ Code: code }, { Code: "None" }],
	});
}

describe("initDynamoDbMarkLinkSavedWhileQueued", () => {
	it("checks that the queue row still exists under the key it was found at", async () => {
		const { markLinkSavedWhileQueued, sent } = fakeClient();

		await markLinkSavedWhileQueued({ userId, url: "https://example.com/post", queueRowKey });

		expect(sent[0]?.TransactItems?.[0]).toEqual({
			ConditionCheck: {
				TableName: USER_ARTICLES_TABLE,
				Key: queueRowKey,
				ConditionExpression: "attribute_exists(savedAt)",
			},
		});
	});

	it("writes the saved row under the submitted url's key in the same transaction", async () => {
		const { markLinkSavedWhileQueued, sent } = fakeClient();

		await markLinkSavedWhileQueued({ userId, url: "https://example.com/post?utm_source=news", queueRowKey });

		expect(sent[0]?.TransactItems?.[1]).toEqual({
			Put: {
				TableName: SAVED_LINKS_TABLE,
				Item: {
					userId,
					linkKey: inboxSavedLinkKey("https://example.com/post"),
					state: "saved",
					updatedAt: "2026-11-03T10:00:00.000Z",
					url: "https://example.com/post?utm_source=news",
				},
			},
		});
	});

	it.each(["ConditionalCheckFailed", "TransactionConflict"])(
		"rethrows a transaction cancelled by %s, so the record redelivers and re-reads the queue",
		async (code) => {
			const { markLinkSavedWhileQueued } = fakeClient(async () => {
				throw cancelledBy(code);
			});

			await expect(
				markLinkSavedWhileQueued({ userId, url: "https://example.com/post", queueRowKey }),
			).rejects.toBeInstanceOf(TransactionCanceledException);
		},
	);
});
