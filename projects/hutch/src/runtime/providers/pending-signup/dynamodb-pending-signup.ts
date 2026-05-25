/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { CheckoutSessionIdSchema } from "@packages/test-fixtures/providers/stripe-checkout";
import type {
	ConsumePendingSignup,
	ListAllPendingSignups,
	MarkCheckoutRecoveryEmailSent,
	PendingSignup,
	StorePendingSignup,
} from "@packages/test-fixtures/providers/pending-signup";

const PendingSignupRow = z.object({
	checkoutSessionId: CheckoutSessionIdSchema,
	method: z.enum(["email", "google"]),
	email: z.string(),
	passwordHash: dynamoField(z.string()),
	userId: dynamoField(UserIdSchema),
	returnUrl: dynamoField(z.string()),
	createdAt: dynamoField(z.number()),
	checkoutRecoveryEmailSentAt: dynamoField(z.number()),
});

const PendingSignupSummaryRow = z.object({
	checkoutSessionId: CheckoutSessionIdSchema,
	email: z.string(),
	createdAt: dynamoField(z.number()),
	checkoutRecoveryEmailSentAt: dynamoField(z.number()),
});

export function initDynamoDbPendingSignup(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	storePendingSignup: StorePendingSignup;
	consumePendingSignup: ConsumePendingSignup;
	listAllPendingSignups: ListAllPendingSignups;
	markCheckoutRecoveryEmailSent: MarkCheckoutRecoveryEmailSent;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: PendingSignupRow,
	});

	const summaryTable = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: PendingSignupSummaryRow,
	});

	const storePendingSignup: StorePendingSignup = async ({ checkoutSessionId, signup, createdAt }) => {
		await table.put({
			Item: {
				checkoutSessionId,
				method: signup.method,
				email: signup.email,
				createdAt,
				...(signup.method === "email" ? { passwordHash: signup.passwordHash } : {}),
				...(signup.method === "google" ? { userId: signup.userId } : {}),
				...(signup.returnUrl ? { returnUrl: signup.returnUrl } : {})
			},
		});
	};

	const consumePendingSignup: ConsumePendingSignup = async (checkoutSessionId) => {
		const { Attributes } = await table.delete({
			Key: { checkoutSessionId },
			ReturnValues: "ALL_OLD",
		});
		if (!Attributes) return null;

		const returnUrl = Attributes.returnUrl ?? undefined;
		if (Attributes.method === "email") {
			const passwordHash = Attributes.passwordHash;
			if (!passwordHash) return null;
			const signup: PendingSignup = {
				method: "email",
				email: Attributes.email,
				passwordHash,
				...(returnUrl ? { returnUrl } : {}),
			};
			return signup;
		}

		const userId = Attributes.userId;
		if (!userId) return null;
		const signup: PendingSignup = {
			method: "google",
			email: Attributes.email,
			userId,
			...(returnUrl ? { returnUrl } : {}),
		};
		return signup;
	};

	const listAllPendingSignups: ListAllPendingSignups = async () => {
		const summaries = [];
		let lastEvaluatedKey: Record<string, unknown> | undefined;
		do {
			const page = await summaryTable.scan({
				ProjectionExpression:
					"checkoutSessionId, email, createdAt, checkoutRecoveryEmailSentAt",
				ExclusiveStartKey: lastEvaluatedKey,
			});
			for (const row of page.items) {
				summaries.push({
					checkoutSessionId: row.checkoutSessionId,
					email: row.email,
					...(row.createdAt !== undefined ? { createdAt: row.createdAt } : {}),
					...(row.checkoutRecoveryEmailSentAt !== undefined
						? { checkoutRecoveryEmailSentAt: row.checkoutRecoveryEmailSentAt }
						: {}),
				});
			}
			lastEvaluatedKey = page.lastEvaluatedKey;
		} while (lastEvaluatedKey !== undefined);
		return summaries;
	};

	const markCheckoutRecoveryEmailSent: MarkCheckoutRecoveryEmailSent = async ({
		checkoutSessionId,
		sentAt,
	}) => {
		await table.update({
			Key: { checkoutSessionId },
			UpdateExpression: "SET checkoutRecoveryEmailSentAt = :sentAt",
			ExpressionAttributeValues: { ":sentAt": sentAt },
		});
	};

	return {
		storePendingSignup,
		consumePendingSignup,
		listAllPendingSignups,
		markCheckoutRecoveryEmailSent,
	};
}
/* c8 ignore stop */
