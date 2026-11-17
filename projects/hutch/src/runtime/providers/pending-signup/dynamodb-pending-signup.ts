import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	writeIfCondition,
} from "@packages/storage-client";
import type { Logger } from "@packages/logger";
import { z } from "zod";
import { UserIdSchema, normalizeEmail } from "@packages/domain/user";
import {
	CheckoutOfferSchema,
	CheckoutSessionIdSchema,
	CheckoutVariantSchema,
	SubscribePlansSourceSchema,
} from "@packages/provider-contracts/hosted-checkout";
import { BillingPlanSchema } from "@packages/provider-contracts/subscription-providers";
import type {
	ClaimPendingSignup,
	ConsumedPendingSignup,
	DeletePendingSignupsByUser,
	FindPendingSignup,
	StorePendingSignup,
} from "@packages/provider-contracts/pending-signup";
import type { UserId } from "@packages/domain/user";

const PendingSignupRow = z.object({
	checkoutSessionId: CheckoutSessionIdSchema,
	method: z.string(),
	email: z.string(),
	userId: dynamoField(UserIdSchema),
	returnUrl: dynamoField(z.string()),
	trialEndsAt: dynamoField(z.string()),
	variant: dynamoField(z.string()),
	plan: dynamoField(z.string()),
	entrySource: dynamoField(z.string()),
	offer: dynamoField(z.string()),
	createdAt: dynamoField(z.number()),
	consumedAt: dynamoField(z.string()),
	activatedBy: dynamoField(z.string()),
});

type PendingSignupRecord = z.infer<typeof PendingSignupRow>;

function toSignup(row: PendingSignupRecord, userId: UserId): ConsumedPendingSignup {
	const variant = CheckoutVariantSchema.safeParse(row.variant);
	const plan = BillingPlanSchema.safeParse(row.plan);
	const entrySource = SubscribePlansSourceSchema.safeParse(row.entrySource);
	const offer = CheckoutOfferSchema.safeParse(row.offer);
	return {
		method: EXISTING_USER_SUBSCRIBE,
		email: row.email,
		userId,
		...(row.returnUrl ? { returnUrl: row.returnUrl } : {}),
		...(row.trialEndsAt ? { trialEndsAt: row.trialEndsAt } : {}),
		...(variant.success ? { variant: variant.data } : {}),
		...(plan.success ? { plan: plan.data } : {}),
		entrySource: entrySource.success ? entrySource.data : null,
		offer: offer.success ? offer.data : null,
	};
}

const RefusedClaimRow = z.object({
	method: z.object({ S: z.string() }),
	consumedAt: z.object({ S: z.string() }).optional(),
	returnUrl: z.object({ S: z.string() }).optional(),
});

const EXISTING_USER_SUBSCRIBE = "existing-user-subscribe";

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
	logger: Logger;
}): {
	storePendingSignup: StorePendingSignup;
	findPendingSignup: FindPendingSignup;
	claimPendingSignup: ClaimPendingSignup;
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
				...(signup.variant ? { variant: signup.variant } : {}),
				...(signup.plan ? { plan: signup.plan } : {}),
				...(signup.entrySource ? { entrySource: signup.entrySource } : {}),
				offer: signup.offer,
			},
		});
	};

	const findPendingSignup: FindPendingSignup = async (checkoutSessionId) => {
		const row = await table.get({ checkoutSessionId }, { consistentRead: true });
		if (!row) return { outcome: "not-found" };
		if (row.method !== EXISTING_USER_SUBSCRIBE || !row.userId) {
			deps.logger.warn(
				`[pending-signup] refused to read legacy '${row.method}' row for checkout session ${checkoutSessionId}`,
			);
			return { outcome: "not-found" };
		}
		if (row.consumedAt) {
			return {
				outcome: "already-activated",
				...(row.returnUrl ? { returnUrl: row.returnUrl } : {}),
			};
		}
		return { outcome: "pending", signup: toSignup(row, row.userId) };
	};

	const claimPendingSignup: ClaimPendingSignup = async ({ checkoutSessionId, activatedBy, claimedAt }) => {
		const written = await writeIfCondition(() =>
			table.update({
				Key: { checkoutSessionId },
				UpdateExpression: "SET consumedAt = :consumedAt, activatedBy = :activatedBy",
				ConditionExpression:
					"attribute_exists(checkoutSessionId) AND attribute_not_exists(consumedAt) AND #method = :method",
				ExpressionAttributeNames: { "#method": "method" },
				ExpressionAttributeValues: {
					":consumedAt": claimedAt,
					":activatedBy": activatedBy,
					":method": EXISTING_USER_SUBSCRIBE,
				},
				ReturnValues: "ALL_NEW",
				ReturnValuesOnConditionCheckFailure: "ALL_OLD",
			}),
		);

		if (written.kind === "condition-failed") {
			if (!written.oldItem) return { outcome: "not-found" };
			const refused = RefusedClaimRow.parse(written.oldItem);
			if (refused.consumedAt) {
				return {
					outcome: "already-activated",
					...(refused.returnUrl ? { returnUrl: refused.returnUrl.S } : {}),
				};
			}
			deps.logger.warn(
				`[pending-signup] refused to claim legacy '${refused.method.S}' row for checkout session ${checkoutSessionId}`,
			);
			return { outcome: "not-found" };
		}

		const Attributes = written.result.Attributes;
		if (!Attributes?.userId) return { outcome: "not-found" };
		const signup = toSignup(Attributes, Attributes.userId);
		return { outcome: "claimed", signup };
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
		findPendingSignup,
		claimPendingSignup,
		deleteByUser,
	};
}
