import { type DynamoDBDocumentClient, TransactWriteCommand } from "@packages/storage-client";
import { type MarkLinkSavedWhileQueued, inboxSavedLinkKey } from "@packages/domain/inbox";

export function initDynamoDbMarkLinkSavedWhileQueued(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	savedLinksTableName: string;
	userArticlesTableName: string;
	now: () => Date;
}): MarkLinkSavedWhileQueued {
	return async ({ userId, url, queueRowKey }) => {
		await deps.client.send(new TransactWriteCommand({
			TransactItems: [
				{
					ConditionCheck: {
						TableName: deps.userArticlesTableName,
						Key: { userId: queueRowKey.userId, url: queueRowKey.url },
						ConditionExpression: "attribute_exists(savedAt)",
					},
				},
				{
					Put: {
						TableName: deps.savedLinksTableName,
						Item: {
							userId,
							linkKey: inboxSavedLinkKey(url),
							state: "saved",
							updatedAt: deps.now().toISOString(),
							url,
						},
					},
				},
			],
		}));
	};
}
