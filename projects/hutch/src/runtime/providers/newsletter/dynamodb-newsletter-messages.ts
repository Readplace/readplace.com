/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import {
	NewsletterMessageIdSchema,
	type NewsletterMessage,
	type NewsletterMessageStore,
	type NewsletterMessageSummary,
} from "@packages/domain/newsletter";

const MessageRow = z.object({
	userId: UserIdSchema,
	messageId: NewsletterMessageIdSchema,
	subject: z.string(),
	fromAddress: z.string(),
	receivedAt: z.string(),
	html: z.string(),
	savedLinks: z.array(z.object({ url: z.string(), articleId: z.string() })),
	skippedCount: z.number().int(),
});

function toMessage(row: z.infer<typeof MessageRow>): NewsletterMessage {
	return {
		id: row.messageId,
		userId: row.userId,
		subject: row.subject,
		fromAddress: row.fromAddress,
		receivedAt: row.receivedAt,
		html: row.html,
		savedLinks: row.savedLinks.map((link) => ({
			url: link.url,
			articleId: ReaderArticleHashIdSchema.parse(link.articleId),
		})),
		skippedCount: row.skippedCount,
	};
}

function toSummary(row: z.infer<typeof MessageRow>): NewsletterMessageSummary {
	return {
		id: row.messageId,
		subject: row.subject,
		receivedAt: row.receivedAt,
		savedCount: row.savedLinks.length,
	};
}

export function initDynamoDbNewsletterMessages(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): NewsletterMessageStore {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: MessageRow,
	});

	return {
		recordMessage: async (message) => {
			await table.put({
				Item: {
					userId: message.userId,
					messageId: message.id,
					subject: message.subject,
					fromAddress: message.fromAddress,
					receivedAt: message.receivedAt,
					html: message.html,
					savedLinks: message.savedLinks.map((link) => ({
						url: link.url,
						articleId: link.articleId.value,
					})),
					skippedCount: message.skippedCount,
				},
			});
		},
		listMessages: async (userId) => {
			const { items } = await table.query({
				KeyConditionExpression: "userId = :uid",
				ExpressionAttributeValues: { ":uid": userId },
				ScanIndexForward: false,
			});
			return items.map(toSummary);
		},
		findMessage: async ({ userId, id }) => {
			const { items } = await table.query({
				KeyConditionExpression: "userId = :uid",
				FilterExpression: "messageId = :mid",
				ExpressionAttributeValues: { ":uid": userId, ":mid": id },
			});
			const row = items[0];
			return row ? toMessage(row) : undefined;
		},
	};
}
/* c8 ignore stop */
