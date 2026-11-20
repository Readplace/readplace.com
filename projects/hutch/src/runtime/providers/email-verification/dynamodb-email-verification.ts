import { randomBytes } from "node:crypto";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	writeIfCondition,
} from "@packages/storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type {
	ConsumeAgeUnlockToken,
	CreateAgeUnlockToken,
	CreateVerificationToken,
	DeleteVerificationTokensByUserId,
	VerifyEmailToken,
} from "@packages/provider-contracts/email-verification";
import { VerificationTokenSchema } from "@packages/provider-contracts/email-verification";

const TOKEN_TTL_SECONDS = 48 * 60 * 60;
const AGE_UNLOCK_TTL_SECONDS = 30 * 24 * 60 * 60;

const VerificationRow = z.object({
	token: z.string(),
	userId: UserIdSchema,
	email: z.string(),
	expiresAt: z.number(),
	purpose: dynamoField(z.literal("age-unlock")),
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
	createAgeUnlockToken: CreateAgeUnlockToken;
	consumeAgeUnlockToken: ConsumeAgeUnlockToken;
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

	const consumeLiveToken = async (args: { token: string; purpose: "email" | "age-unlock" }) => {
		const outcome = await writeIfCondition(() =>
			table.delete({
				Key: { token: args.token },
				...(args.purpose === "email"
					? { ConditionExpression: "attribute_exists(#tk) AND attribute_not_exists(purpose)" }
					: {
							ConditionExpression: "attribute_exists(#tk) AND purpose = :purpose",
							ExpressionAttributeValues: { ":purpose": args.purpose },
						}),
				ExpressionAttributeNames: { "#tk": "token" },
				ReturnValues: "ALL_OLD",
			}),
		);
		if (outcome.kind === "condition-failed") return null;
		const { Attributes } = outcome.result;
		if (!Attributes) return null;
		if (Attributes.expiresAt < Math.floor(Date.now() / 1000)) return null;
		return Attributes;
	};

	const verifyEmailToken: VerifyEmailToken = async (token) => {
		const row = await consumeLiveToken({ token, purpose: "email" });
		if (!row) return { ok: false, reason: "invalid-token" };
		return { ok: true, userId: row.userId, email: row.email };
	};

	const createAgeUnlockToken: CreateAgeUnlockToken = async ({ userId, email }) => {
		const token = VerificationTokenSchema.parse(randomBytes(32).toString("hex"));
		const expiresAt = Math.floor(Date.now() / 1000) + AGE_UNLOCK_TTL_SECONDS;
		await table.put({ Item: { token, userId, email, expiresAt, purpose: "age-unlock" } });
		return token;
	};

	const consumeAgeUnlockToken: ConsumeAgeUnlockToken = async (token) => {
		const row = await consumeLiveToken({ token, purpose: "age-unlock" });
		if (!row) return { ok: false, reason: "invalid-token" };
		return { ok: true, userId: row.userId };
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

	return { createVerificationToken, verifyEmailToken, createAgeUnlockToken, consumeAgeUnlockToken, deleteTokensByUserId };
}
