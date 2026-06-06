/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { randomBytes } from "node:crypto";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import {
	NEWSLETTER_INBOX_TOKEN_BYTES,
	NewsletterInboxTokenSchema,
	type NewsletterInboxStore,
} from "@packages/domain/newsletter";

/** Single table, two access patterns keyed by a prefixed `pk`:
 *   `user#<userId>`  → the user's token (display + idempotent create)
 *   `token#<token>`  → the owning userId (inbound routing)
 * Two point-reads/writes, no GSI. */
const InboxRow = z.object({
	pk: z.string(),
	userId: dynamoField(UserIdSchema),
	token: dynamoField(NewsletterInboxTokenSchema),
});

const userKey = (userId: string) => `user#${userId}`;
const tokenKey = (token: string) => `token#${token}`;

export function initDynamoDbNewsletterInbox(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): NewsletterInboxStore {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: InboxRow,
	});

	return {
		findInbox: async (userId) => {
			const row = await table.get({ pk: userKey(userId) });
			return row?.token ? { userId, token: row.token } : undefined;
		},
		getOrCreateInbox: async (userId) => {
			const existing = await table.get({ pk: userKey(userId) });
			if (existing?.token) return { userId, token: existing.token };
			const token = NewsletterInboxTokenSchema.parse(
				randomBytes(NEWSLETTER_INBOX_TOKEN_BYTES).toString("hex"),
			);
			await table.put({ Item: { pk: userKey(userId), token } });
			await table.put({ Item: { pk: tokenKey(token), userId } });
			return { userId, token };
		},
		findUserIdByInboxToken: async (token) => {
			const row = await table.get({ pk: tokenKey(token) });
			return row?.userId;
		},
	};
}
/* c8 ignore stop */
