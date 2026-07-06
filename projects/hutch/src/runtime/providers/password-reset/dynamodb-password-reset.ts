import assert from "node:assert";
import { randomBytes } from "node:crypto";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { normalizeEmail } from "@packages/domain/user";
import type {
	CreatePasswordResetToken,
	DeletePasswordResetTokensByEmail,
	VerifyPasswordResetToken,
} from "@packages/provider-contracts/password-reset";
import { PasswordResetTokenSchema } from "@packages/provider-contracts/password-reset";

const TOKEN_TTL_SECONDS = 60 * 60;

const PasswordResetRow = z.object({
	token: z.string(),
	email: z.string(),
	expiresAt: z.number(),
});

const TokenKeyRow = z.object({
	token: z.string(),
});

export function initDynamoDbPasswordReset(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	createPasswordResetToken: CreatePasswordResetToken;
	verifyPasswordResetToken: VerifyPasswordResetToken;
	deleteTokensByEmail: DeletePasswordResetTokensByEmail;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: PasswordResetRow,
	});

	const tokenKeyTable = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: TokenKeyRow,
	});

	const createPasswordResetToken: CreatePasswordResetToken = async ({ email }) => {
		const token = PasswordResetTokenSchema.parse(randomBytes(32).toString("hex"));
		const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;

		// Store the normalized (lowercased) email so a mixed-case reset request
		// (`John@Example.com`) is matched — and erased immediately — by the deletion
		// scrub, which filters on the normalized users-table PK. An un-normalized row
		// escapes the synchronous scrub and lingers until the `expiresAt` TTL reaps it.
		await table.put({ Item: { token, email: normalizeEmail(email), expiresAt } });

		return token;
	};

	const verifyPasswordResetToken: VerifyPasswordResetToken = async (token) => {
		try {
			const { Attributes } = await table.delete({
				Key: { token },
				ConditionExpression: "attribute_exists(#tk)",
				ExpressionAttributeNames: { "#tk": "token" },
				ReturnValues: "ALL_OLD",
			});

			assert(Attributes, "a conditional delete with ReturnValues ALL_OLD always returns the prior item");

			if (Attributes.expiresAt < Math.floor(Date.now() / 1000)) {
				return { ok: false, reason: "invalid-token" };
			}

			return { ok: true, email: Attributes.email };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				return { ok: false, reason: "invalid-token" };
			}
			throw error;
		}
	};

	const deleteTokensByEmail: DeletePasswordResetTokensByEmail = async (email) => {
		// Purge every row for this email now so deletion erases the token immediately;
		// the `expiresAt` TTL only reaps an unexpired token later, after it lapses.
		let ExclusiveStartKey: Record<string, unknown> | undefined;
		do {
			const { items, lastEvaluatedKey } = await tokenKeyTable.scan({
				FilterExpression: "email = :e",
				ExpressionAttributeValues: { ":e": normalizeEmail(email) },
				ProjectionExpression: "#tk",
				ExpressionAttributeNames: { "#tk": "token" },
				ExclusiveStartKey,
			});
			for (const { token } of items) await table.delete({ Key: { token } });
			ExclusiveStartKey = lastEvaluatedKey;
		} while (ExclusiveStartKey);
	};

	return { createPasswordResetToken, verifyPasswordResetToken, deleteTokensByEmail };
}
