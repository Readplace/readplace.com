import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import type { HutchLogger } from "@packages/hutch-logger";
import { z } from "zod";
import { UserIdSchema, normalizeEmail } from "@packages/domain/user";
import {
	CheckoutSessionIdSchema,
	CheckoutVariantSchema,
} from "@packages/provider-contracts/hosted-checkout";
import type {
	ConsumePendingSignup,
	DeletePendingSignupsByUser,
	PendingSignup,
	StorePendingSignup,
} from "@packages/provider-contracts/pending-signup";

const PendingSignupRow = z.object({
	checkoutSessionId: CheckoutSessionIdSchema,
	/** z.string(), not the live `existing-user-subscribe` literal: table.delete()
	 * parses ALL_OLD *after* the DeleteCommand removes the row, so a literal
	 * mismatch on a leftover pre-Phase-1 email/google row would throw post-delete
	 * (HTTP 500 + a silently destroyed paid customer). consumePendingSignup
	 * narrows to the contract and skips anything else. */
	method: z.string(),
	email: z.string(),
	userId: dynamoField(UserIdSchema),
	returnUrl: dynamoField(z.string()),
	trialEndsAt: dynamoField(z.string()),
	/** z.string() for the same reason as `method`: an unrecognised variant on a
	 * leftover row must not throw during the post-delete parse. Narrowed on read. */
	variant: dynamoField(z.string()),
	createdAt: dynamoField(z.number()),
});

/** Projection for the deletion scrub: the key to delete by, plus the two handles
 * a deleted user can be matched on. `userId` is optional because legacy
 * pre-userId rows carry only `{checkoutSessionId, method, email}`. */
const ScrubScanRow = z.object({
	checkoutSessionId: CheckoutSessionIdSchema,
	email: z.string(),
	userId: dynamoField(UserIdSchema),
});

export function initDynamoDbPendingSignup(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	logger: HutchLogger;
}): {
	storePendingSignup: StorePendingSignup;
	consumePendingSignup: ConsumePendingSignup;
	deleteByUser: DeletePendingSignupsByUser;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: PendingSignupRow,
	});

	const scrubTable = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ScrubScanRow,
	});

	const storePendingSignup: StorePendingSignup = async ({ checkoutSessionId, signup, createdAt }) => {
		await table.put({
			Item: {
				checkoutSessionId,
				method: signup.method,
				email: signup.email,
				createdAt,
				userId: signup.userId,
				...(signup.returnUrl ? { returnUrl: signup.returnUrl } : {}),
				...(signup.trialEndsAt ? { trialEndsAt: signup.trialEndsAt } : {}),
				...(signup.variant ? { variant: signup.variant } : {})
			},
		});
	};

	const consumePendingSignup: ConsumePendingSignup = async (checkoutSessionId) => {
		const { Attributes } = await table.delete({
			Key: { checkoutSessionId },
			ReturnValues: "ALL_OLD",
		});
		if (!Attributes) return null;

		if (Attributes.method !== "existing-user-subscribe") {
			deps.logger.warn(
				`[pending-signup] discarded legacy '${Attributes.method}' row for checkout session ${checkoutSessionId}; the DeleteCommand has already removed it, so this warning is the only remaining trace`,
			);
			return null;
		}

		const userId = Attributes.userId;
		if (!userId) return null;
		const returnUrl = Attributes.returnUrl ?? undefined;
		const trialEndsAt = Attributes.trialEndsAt ?? undefined;
		const variant = CheckoutVariantSchema.safeParse(Attributes.variant);
		const signup: PendingSignup = {
			method: "existing-user-subscribe",
			email: Attributes.email,
			userId,
			...(returnUrl ? { returnUrl } : {}),
			...(trialEndsAt ? { trialEndsAt } : {}),
			...(variant.success ? { variant: variant.data } : {}),
		};
		return signup;
	};

	const deleteByUser: DeletePendingSignupsByUser = async ({ userId, email }) => {
		// No TTL on this table, so an abandoned-checkout row keeps the deleted user's
		// email + userId forever unless purged. Match on userId OR the normalized
		// email — a server-side FilterExpression can't reach legacy pre-userId rows
		// (no userId) nor normalize the raw-cased email they stored, so scan the
		// full table and compare client-side, deleting each match by its PK.
		const normalizedEmail = email === null ? null : normalizeEmail(email);
		let ExclusiveStartKey: Record<string, unknown> | undefined;
		do {
			const { items, lastEvaluatedKey } = await scrubTable.scan({
				ProjectionExpression: "checkoutSessionId, email, userId",
				ExclusiveStartKey,
			});
			for (const row of items) {
				const matchesUser = row.userId === userId;
				const matchesEmail =
					normalizedEmail !== null && normalizeEmail(row.email) === normalizedEmail;
				if (matchesUser || matchesEmail) {
					await table.delete({ Key: { checkoutSessionId: row.checkoutSessionId } });
				}
			}
			ExclusiveStartKey = lastEvaluatedKey;
		} while (ExclusiveStartKey);
	};

	return {
		storePendingSignup,
		consumePendingSignup,
		deleteByUser,
	};
}
