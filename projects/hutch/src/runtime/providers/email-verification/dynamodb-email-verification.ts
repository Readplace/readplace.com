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
	VerifyEmailToken,
} from "@packages/provider-contracts/email-verification";
import { VerificationTokenSchema } from "@packages/test-fixtures/providers/email-verification";
import { VERIFICATION_WINDOW_MS } from "../../domain/access/verification-deadline";

// Keep the single mailed link valid for the whole lockout window, so it never
// expires before the account does.
const TOKEN_TTL_SECONDS = VERIFICATION_WINDOW_MS / 1000;

const VerificationRow = z.object({
	token: z.string(),
	userId: UserIdSchema,
	email: z.string(),
	expiresAt: z.number(),
});

export function initDynamoDbEmailVerification(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	createVerificationToken: CreateVerificationToken;
	verifyEmailToken: VerifyEmailToken;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: VerificationRow,
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

	return { createVerificationToken, verifyEmailToken };
}
