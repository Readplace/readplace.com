import { randomBytes } from "node:crypto";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type {
	CreateVerificationToken,
	DeleteVerificationTokensByUserId,
	VerifyEmailToken,
} from "@packages/provider-contracts/email-verification";
import { VerificationTokenSchema } from "@packages/provider-contracts/email-verification";
import { VERIFICATION_WINDOW_MS } from "@packages/domain/user";

// Keep the single mailed link valid for the whole lockout window, so it never
// expires before the account does.
const TOKEN_TTL_SECONDS = VERIFICATION_WINDOW_MS / 1000;

const VerificationRow = z.object({
	token: z.string(),
	userId: UserIdSchema,
	email: z.string(),
	expiresAt: z.number(),
});

const TokenKeyRow = z.object({
	token: z.string(),
});

export function initDynamoDbEmailVerification(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	createVerificationToken: CreateVerificationToken;
	verifyEmailToken: VerifyEmailToken;
	deleteTokensByUserId: DeleteVerificationTokensByUserId;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: VerificationRow,
	});

	const tokenKeyTable = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: TokenKeyRow,
	});

	const createVerificationToken: CreateVerificationToken = async ({ userId, email }) => {
		const token = VerificationTokenSchema.parse(randomBytes(32).toString("hex"));
		const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;

		await table.put({ Item: { token, userId, email, expiresAt } });

		return token;
	};

	const verifyEmailToken: VerifyEmailToken = async (token) => {
		try {
			const { Attributes } = await table.delete({
				Key: { token },
				ConditionExpression: "attribute_exists(#tk)",
				ExpressionAttributeNames: { "#tk": "token" },
				ReturnValues: "ALL_OLD",
			});

			if (!Attributes) {
				return { ok: false, reason: "invalid-token" };
			}

			if (Attributes.expiresAt < Math.floor(Date.now() / 1000)) {
				return { ok: false, reason: "invalid-token" };
			}

			return {
				ok: true,
				userId: Attributes.userId,
				email: Attributes.email,
			};
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				return { ok: false, reason: "invalid-token" };
			}
			throw error;
		}
	};

	const deleteTokensByUserId: DeleteVerificationTokensByUserId = async (userId) => {
		// Scan-and-delete by userId. The table's TTL eventually evicts an abandoned
		// token, but deletion must erase the {userId, email} remnant now rather than
		// leave it readable for the remainder of the verification window.
		let ExclusiveStartKey: Record<string, unknown> | undefined;
		do {
			const { items, lastEvaluatedKey } = await tokenKeyTable.scan({
				FilterExpression: "userId = :u",
				ExpressionAttributeValues: { ":u": userId },
				ProjectionExpression: "#tk",
				ExpressionAttributeNames: { "#tk": "token" },
				ExclusiveStartKey,
			});
			for (const { token } of items) await table.delete({ Key: { token } });
			ExclusiveStartKey = lastEvaluatedKey;
		} while (ExclusiveStartKey);
	};

	return { createVerificationToken, verifyEmailToken, deleteTokensByUserId };
}
