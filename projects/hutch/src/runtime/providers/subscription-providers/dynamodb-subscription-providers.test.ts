import assert from "node:assert/strict";
import { z } from "zod";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbSubscriptionProviders } from "./dynamodb-subscription-providers";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(
	impl: (input: unknown) => unknown,
): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	};
}

const TABLE = "test-subscription-providers";
const NOW = () => new Date("2026-05-22T10:00:00.000Z");
const USER_ID = UserIdSchema.parse("u-1");

const CapturedUpdateCommand = z.object({
	input: z.object({
		UpdateExpression: z.string(),
		ExpressionAttributeNames: z.record(z.string(), z.string()),
		ExpressionAttributeValues: z.record(z.string(), z.unknown()),
	}),
});

describe("initDynamoDbSubscriptionProviders", () => {
	describe("findByUserId", () => {
		it("returns undefined when no row exists", async () => {
			const client = createFakeClient(() => ({ Item: undefined }));
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			expect(await subs.findByUserId(USER_ID)).toBeUndefined();
		});

		it("returns a parsed trialing record when a row exists with trialEndsAt", async () => {
			const client = createFakeClient(() => ({
				Item: {
					userId: USER_ID,
					provider: "stripe",
					status: "trialing",
					trialEndsAt: "2026-06-05T00:00:00.000Z",
					createdAt: "2026-05-22T10:00:00.000Z",
					updatedAt: "2026-05-22T10:00:00.000Z",
				},
			}));
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			const row = await subs.findByUserId(USER_ID);
			assert(row, "row must be returned");
			expect(row.status).toBe("trialing");
			expect(row.trialEndsAt).toBe("2026-06-05T00:00:00.000Z");
			expect(row.subscriptionId).toBeUndefined();
			expect(row.customerId).toBeUndefined();
			expect(row.cancellationEffectiveAt).toBeUndefined();
		});

		it("returns a parsed active record with subscriptionId and customerId", async () => {
			const client = createFakeClient(() => ({
				Item: {
					userId: USER_ID,
					provider: "stripe",
					status: "active",
					subscriptionId: "sub_123",
					customerId: "cus_123",
					createdAt: "2026-05-20T10:00:00.000Z",
					updatedAt: "2026-05-22T10:00:00.000Z",
				},
			}));
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			const row = await subs.findByUserId(USER_ID);
			assert(row, "row must be returned");
			expect(row.status).toBe("active");
			expect(row.subscriptionId).toBe("sub_123");
			expect(row.customerId).toBe("cus_123");
			expect(row.trialEndsAt).toBeUndefined();
		});

		it("returns a parsed pending_cancellation record with cancellationEffectiveAt", async () => {
			const client = createFakeClient(() => ({
				Item: {
					userId: USER_ID,
					provider: "stripe",
					status: "pending_cancellation",
					subscriptionId: "sub_pc",
					customerId: "cus_pc",
					cancellationEffectiveAt: "2026-06-22T00:00:00.000Z",
					createdAt: "2026-05-20T10:00:00.000Z",
					updatedAt: "2026-05-22T10:00:00.000Z",
				},
			}));
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			const row = await subs.findByUserId(USER_ID);
			assert(row, "row must be returned");
			expect(row.status).toBe("pending_cancellation");
			expect(row.cancellationEffectiveAt).toBe("2026-06-22T00:00:00.000Z");
		});
	});

	describe("findBySubscriptionId", () => {
		it("issues a Query against subscriptionId-index", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {
					Items: [
						{
							userId: USER_ID,
							provider: "stripe",
							status: "active",
							subscriptionId: "sub_x",
							customerId: "cus_x",
							createdAt: "2026-05-20T10:00:00.000Z",
							updatedAt: "2026-05-22T10:00:00.000Z",
						},
					],
					Count: 1,
				};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			const row = await subs.findBySubscriptionId("sub_x");
			assert(row, "row must be returned");
			expect(row.userId).toBe(USER_ID);
			expect(row.subscriptionId).toBe("sub_x");

			const command = received as {
				input: {
					IndexName?: string;
					KeyConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
					Limit?: number;
				};
			};
			expect(command.input.IndexName).toBe("subscriptionId-index");
			expect(command.input.KeyConditionExpression).toContain("subscriptionId = :sid");
			expect(command.input.ExpressionAttributeValues?.[":sid"]).toBe("sub_x");
			expect(command.input.Limit).toBe(1);
		});

		it("returns undefined when the GSI query returns no items", async () => {
			const client = createFakeClient(() => ({ Items: [], Count: 0 }));
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			expect(await subs.findBySubscriptionId("sub_missing")).toBeUndefined();
		});
	});

	describe("upsertTrialing", () => {
		it("issues an Update that sets status=trialing, trialEndsAt, and removes Stripe ids", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await subs.upsertTrialing({ userId: USER_ID, trialEndsAt: "2026-06-05T00:00:00.000Z" });

			const command = received as {
				input: {
					Key?: Record<string, unknown>;
					UpdateExpression?: string;
					ExpressionAttributeNames?: Record<string, string>;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.Key).toEqual({ userId: USER_ID });
			expect(command.input.UpdateExpression).toContain("SET");
			expect(command.input.UpdateExpression).toContain("#status = :status");
			expect(command.input.UpdateExpression).toContain("trialEndsAt = :trialEndsAt");
			expect(command.input.UpdateExpression).toContain("#provider = :provider");
			expect(command.input.UpdateExpression).toContain("if_not_exists(createdAt, :now)");
			expect(command.input.UpdateExpression).toContain("updatedAt = :now");
			expect(command.input.UpdateExpression).toContain("REMOVE");
			expect(command.input.UpdateExpression).toContain("subscriptionId");
			expect(command.input.UpdateExpression).toContain("customerId");
			expect(command.input.UpdateExpression).toContain("cancellationEffectiveAt");
			expect(command.input.UpdateExpression).toContain("automationSavesHeldEmailSentAt");
			expect(command.input.UpdateExpression).toContain("nextCharge");
			expect(command.input.UpdateExpression).toContain("#plan");
			expect(command.input.ExpressionAttributeNames?.["#status"]).toBe("status");
			expect(command.input.ExpressionAttributeNames?.["#provider"]).toBe("provider");
			expect(command.input.ExpressionAttributeNames?.["#plan"]).toBe("plan");
			expect(command.input.ExpressionAttributeValues?.[":status"]).toBe("trialing");
			expect(command.input.ExpressionAttributeValues?.[":provider"]).toBe("stripe");
			expect(command.input.ExpressionAttributeValues?.[":trialEndsAt"]).toBe(
				"2026-06-05T00:00:00.000Z",
			);
			expect(command.input.ExpressionAttributeValues?.[":now"]).toBe(
				"2026-05-22T10:00:00.000Z",
			);
		});
	});

	describe("upsertActive", () => {
		it("issues an Update that sets status=active, Stripe ids, and removes trialEndsAt", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await subs.upsertActive({
				userId: USER_ID,
				subscriptionId: "sub_abc",
				customerId: "cus_abc",
			});

			const command = received as {
				input: {
					Key?: Record<string, unknown>;
					UpdateExpression?: string;
					ExpressionAttributeNames?: Record<string, string>;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.Key).toEqual({ userId: USER_ID });
			expect(command.input.UpdateExpression).toContain("#status = :status");
			expect(command.input.UpdateExpression).toContain("subscriptionId = :subscriptionId");
			expect(command.input.UpdateExpression).toContain("customerId = :customerId");
			expect(command.input.UpdateExpression).toContain("REMOVE");
			expect(command.input.UpdateExpression).toContain("trialEndsAt");
			expect(command.input.UpdateExpression).toContain("cancellationEffectiveAt");
			expect(command.input.UpdateExpression).toContain("automationSavesHeldEmailSentAt");
			expect(command.input.UpdateExpression).toContain("nextCharge");
			expect(command.input.ExpressionAttributeValues?.[":status"]).toBe("active");
			expect(command.input.ExpressionAttributeValues?.[":subscriptionId"]).toBe("sub_abc");
			expect(command.input.ExpressionAttributeValues?.[":customerId"]).toBe("cus_abc");
		});

		it("writes the plan the subscription was created on", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await subs.upsertActive({
				userId: USER_ID,
				subscriptionId: "sub_abc",
				customerId: "cus_abc",
				plan: "triennial",
			});

			const command = CapturedUpdateCommand.parse(received);
			expect(command.input.UpdateExpression).toContain("#plan = :plan");
			expect(command.input.ExpressionAttributeNames["#plan"]).toBe("plan");
			expect(command.input.ExpressionAttributeValues[":plan"]).toBe("triennial");
		});

		it("clears the plan attribute when the subscription names none, so a grandfathered subscription cannot inherit a plan the row happened to hold", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await subs.upsertActive({
				userId: USER_ID,
				subscriptionId: "sub_abc",
				customerId: "cus_abc",
			});

			const command = CapturedUpdateCommand.parse(received);
			const [, removeClause] = command.input.UpdateExpression.split("REMOVE");
			expect(removeClause).toContain("#plan");
			expect(command.input.ExpressionAttributeValues[":plan"]).toBeUndefined();
		});
	});

	describe("markPendingCancellation", () => {
		it("issues a guarded Update that sets pending_cancellation and effective date", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await subs.markPendingCancellation({
				userId: USER_ID,
				cancellationEffectiveAt: "2026-06-22T00:00:00.000Z",
			});

			const command = received as {
				input: {
					Key?: Record<string, unknown>;
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.Key).toEqual({ userId: USER_ID });
			expect(command.input.UpdateExpression).toContain("#status = :status");
			expect(command.input.UpdateExpression).toContain(
				"cancellationEffectiveAt = :effectiveAt",
			);
			expect(command.input.UpdateExpression).toContain("updatedAt = :now");
			expect(command.input.UpdateExpression).toContain("REMOVE nextCharge");
			expect(command.input.ConditionExpression).toContain("attribute_exists(userId)");
			expect(command.input.ExpressionAttributeValues?.[":status"]).toBe(
				"pending_cancellation",
			);
			expect(command.input.ExpressionAttributeValues?.[":effectiveAt"]).toBe(
				"2026-06-22T00:00:00.000Z",
			);
		});
	});

	describe("markCancelledByUserId", () => {
		it("issues a guarded Update that sets cancelled and removes trialEndsAt + cancellationEffectiveAt + nextCharge", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await subs.markCancelledByUserId({ userId: USER_ID });

			const command = received as {
				input: {
					Key?: Record<string, unknown>;
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.Key).toEqual({ userId: USER_ID });
			expect(command.input.UpdateExpression).toContain("SET #status = :cancelled");
			expect(command.input.UpdateExpression).toContain("updatedAt = :now");
			expect(command.input.UpdateExpression).toContain(
				"REMOVE trialEndsAt, cancellationEffectiveAt, nextCharge",
			);
			expect(command.input.ConditionExpression).toContain("attribute_exists(userId)");
			expect(command.input.ExpressionAttributeValues?.[":cancelled"]).toBe("cancelled");
			expect(command.input.ExpressionAttributeValues?.[":now"]).toBe(
				"2026-05-22T10:00:00.000Z",
			);
		});
	});

	describe("markActive", () => {
		it("issues a guarded Update that sets status=active and removes cancellationEffectiveAt", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await subs.markActive({ userId: USER_ID });

			const command = received as {
				input: {
					Key?: Record<string, unknown>;
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.Key).toEqual({ userId: USER_ID });
			expect(command.input.UpdateExpression).toContain("#status = :status");
			expect(command.input.UpdateExpression).toContain("REMOVE cancellationEffectiveAt");
			expect(command.input.UpdateExpression).toContain("automationSavesHeldEmailSentAt");
			expect(command.input.ConditionExpression).toContain("attribute_exists(userId)");
			expect(command.input.ExpressionAttributeValues?.[":status"]).toBe("active");
		});
	});

	describe("markAutomationSavesHeldEmailSent", () => {
		it("claims the marker with a condition that only the first writer can satisfy", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			const claim = await subs.markAutomationSavesHeldEmailSent({
				userId: USER_ID,
				sentAt: "2026-06-06T00:00:00.000Z",
			});

			expect(claim).toBe("claimed");
			const command = received as {
				input: {
					Key?: Record<string, unknown>;
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.Key).toEqual({ userId: USER_ID });
			expect(command.input.UpdateExpression).toContain(
				"automationSavesHeldEmailSentAt = :sentAt",
			);
			expect(command.input.UpdateExpression).toContain("updatedAt = :now");
			expect(command.input.ConditionExpression).toContain("attribute_exists(userId)");
			expect(command.input.ConditionExpression).toContain(
				"attribute_not_exists(automationSavesHeldEmailSentAt)",
			);
			expect(command.input.ExpressionAttributeValues?.[":sentAt"]).toBe(
				"2026-06-06T00:00:00.000Z",
			);
		});

		it("reports already-sent when a concurrent writer took the marker first", async () => {
			const client = createFakeClient(() => {
				throw new ConditionalCheckFailedException({
					message: "The conditional request failed",
					$metadata: {},
				});
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			const claim = await subs.markAutomationSavesHeldEmailSent({
				userId: USER_ID,
				sentAt: "2026-06-06T00:00:00.000Z",
			});

			expect(claim).toBe("already-sent");
		});

		it("propagates a fault that is not the claim being lost", async () => {
			const client = createFakeClient(() => {
				throw new Error("throttled");
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await expect(
				subs.markAutomationSavesHeldEmailSent({
					userId: USER_ID,
					sentAt: "2026-06-06T00:00:00.000Z",
				}),
			).rejects.toThrow("throttled");
		});
	});

	describe("markTrialFeedbackEmailSent", () => {
		it("issues a guarded Update that records trialFeedbackEmailSentAt and bumps updatedAt", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await subs.markTrialFeedbackEmailSent({
				userId: USER_ID,
				sentAt: "2026-06-04T00:00:00.000Z",
			});

			const command = received as {
				input: {
					Key?: Record<string, unknown>;
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.Key).toEqual({ userId: USER_ID });
			expect(command.input.UpdateExpression).toContain(
				"trialFeedbackEmailSentAt = :sentAt",
			);
			expect(command.input.UpdateExpression).toContain("updatedAt = :now");
			expect(command.input.ConditionExpression).toContain("attribute_exists(userId)");
			expect(command.input.ExpressionAttributeValues?.[":sentAt"]).toBe(
				"2026-06-04T00:00:00.000Z",
			);
			expect(command.input.ExpressionAttributeValues?.[":now"]).toBe(
				"2026-05-22T10:00:00.000Z",
			);
		});
	});

	describe("markTrialReminderEmailSent", () => {
		it("issues a guarded Update that records trialReminderEmailSentAt and bumps updatedAt", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await subs.markTrialReminderEmailSent({
				userId: USER_ID,
				sentAt: "2026-07-17T00:00:00.000Z",
			});

			const command = received as {
				input: {
					Key?: Record<string, unknown>;
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.Key).toEqual({ userId: USER_ID });
			expect(command.input.UpdateExpression).toContain(
				"trialReminderEmailSentAt = :sentAt",
			);
			expect(command.input.UpdateExpression).toContain("updatedAt = :now");
			expect(command.input.ConditionExpression).toContain("attribute_exists(userId)");
			expect(command.input.ExpressionAttributeValues?.[":sentAt"]).toBe(
				"2026-07-17T00:00:00.000Z",
			);
			expect(command.input.ExpressionAttributeValues?.[":now"]).toBe(
				"2026-05-22T10:00:00.000Z",
			);
		});
	});

	describe("setNextCharge", () => {
		it("issues a guarded Update that only writes when the row is still the active subscription it was read from", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			const nextCharge = {
				at: "2026-08-12T10:00:00.000Z",
				amountMinor: 4900,
				currency: "usd",
			};
			await subs.setNextCharge({ userId: USER_ID, subscriptionId: "sub_abc", nextCharge });

			const command = received as {
				input: {
					Key?: Record<string, unknown>;
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeNames?: Record<string, string>;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.Key).toEqual({ userId: USER_ID });
			expect(command.input.UpdateExpression).toContain("nextCharge = :nextCharge");
			expect(command.input.UpdateExpression).toContain("updatedAt = :now");
			expect(command.input.ConditionExpression).toContain("attribute_exists(userId)");
			expect(command.input.ConditionExpression).toContain("#status = :active");
			expect(command.input.ConditionExpression).toContain(
				"subscriptionId = :subscriptionId",
			);
			expect(command.input.ExpressionAttributeNames?.["#status"]).toBe("status");
			expect(command.input.ExpressionAttributeValues?.[":nextCharge"]).toEqual(nextCharge);
			expect(command.input.ExpressionAttributeValues?.[":active"]).toBe("active");
			expect(command.input.ExpressionAttributeValues?.[":subscriptionId"]).toBe("sub_abc");
		});
	});

	describe("findByUserId with nextCharge", () => {
		it("parses an active row that carries a stored renewal", async () => {
			const nextCharge = {
				at: "2026-08-12T10:00:00.000Z",
				amountMinor: 4900,
				currency: "usd",
			};
			const client = createFakeClient(() => ({
				Item: {
					userId: USER_ID,
					provider: "stripe",
					status: "active",
					subscriptionId: "sub_abc",
					customerId: "cus_abc",
					nextCharge,
					createdAt: "2026-05-20T10:00:00.000Z",
					updatedAt: "2026-05-22T10:00:00.000Z",
				},
			}));
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			const row = await subs.findByUserId(USER_ID);
			assert(row, "row must be returned");
			expect(row.nextCharge).toEqual(nextCharge);
		});
	});

	describe("deleteSubscription", () => {
		it("issues an unconditioned Delete keyed by userId so it is idempotent", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await subs.deleteSubscription({ userId: USER_ID });

			const command = received as {
				input: {
					Key?: Record<string, unknown>;
					ConditionExpression?: string;
				};
			};
			expect(command.input.Key).toEqual({ userId: USER_ID });
			expect(command.input.ConditionExpression).toBeUndefined();
		});
	});

	describe("findByUserId with trialFeedbackEmailSentAt", () => {
		it("parses a cancelled trial row that carries trialFeedbackEmailSentAt", async () => {
			const client = createFakeClient(() => ({
				Item: {
					userId: USER_ID,
					provider: "stripe",
					status: "cancelled",
					trialFeedbackEmailSentAt: "2026-06-04T00:00:00.000Z",
					createdAt: "2026-05-20T10:00:00.000Z",
					updatedAt: "2026-06-04T00:00:00.000Z",
				},
			}));
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			const row = await subs.findByUserId(USER_ID);
			assert(row, "row must be returned");
			expect(row.trialFeedbackEmailSentAt).toBe("2026-06-04T00:00:00.000Z");
		});
	});

	describe("upsertTrialing clears the pay-digest marker", () => {
		it("removes both pay-digest attributes, so a re-opened trial gets its own pay digest", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await subs.upsertTrialing({ userId: USER_ID, trialEndsAt: "2026-06-05T00:00:00.000Z" });

			const command = CapturedUpdateCommand.parse(received);
			const [, removeClause] = command.input.UpdateExpression.split("REMOVE");
			expect(removeClause).toContain("payDigestEmailSentAt");
			expect(removeClause).toContain("payDigestMessageId");
			expect(removeClause).toContain("payDigestUrls");
		});
	});

	describe("pay-digest claim", () => {
		const CapturedPayDigestCommand = z.object({
			input: z.object({
				Key: z.record(z.string(), z.unknown()),
				ConsistentRead: z.boolean().optional(),
				UpdateExpression: z.string().optional(),
				ConditionExpression: z.string().optional(),
				ExpressionAttributeNames: z.record(z.string(), z.string()).optional(),
				ExpressionAttributeValues: z.record(z.string(), z.unknown()).optional(),
			}),
		});
		type CapturedPayDigestInput = z.infer<typeof CapturedPayDigestCommand>["input"];

		const TRIAL_ENDS_AT = "2026-06-05T00:00:00.000Z";
		const SEND_INSTANT = new Date("2026-06-01T06:00:00.000Z");
		const MESSAGE_ID = "msg-pay-1";
		const LISTED_URLS = ["https://example.com/newest", "https://example.com/older"];
		const CONDITION_FAILED = new ConditionalCheckFailedException({
			message: "The conditional request failed",
			$metadata: {},
		});

		function trialingRowHeldBy(payDigest: {
			payDigestEmailSentAt?: string;
			payDigestMessageId?: string;
			payDigestUrls?: string[];
		}) {
			return {
				userId: USER_ID,
				provider: "stripe",
				status: "trialing",
				trialEndsAt: TRIAL_ENDS_AT,
				...payDigest,
				createdAt: "2026-05-22T10:00:00.000Z",
				updatedAt: "2026-06-01T06:00:00.000Z",
			};
		}

		function createPayDigestClient(opts: {
			updateError?: Error;
			heldRow?: Record<string, unknown>;
		}) {
			const commands: CapturedPayDigestInput[] = [];
			const client = createFakeClient((command) => {
				const { input } = CapturedPayDigestCommand.parse(command);
				commands.push(input);
				if (input.UpdateExpression !== undefined && opts.updateError) throw opts.updateError;
				if (input.UpdateExpression === undefined) return { Item: opts.heldRow };
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});
			return { subs, commands };
		}

		describe("claimPayDigest", () => {
			it("claims with one conditional write that only this trial's first sender can satisfy", async () => {
				const { subs, commands } = createPayDigestClient({});

				const claim = await subs.claimPayDigest({
					userId: USER_ID,
					trialEndsAt: TRIAL_ENDS_AT,
					messageId: MESSAGE_ID,
					now: SEND_INSTANT,
					urls: LISTED_URLS,
				});

				assert.deepEqual(claim, { claimed: true, redelivery: false });
				assert.equal(commands.length, 1);
				const [update] = commands;
				assert(update, "the claim is a single UpdateItem");
				assert.deepEqual(update.Key, { userId: USER_ID });
				assert.equal(
					update.UpdateExpression,
					"SET payDigestEmailSentAt = :now, payDigestMessageId = :mid, payDigestUrls = :urls, updatedAt = :now",
				);
				assert.equal(
					update.ConditionExpression,
					"attribute_exists(userId) AND #status = :trialing AND trialEndsAt = :trialEndsAt AND attribute_not_exists(payDigestEmailSentAt)",
				);
				assert.deepEqual(update.ExpressionAttributeNames, { "#status": "status" });
				assert.deepEqual(update.ExpressionAttributeValues, {
					":now": "2026-06-01T06:00:00.000Z",
					":mid": MESSAGE_ID,
					":urls": LISTED_URLS,
					":trialing": "trialing",
					":trialEndsAt": TRIAL_ENDS_AT,
				});
			});

			it("reports a redelivery carrying the original claim instant and the urls that send listed when the marker already names this message", async () => {
				const { subs, commands } = createPayDigestClient({
					updateError: CONDITION_FAILED,
					heldRow: trialingRowHeldBy({
						payDigestEmailSentAt: "2026-06-01T00:00:00.000Z",
						payDigestMessageId: MESSAGE_ID,
						payDigestUrls: ["https://example.com/emailed"],
					}),
				});

				const claim = await subs.claimPayDigest({
					userId: USER_ID,
					trialEndsAt: TRIAL_ENDS_AT,
					messageId: MESSAGE_ID,
					now: SEND_INSTANT,
					urls: LISTED_URLS,
				});

				assert.deepEqual(claim, {
					claimed: true,
					redelivery: true,
					claimedAt: new Date("2026-06-01T00:00:00.000Z"),
					urls: ["https://example.com/emailed"],
				});
				const writes = commands.filter((command) => command.UpdateExpression !== undefined);
				assert.equal(writes.length, 1);
				const read = commands.find((command) => command.UpdateExpression === undefined);
				assert(read, "a rejected claim reads the row back");
				assert.deepEqual(read.Key, { userId: USER_ID });
				assert.equal(read.ConsistentRead, true);
			});

			it("reports no claim when another message already holds the marker", async () => {
				const { subs } = createPayDigestClient({
					updateError: CONDITION_FAILED,
					heldRow: trialingRowHeldBy({
						payDigestEmailSentAt: "2026-06-01T00:00:00.000Z",
						payDigestMessageId: "msg-pay-other",
					}),
				});

				const claim = await subs.claimPayDigest({
					userId: USER_ID,
					trialEndsAt: TRIAL_ENDS_AT,
					messageId: MESSAGE_ID,
					now: SEND_INSTANT,
					urls: LISTED_URLS,
				});

				assert.deepEqual(claim, { claimed: false });
			});

			it("reports no claim when the row no longer carries this trial and no marker names this message", async () => {
				const { subs } = createPayDigestClient({
					updateError: CONDITION_FAILED,
					heldRow: {
						userId: USER_ID,
						provider: "stripe",
						status: "active",
						subscriptionId: "sub_paid",
						customerId: "cus_paid",
						createdAt: "2026-05-22T10:00:00.000Z",
						updatedAt: "2026-06-01T05:00:00.000Z",
					},
				});

				const claim = await subs.claimPayDigest({
					userId: USER_ID,
					trialEndsAt: TRIAL_ENDS_AT,
					messageId: MESSAGE_ID,
					now: SEND_INSTANT,
					urls: LISTED_URLS,
				});

				assert.deepEqual(claim, { claimed: false });
			});

			it("reports no claim when the row vanished before the write", async () => {
				const { subs } = createPayDigestClient({ updateError: CONDITION_FAILED });

				const claim = await subs.claimPayDigest({
					userId: USER_ID,
					trialEndsAt: TRIAL_ENDS_AT,
					messageId: MESSAGE_ID,
					now: SEND_INSTANT,
					urls: LISTED_URLS,
				});

				assert.deepEqual(claim, { claimed: false });
			});

			it("propagates a fault that is not the claim being lost", async () => {
				const { subs } = createPayDigestClient({ updateError: new Error("throttled") });

				await assert.rejects(
					subs.claimPayDigest({
						userId: USER_ID,
						trialEndsAt: TRIAL_ENDS_AT,
						messageId: MESSAGE_ID,
						now: SEND_INSTANT,
						urls: LISTED_URLS,
					}),
					/throttled/,
				);
			});
		});

		describe("releasePayDigest", () => {
			it("removes the marker attributes and the listed urls only while they still hold this message's claim", async () => {
				const { subs, commands } = createPayDigestClient({});

				await subs.releasePayDigest({
					userId: USER_ID,
					claimedAt: SEND_INSTANT,
					messageId: MESSAGE_ID,
				});

				assert.equal(commands.length, 1);
				const [update] = commands;
				assert(update, "the release is a single UpdateItem");
				assert.deepEqual(update.Key, { userId: USER_ID });
				assert.equal(update.UpdateExpression, "REMOVE payDigestEmailSentAt, payDigestMessageId, payDigestUrls");
				assert.equal(
					update.ConditionExpression,
					"payDigestEmailSentAt = :claimedAt AND payDigestMessageId = :mid",
				);
				assert.deepEqual(update.ExpressionAttributeValues, {
					":claimedAt": "2026-06-01T06:00:00.000Z",
					":mid": MESSAGE_ID,
				});
			});

			it("is a no-op when the marker no longer holds this message's claim", async () => {
				const { subs } = createPayDigestClient({ updateError: CONDITION_FAILED });

				await assert.doesNotReject(
					subs.releasePayDigest({
						userId: USER_ID,
						claimedAt: SEND_INSTANT,
						messageId: MESSAGE_ID,
					}),
				);
			});

			it("propagates a fault that is not the condition failing", async () => {
				const { subs } = createPayDigestClient({ updateError: new Error("throttled") });

				await assert.rejects(
					subs.releasePayDigest({
						userId: USER_ID,
						claimedAt: SEND_INSTANT,
						messageId: MESSAGE_ID,
					}),
					/throttled/,
				);
			});
		});
	});
});
