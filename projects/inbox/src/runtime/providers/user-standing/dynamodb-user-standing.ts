import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { SessionRow } from "@packages/web-session";
import type {
	FindUserById,
	MarkSessionEmailVerified,
} from "@packages/provider-contracts/auth";

/** The slice of hutch's users-table row this deployable reads: just enough to
 * resolve verification standing. The projection below keeps the read to these
 * attributes, so the row schema deliberately omits everything else. */
const UserStandingRow = z.object({
	userId: UserIdSchema,
	emailVerified: dynamoField(z.boolean()),
	registeredAt: dynamoField(z.string()),
});

/** Read/heal access to the user and session rows hutch owns, scoped to what
 * resolveVerificationStatus needs: the verification standing anchored on
 * `registeredAt`, and the session self-heal write once the record says
 * verified. */
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
			ProjectionExpression: "userId, emailVerified, registeredAt",
			Limit: 1,
		});
		const row = items[0];
		if (!row) return null;
		return {
			userId: row.userId,
			emailVerified: row.emailVerified === true,
			registeredAt: row.registeredAt,
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
