import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { AppearancePreferenceSchema, DisplayNameSchema, UserIdSchema } from "@packages/domain/user";
import { OAuthClientIdSchema } from "@packages/domain/oauth";
import { SessionRow } from "@packages/web-session";
import type {
	FindUserById,
	MarkSessionEmailVerified,
} from "@packages/provider-contracts/auth";

/** The slice of hutch's users-table row this deployable reads. The projection
 * below keeps the read to these attributes, so the row schema deliberately
 * omits everything else. */
const UserStandingRow = z.object({
	userId: UserIdSchema,
	email: z.string(),
	emailVerified: dynamoField(z.boolean()),
	registeredAt: dynamoField(z.string()),
	appearance: dynamoField(AppearancePreferenceSchema),
	displayName: dynamoField(DisplayNameSchema),
	signupOAuthClientId: dynamoField(OAuthClientIdSchema),
});

/** Read/heal access to the user and session rows hutch owns. */
export function initDynamoDbUserStanding(deps: {
	client: DynamoDBDocumentClient;
	tableNames: { users: string; sessions: string };
}): { findUserById: FindUserById; markSessionEmailVerified: MarkSessionEmailVerified } {
	const users = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableNames.users,
		schema: UserStandingRow,
	});
	const sessions = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableNames.sessions,
		schema: SessionRow,
	});

	const findUserById: FindUserById = async (userId) => {
		const { items } = await users.query({
			IndexName: "userId-index",
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": userId },
			ProjectionExpression: "userId, email, emailVerified, registeredAt, appearance, displayName, signupOAuthClientId",
			Limit: 1,
		});
		const row = items[0];
		if (!row) return null;
		return {
			userId: row.userId,
			email: row.email,
			emailVerified: row.emailVerified === true,
			registeredAt: row.registeredAt,
			appearance: row.appearance,
			displayName: row.displayName,
			signupOAuthClientId: row.signupOAuthClientId ?? null,
		};
	};

	const markSessionEmailVerified: MarkSessionEmailVerified = async (sessionId) => {
		await sessions.update({
			Key: { sessionId },
			UpdateExpression: "SET emailVerified = :val",
			ExpressionAttributeValues: { ":val": true },
		});
	};

	return { findUserById, markSessionEmailVerified };
}
