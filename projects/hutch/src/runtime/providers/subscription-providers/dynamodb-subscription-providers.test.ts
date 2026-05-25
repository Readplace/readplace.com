import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { ConditionalCheckFailedException } from "@packages/hutch-storage-client";
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
			expect(command.input.ExpressionAttributeNames?.["#status"]).toBe("status");
			expect(command.input.ExpressionAttributeNames?.["#provider"]).toBe("provider");
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
			expect(command.input.ExpressionAttributeValues?.[":status"]).toBe("active");
			expect(command.input.ExpressionAttributeValues?.[":subscriptionId"]).toBe("sub_abc");
			expect(command.input.ExpressionAttributeValues?.[":customerId"]).toBe("cus_abc");
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
			expect(command.input.ConditionExpression).toContain("attribute_exists(userId)");
			expect(command.input.ExpressionAttributeValues?.[":status"]).toBe(
				"pending_cancellation",
			);
			expect(command.input.ExpressionAttributeValues?.[":effectiveAt"]).toBe(
				"2026-06-22T00:00:00.000Z",
			);
		});
	});

	describe("markCancelled", () => {
		it("queries the GSI, then issues a guarded Update keyed on the found userId", async () => {
			const received: unknown[] = [];
			let call = 0;
			const client = createFakeClient((input) => {
				received.push(input);
				call++;
				if (call === 1) {
					return {
						Items: [
							{
								userId: USER_ID,
								provider: "stripe",
								status: "active",
								subscriptionId: "sub_cancel",
								customerId: "cus_cancel",
								createdAt: "2026-05-20T10:00:00.000Z",
								updatedAt: "2026-05-22T10:00:00.000Z",
							},
						],
						Count: 1,
					};
				}
				return {};
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await subs.markCancelled({ subscriptionId: "sub_cancel" });

			const queryCommand = received[0] as {
				input: { IndexName?: string; KeyConditionExpression?: string };
			};
			expect(queryCommand.input.IndexName).toBe("subscriptionId-index");
			expect(queryCommand.input.KeyConditionExpression).toContain(
				"subscriptionId = :sid",
			);

			const updateCommand = received[1] as {
				input: {
					Key?: Record<string, unknown>;
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(updateCommand.input.Key).toEqual({ userId: USER_ID });
			expect(updateCommand.input.UpdateExpression).toContain("#status = :status");
			expect(updateCommand.input.ConditionExpression).toContain(
				"attribute_exists(userId)",
			);
			expect(updateCommand.input.ExpressionAttributeValues?.[":status"]).toBe(
				"cancelled",
			);
		});

		it("throws when the subscriptionId is not present in the GSI", async () => {
			const client = createFakeClient(() => ({ Items: [], Count: 0 }));
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await expect(subs.markCancelled({ subscriptionId: "sub_unknown" })).rejects.toThrow(
				/No subscription row/,
			);
		});
	});

	describe("markCancelledByUserId", () => {
		it("issues a guarded Update that sets cancelled and removes trialEndsAt + cancellationEffectiveAt", async () => {
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
				"REMOVE trialEndsAt, cancellationEffectiveAt",
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
			expect(command.input.ConditionExpression).toContain("attribute_exists(userId)");
			expect(command.input.ExpressionAttributeValues?.[":status"]).toBe("active");
		});
	});

	describe("findByUserIdConsistent", () => {
		it("issues a GetItem with ConsistentRead", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return { Item: undefined };
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});

			await subs.findByUserIdConsistent(USER_ID);

			const command = received as { input: { ConsistentRead?: boolean } };
			expect(command.input.ConsistentRead).toBe(true);
		});

		it("parses and returns the row when present", async () => {
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
			const row = await subs.findByUserIdConsistent(USER_ID);
			assert(row);
			expect(row.status).toBe("trialing");
		});
	});

	describe("upsertCancelled", () => {
		it("issues an Update that sets status=cancelled and removes trial + cancellation + chargeRequestedAt", async () => {
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

			await subs.upsertCancelled({ userId: USER_ID });

			const command = received as {
				input: {
					Key?: Record<string, unknown>;
					UpdateExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.Key).toEqual({ userId: USER_ID });
			expect(command.input.UpdateExpression).toContain("#status = :status");
			expect(command.input.UpdateExpression).toContain("REMOVE");
			expect(command.input.UpdateExpression).toContain("trialEndsAt");
			expect(command.input.UpdateExpression).toContain("chargeRequestedAt");
			expect(command.input.ExpressionAttributeValues?.[":status"]).toBe("cancelled");
		});
	});

	describe("upsertCustomerId", () => {
		it("issues a guarded Update with attribute_not_exists(customerId) and returns ok on success", async () => {
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

			const result = await subs.upsertCustomerId({ userId: USER_ID, customerId: "cus_new" });
			expect(result).toEqual({ ok: true });

			const command = received as {
				input: {
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.ConditionExpression).toContain("attribute_not_exists(customerId)");
			expect(command.input.UpdateExpression).toContain("customerId = :customerId");
			expect(command.input.ExpressionAttributeValues?.[":customerId"]).toBe("cus_new");
		});

		it("returns customer-id-already-set when ConditionalCheckFailedException is thrown", async () => {
			const client = createFakeClient(() => {
				throw new ConditionalCheckFailedException({
					$metadata: {},
					message: "The conditional request failed",
				});
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});
			const result = await subs.upsertCustomerId({ userId: USER_ID, customerId: "cus_loser" });
			expect(result).toEqual({ ok: false, reason: "customer-id-already-set" });
		});

		it("re-throws non-conditional-check errors", async () => {
			const client = createFakeClient(() => {
				throw new Error("network down");
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});
			await expect(
				subs.upsertCustomerId({ userId: USER_ID, customerId: "cus_x" }),
			).rejects.toThrow(/network down/);
		});
	});

	describe("upsertPaymentMethod", () => {
		it("issues a guarded Update that sets pm fields and removes chargeFailed sentinels", async () => {
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

			await subs.upsertPaymentMethod({
				userId: USER_ID,
				paymentMethodId: "pm_x",
				brand: "visa",
				last4: "4242",
			});

			const command = received as {
				input: {
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.ConditionExpression).toContain("attribute_exists(userId)");
			expect(command.input.UpdateExpression).toContain("paymentMethodId = :pm");
			expect(command.input.UpdateExpression).toContain("paymentMethodBrand = :brand");
			expect(command.input.UpdateExpression).toContain("paymentMethodLast4 = :last4");
			expect(command.input.UpdateExpression).toContain("REMOVE chargeFailedAt, chargeFailedReason");
			expect(command.input.ExpressionAttributeValues?.[":pm"]).toBe("pm_x");
			expect(command.input.ExpressionAttributeValues?.[":brand"]).toBe("visa");
			expect(command.input.ExpressionAttributeValues?.[":last4"]).toBe("4242");
		});
	});

	describe("markChargeRequested", () => {
		it("returns ok when the conditional write succeeds", async () => {
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

			const result = await subs.markChargeRequested({
				userId: USER_ID,
				requestedAt: "2026-06-05T00:00:00.000Z",
			});
			expect(result).toEqual({ ok: true });

			const command = received as {
				input: {
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.ConditionExpression).toContain(
				"attribute_exists(userId) AND attribute_not_exists(chargeRequestedAt)",
			);
			expect(command.input.UpdateExpression).toContain("chargeRequestedAt = :req");
			expect(command.input.ExpressionAttributeValues?.[":req"]).toBe("2026-06-05T00:00:00.000Z");
		});

		it("returns charge-already-requested on conditional failure", async () => {
			const client = createFakeClient(() => {
				throw new ConditionalCheckFailedException({
					$metadata: {},
					message: "The conditional request failed",
				});
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});
			const result = await subs.markChargeRequested({
				userId: USER_ID,
				requestedAt: "2026-06-05T00:00:00.000Z",
			});
			expect(result).toEqual({ ok: false, reason: "charge-already-requested" });
		});

		it("re-throws non-conditional-check errors", async () => {
			const client = createFakeClient(() => {
				throw new Error("transient");
			});
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});
			await expect(
				subs.markChargeRequested({ userId: USER_ID, requestedAt: "2026-06-05T00:00:00.000Z" }),
			).rejects.toThrow(/transient/);
		});
	});

	describe("markChargeFailed", () => {
		it("issues a guarded Update that sets chargeFailedAt + reason and removes chargeRequestedAt", async () => {
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

			await subs.markChargeFailed({
				userId: USER_ID,
				failedAt: "2026-06-05T00:01:00.000Z",
				reason: "card_declined",
			});

			const command = received as {
				input: {
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.ConditionExpression).toContain("attribute_exists(userId)");
			expect(command.input.UpdateExpression).toContain("chargeFailedAt = :at");
			expect(command.input.UpdateExpression).toContain("chargeFailedReason = :reason");
			expect(command.input.UpdateExpression).toContain("REMOVE chargeRequestedAt");
			expect(command.input.ExpressionAttributeValues?.[":at"]).toBe("2026-06-05T00:01:00.000Z");
			expect(command.input.ExpressionAttributeValues?.[":reason"]).toBe("card_declined");
		});
	});

	describe("clearChargeFailed", () => {
		it("issues a guarded Update that removes chargeFailed sentinels", async () => {
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

			await subs.clearChargeFailed({ userId: USER_ID });

			const command = received as {
				input: {
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.ConditionExpression).toContain("attribute_exists(userId)");
			expect(command.input.UpdateExpression).toContain("REMOVE chargeFailedAt, chargeFailedReason");
		});
	});

	describe("toRecord (via findByUserId)", () => {
		it("surfaces paymentMethodId, paymentMethodBrand, paymentMethodLast4, chargeRequestedAt, chargeFailedAt, chargeFailedReason when present", async () => {
			const client = createFakeClient(() => ({
				Item: {
					userId: USER_ID,
					provider: "stripe",
					status: "cancelled",
					customerId: "cus_x",
					paymentMethodId: "pm_x",
					paymentMethodBrand: "visa",
					paymentMethodLast4: "4242",
					chargeRequestedAt: "2026-06-05T00:00:00.000Z",
					chargeFailedAt: "2026-06-05T00:01:00.000Z",
					chargeFailedReason: "card_declined",
					createdAt: "2026-05-20T10:00:00.000Z",
					updatedAt: "2026-06-05T00:01:00.000Z",
				},
			}));
			const subs = initDynamoDbSubscriptionProviders({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now: NOW,
			});
			const row = await subs.findByUserId(USER_ID);
			assert(row);
			expect(row.paymentMethodId).toBe("pm_x");
			expect(row.paymentMethodBrand).toBe("visa");
			expect(row.paymentMethodLast4).toBe("4242");
			expect(row.chargeRequestedAt).toBe("2026-06-05T00:00:00.000Z");
			expect(row.chargeFailedAt).toBe("2026-06-05T00:01:00.000Z");
			expect(row.chargeFailedReason).toBe("card_declined");
		});
	});
});
