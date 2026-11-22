import { type DynamoDBDocumentClient, defineDynamoTable, dynamoField } from "@packages/storage-client";
import { z } from "zod";
import { UserIdSchema, normalizeEmail } from "@packages/domain/user";
import { SessionRow } from "@packages/web-session";
import type { FindSessionAdminMfaVerifiedAt, FindUserByEmail } from "@packages/provider-contracts/auth";

const AdminUserRow = z.object({
	email: z.string(),
	userId: UserIdSchema,
	emailVerified: dynamoField(z.boolean()),
	registeredAt: dynamoField(z.string()),
	deletedAt: dynamoField(z.string()),
});

export function initDynamoDbAdminAccess(deps: {
	client: DynamoDBDocumentClient;
	usersTableName: string;
	sessionsTableName: string;
}): { findUserByEmail: FindUserByEmail; findSessionAdminMfaVerifiedAt: FindSessionAdminMfaVerifiedAt } {
	const users = defineDynamoTable({ client: deps.client, tableName: deps.usersTableName, schema: AdminUserRow });
	const sessions = defineDynamoTable({ client: deps.client, tableName: deps.sessionsTableName, schema: SessionRow });

	const findUserByEmail: FindUserByEmail = async (email) => {
		const row = await users.get(
			{ email: normalizeEmail(email) },
			{ projection: ["email", "userId", "emailVerified", "registeredAt", "deletedAt"] },
		);
		if (!row || row.deletedAt) return null;
		return {
			userId: row.userId,
			emailVerified: row.emailVerified === true,
			registeredAt: row.registeredAt,
		};
	};

	const findSessionAdminMfaVerifiedAt: FindSessionAdminMfaVerifiedAt = async (sessionId) => {
		const row = await sessions.get({ sessionId }, { consistentRead: true });
		return row?.adminMfaVerifiedAt;
	};

	return { findUserByEmail, findSessionAdminMfaVerifiedAt };
}
