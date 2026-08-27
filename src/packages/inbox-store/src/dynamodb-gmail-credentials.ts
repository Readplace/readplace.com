import { type DynamoDBDocumentClient, defineDynamoTable } from "@packages/hutch-storage-client";
import { z } from "zod";
import type { GmailCredentialsStore } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";

const GmailCredentialsRow = z.object({
	userId: UserIdSchema,
	refreshToken: z.string(),
	grantedScope: z.string(),
	connectedAt: z.string(),
});

export function initDynamoDbGmailCredentials(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): GmailCredentialsStore {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: GmailCredentialsRow,
	});

	return {
		saveCredentials: async ({ userId, refreshToken, grantedScope }) => {
			await table.put({
				Item: {
					userId,
					refreshToken,
					grantedScope,
					connectedAt: deps.now().toISOString(),
				},
			});
		},
		findRefreshTokenByUserId: async (userId) => {
			const row = await table.get({ userId });
			return row?.refreshToken;
		},
		deleteCredentials: async (userId) => {
			await table.delete({ Key: { userId } });
		},
	};
}
