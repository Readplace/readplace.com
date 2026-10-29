import assert from "node:assert";
import { randomBytes } from "node:crypto";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type {
	MintBrowserHandoffCode,
	RedeemBrowserHandoffCode,
} from "@packages/provider-contracts/browser-handoff";
import { BrowserHandoffCodeSchema } from "@packages/provider-contracts/browser-handoff";

const CODE_TTL_SECONDS = 60;

const BrowserHandoffRow = z.object({
	code: z.string(),
	userId: UserIdSchema,
	emailVerified: z.boolean(),
	oauthClientId: z.string(),
	expiresAt: z.number(),
});

export function initDynamoDbBrowserHandoff(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): {
	mintBrowserHandoffCode: MintBrowserHandoffCode;
	redeemBrowserHandoffCode: RedeemBrowserHandoffCode;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: BrowserHandoffRow,
	});

	const nowSeconds = () => Math.floor(deps.now().getTime() / 1000);

	const mintBrowserHandoffCode: MintBrowserHandoffCode = async ({ userId, emailVerified, oauthClientId }) => {
		const code = BrowserHandoffCodeSchema.parse(randomBytes(32).toString("base64url"));
		await table.put({
			Item: { code, userId, emailVerified, oauthClientId, expiresAt: nowSeconds() + CODE_TTL_SECONDS },
		});
		return code;
	};

	const redeemBrowserHandoffCode: RedeemBrowserHandoffCode = async (code) => {
		try {
			const { Attributes } = await table.delete({
				Key: { code },
				ConditionExpression: "attribute_exists(#code)",
				ExpressionAttributeNames: { "#code": "code" },
				ReturnValues: "ALL_OLD",
			});

			assert(Attributes, "a conditional delete with ReturnValues ALL_OLD always returns the prior item");

			if (Attributes.expiresAt < nowSeconds()) {
				return { ok: false, reason: "invalid-code" };
			}

			return {
				ok: true,
				userId: Attributes.userId,
				emailVerified: Attributes.emailVerified,
				oauthClientId: Attributes.oauthClientId,
			};
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				return { ok: false, reason: "invalid-code" };
			}
			throw error;
		}
	};

	return { mintBrowserHandoffCode, redeemBrowserHandoffCode };
}
