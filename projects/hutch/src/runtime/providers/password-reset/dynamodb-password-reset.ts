/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { randomBytes } from "node:crypto";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import type {
	CreatePasswordResetToken,
	VerifyPasswordResetToken,
} from "@packages/provider-contracts/password-reset";
import { PasswordResetTokenSchema } from "@packages/test-fixtures/providers/password-reset";

const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

const PasswordResetRow = z.object({
	token: z.string(),
	email: z.string(),
	expiresAt: z.number(),
});

export function initDynamoDbPasswordReset(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	createPasswordResetToken: CreatePasswordResetToken;
	verifyPasswordResetToken: VerifyPasswordResetToken;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: PasswordResetRow,
	});

	const createPasswordResetToken: CreatePasswordResetToken = async ({ email }) => {
		const token = PasswordResetTokenSchema.parse(randomBytes(32).toString("hex"));
		const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;

		await table.put({ Item: { token, email, expiresAt } });

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

			if (!Attributes) {
				return { ok: false, reason: "invalid-token" };
			}

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

	return { createPasswordResetToken, verifyPasswordResetToken };
}
/* c8 ignore stop */
