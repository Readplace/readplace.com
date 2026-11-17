import { CheckoutSessionIdSchema } from "@packages/provider-contracts/hosted-checkout";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { type Logger, noopLogger } from "@packages/logger";
import { initDynamoDbPendingSignup } from "./dynamodb-pending-signup";

type SendFn = DynamoDBDocumentClient["send"];

type CommandInput = {
	Item?: Record<string, unknown>;
	Key?: Record<string, unknown>;
	ReturnValues?: string;
	UpdateExpression?: string;
	ProjectionExpression?: string;
	FilterExpression?: string;
	ExclusiveStartKey?: Record<string, unknown>;
	ExpressionAttributeValues?: Record<string, unknown>;
	ConditionExpression?: string;
	ReturnValuesOnConditionCheckFailure?: string;
	ConsistentRead?: boolean;
};

function createClient(impl: (input: CommandInput) => unknown): {
	client: DynamoDBDocumentClient;
	inputs: CommandInput[];
} {
	const inputs: CommandInput[] = [];
	const client = {
		send: (async (command: { input: CommandInput }) => {
			inputs.push(command.input);
			return impl(command.input);
		}) as unknown as SendFn,
	} as DynamoDBDocumentClient;
	return { client, inputs };
}

const TABLE = "pending-signups";
const SESSION_ID = CheckoutSessionIdSchema.parse("cs_test_123");
const USER_ID = UserIdSchema.parse("user-abc");
const CLAIM = {
	checkoutSessionId: SESSION_ID,
	activatedBy: "webhook",
	claimedAt: "2026-11-15T10:00:00.000Z",
} as const;

function conditionFailed(
	item: ConstructorParameters<typeof ConditionalCheckFailedException>[0]["Item"],
): ConditionalCheckFailedException {
	return new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {}, Item: item });
}

describe("initDynamoDbPendingSignup", () => {
	describe("storePendingSignup", () => {
		it("persists an existing-user-subscribe signup with userId and returnUrl", async () => {
			const { client, inputs } = createClient(() => ({}));
			const { storePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			await storePendingSignup({
				checkoutSessionId: SESSION_ID,
				signup: {
					entrySource: null,
					offer: "none",
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					returnUrl: "/queue",
				},
				createdAt: 300,
			});

			expect(inputs[0]?.Item).toEqual({
				checkoutSessionId: SESSION_ID,
				method: "existing-user-subscribe",
				email: "e@b.com",
				createdAt: 300,
				userId: USER_ID,
				offer: "none",
				returnUrl: "/queue",
			});
		});

		it("persists trialEndsAt for a trial-preserving checkout", async () => {
			const { client, inputs } = createClient(() => ({}));
			const { storePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			await storePendingSignup({
				checkoutSessionId: SESSION_ID,
				signup: {
					entrySource: null,
					offer: "none",
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					returnUrl: "/queue",
					trialEndsAt: "2026-07-24T00:00:00.000Z",
				},
				createdAt: 300,
			});

			expect(inputs[0]?.Item).toEqual({
				checkoutSessionId: SESSION_ID,
				method: "existing-user-subscribe",
				email: "e@b.com",
				createdAt: 300,
				userId: USER_ID,
				offer: "none",
				returnUrl: "/queue",
				trialEndsAt: "2026-07-24T00:00:00.000Z",
			});
		});

		it("persists the checkout variant so the completion can be attributed to its entry path", async () => {
			const { client, inputs } = createClient(() => ({}));
			const { storePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			await storePendingSignup({
				checkoutSessionId: SESSION_ID,
				signup: {
					entrySource: null,
					offer: "none",
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					variant: "cancelled_resubscribe",
				},
				createdAt: 300,
			});

			expect(inputs[0]?.Item).toEqual({
				checkoutSessionId: SESSION_ID,
				method: "existing-user-subscribe",
				email: "e@b.com",
				createdAt: 300,
				userId: USER_ID,
				offer: "none",
				variant: "cancelled_resubscribe",
			});
		});

		it("persists the plan the reader picked, so returning from Stripe records the plan the subscription was created on", async () => {
			const { client, inputs } = createClient(() => ({}));
			const { storePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			await storePendingSignup({
				checkoutSessionId: SESSION_ID,
				signup: {
					entrySource: null,
					offer: "none",
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					plan: "monthly",
				},
				createdAt: 300,
			});

			expect(inputs[0]?.Item).toEqual({
				checkoutSessionId: SESSION_ID,
				method: "existing-user-subscribe",
				email: "e@b.com",
				createdAt: 300,
				userId: USER_ID,
				offer: "none",
				plan: "monthly",
			});
		});

		it("persists the entry source and the offer so the completion can be attributed to what opened the checkout", async () => {
			const { client, inputs } = createClient(() => ({}));
			const { storePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			await storePendingSignup({
				checkoutSessionId: SESSION_ID,
				signup: {
					entrySource: "keep-panel",
					offer: "first-year-49",
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
				},
				createdAt: 300,
			});

			expect(inputs[0]?.Item).toEqual({
				checkoutSessionId: SESSION_ID,
				method: "existing-user-subscribe",
				email: "e@b.com",
				createdAt: 300,
				userId: USER_ID,
				entrySource: "keep-panel",
				offer: "first-year-49",
			});
		});

		it("omits returnUrl when absent", async () => {
			const { client, inputs } = createClient(() => ({}));
			const { storePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			await storePendingSignup({
				checkoutSessionId: SESSION_ID,
				signup: {
					entrySource: null,
					offer: "none",
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
				},
				createdAt: 300,
			});

			expect(inputs[0]?.Item).toEqual({
				checkoutSessionId: SESSION_ID,
				method: "existing-user-subscribe",
				email: "e@b.com",
				createdAt: 300,
				userId: USER_ID,
				offer: "none",
			});
		});
	});

	describe("findPendingSignup", () => {
		function findWith(item: Record<string, unknown> | undefined) {
			const warnings: string[] = [];
			const logger: Logger = { ...noopLogger, warn: (...args) => { warnings.push(String(args[0])); } };
			const { client, inputs } = createClient(() => ({ Item: item }));
			const { findPendingSignup } = initDynamoDbPendingSignup({ client, tableName: TABLE, logger });
			return { find: () => findPendingSignup(SESSION_ID), inputs, warnings };
		}

		it("reads the row with a strongly consistent get and answers pending with the stored signup", async () => {
			const { find, inputs } = findWith({
				checkoutSessionId: SESSION_ID,
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
				returnUrl: "/queue",
				plan: "monthly",
				offer: "none",
			});

			const result = await find();

			expect(inputs[0]?.Key).toEqual({ checkoutSessionId: SESSION_ID });
			expect(inputs[0]).toHaveProperty("ConsistentRead", true);
			expect(result).toEqual({
				outcome: "pending",
				signup: {
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					returnUrl: "/queue",
					plan: "monthly",
					entrySource: null,
					offer: "none",
				},
			});
		});

		it("answers already-activated with the stored return URL once the row is claimed", async () => {
			const { find } = findWith({
				checkoutSessionId: SESSION_ID,
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
				returnUrl: "/queue",
				consumedAt: "2026-11-15T10:00:00.000Z",
			});

			expect(await find()).toEqual({ outcome: "already-activated", returnUrl: "/queue" });
		});

		it("answers already-activated with no return URL when the claimed row stored none", async () => {
			const { find } = findWith({
				checkoutSessionId: SESSION_ID,
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
				consumedAt: "2026-11-15T10:00:00.000Z",
			});

			expect(await find()).toEqual({ outcome: "already-activated" });
		});

		it("answers not-found when no row exists for the checkout session", async () => {
			const { find } = findWith(undefined);

			expect(await find()).toEqual({ outcome: "not-found" });
		});

		it("refuses a legacy row of another signup method, and warns", async () => {
			const { find, warnings } = findWith({
				checkoutSessionId: SESSION_ID,
				method: "email-signup",
				email: "e@b.com",
			});

			expect(await find()).toEqual({ outcome: "not-found" });
			expect(warnings).toEqual([
				"[pending-signup] refused to read legacy 'email-signup' row for checkout session cs_test_123",
			]);
		});

		it("refuses an existing-user subscribe row that carries no userId", async () => {
			const { find, warnings } = findWith({
				checkoutSessionId: SESSION_ID,
				method: "existing-user-subscribe",
				email: "e@b.com",
			});

			expect(await find()).toEqual({ outcome: "not-found" });
			expect(warnings).toHaveLength(1);
		});
	});

	describe("claimPendingSignup", () => {
		it("claims the row once: it stamps consumedAt and the arrival that won, only while the row exists, is unclaimed and is an existing-user subscribe", async () => {
			const { client, inputs } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					consumedAt: CLAIM.claimedAt,
					activatedBy: "webhook",
				},
			}));
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result.outcome).toBe("claimed");
			const update = inputs[0];
			expect(update?.Key).toEqual({ checkoutSessionId: SESSION_ID });
			expect(update?.UpdateExpression).toContain("consumedAt = :consumedAt");
			expect(update?.UpdateExpression).toContain("activatedBy = :activatedBy");
			expect(update?.ConditionExpression).toContain("attribute_exists(checkoutSessionId)");
			expect(update?.ConditionExpression).toContain("attribute_not_exists(consumedAt)");
			expect(update?.ConditionExpression).toContain("#method = :method");
			expect(update?.ExpressionAttributeValues).toEqual({
				":consumedAt": "2026-11-15T10:00:00.000Z",
				":activatedBy": "webhook",
				":method": "existing-user-subscribe",
			});
			expect(update?.ReturnValues).toBe("ALL_NEW");
			expect(update?.ReturnValuesOnConditionCheckFailure).toBe("ALL_OLD");
		});

		it("answers already-activated with the stored return URL when an earlier arrival claimed the row", async () => {
			const { client } = createClient(() => {
				throw conditionFailed({
					checkoutSessionId: { S: SESSION_ID },
					method: { S: "existing-user-subscribe" },
					consumedAt: { S: "2026-11-15T09:59:59.000Z" },
					returnUrl: { S: "/queue" },
				});
			});
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result).toEqual({ outcome: "already-activated", returnUrl: "/queue" });
		});

		it("answers already-activated with no return URL when the claimed row stored none", async () => {
			const { client } = createClient(() => {
				throw conditionFailed({
					checkoutSessionId: { S: SESSION_ID },
					method: { S: "existing-user-subscribe" },
					consumedAt: { S: "2026-11-15T09:59:59.000Z" },
				});
			});
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result).toEqual({ outcome: "already-activated" });
		});

		it("answers not-found when no pending row exists for the checkout session", async () => {
			const { client } = createClient(() => {
				throw conditionFailed(undefined);
			});
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result).toEqual({ outcome: "not-found" });
		});

		it("rethrows a DynamoDB failure that is not a refused condition", async () => {
			const { client } = createClient(() => {
				throw new Error("ProvisionedThroughputExceeded");
			});
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			await expect(claimPendingSignup(CLAIM)).rejects.toThrow("ProvisionedThroughputExceeded");
		});

		it("reconstructs an existing-user-subscribe signup including returnUrl", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					returnUrl: "/account",
				},
			}));
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result).toEqual({ outcome: "claimed", signup: {
				entrySource: null,
				offer: null,
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
				returnUrl: "/account",
			} });
		});

		it("reconstructs an existing-user-subscribe signup without returnUrl", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
				},
			}));
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result).toEqual({ outcome: "claimed", signup: {
				entrySource: null,
				offer: null,
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
			} });
		});

		it("reconstructs the trialEndsAt of a trial-preserving checkout row", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					trialEndsAt: "2026-07-24T00:00:00.000Z",
				},
			}));
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result).toEqual({ outcome: "claimed", signup: {
				entrySource: null,
				offer: null,
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
				trialEndsAt: "2026-07-24T00:00:00.000Z",
			} });
		});

		it("reconstructs the checkout variant of an instrumented row", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					variant: "trial_checkout",
				},
			}));
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result).toEqual({ outcome: "claimed", signup: {
				entrySource: null,
				offer: null,
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
				variant: "trial_checkout",
			} });
		});

		it("reconstructs the plan of a row that carries one", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					plan: "triennial",
				},
			}));
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result).toEqual({ outcome: "claimed", signup: {
				entrySource: null,
				offer: null,
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
				plan: "triennial",
			} });
		});

		it("drops a plan this build no longer sells instead of throwing, for the same reason an unrecognised variant is dropped", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					plan: "a_plan_from_the_future",
				},
			}));
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result).toEqual({ outcome: "claimed", signup: {
				entrySource: null,
				offer: null,
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
			} });
		});

		it("drops an unrecognised variant instead of throwing — the row is already claimed by then, so a parse failure would strand a paying customer's checkout", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					variant: "a_variant_from_the_future",
				},
			}));
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result).toEqual({ outcome: "claimed", signup: {
				entrySource: null,
				offer: null,
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
			} });
		});

		it("reconstructs the entry source and the offer of a row that carries them", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					entrySource: "day3-email",
					offer: "first-year-49",
				},
			}));
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result).toEqual({ outcome: "claimed", signup: {
				entrySource: "day3-email",
				offer: "first-year-49",
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
			} });
		});

		it("reads an unknown entry source and an unknown offer as nulls instead of throwing, because the row is already claimed by then", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					entrySource: "a_source_from_the_future",
					offer: "an_offer_from_the_future",
				},
			}));
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result).toEqual({ outcome: "claimed", signup: {
				entrySource: null,
				offer: null,
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
			} });
		});

		it("answers not-found for an existing-user-subscribe row missing its userId", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "existing-user-subscribe",
					email: "e@b.com",
				},
			}));
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result).toEqual({ outcome: "not-found" });
		});

		it("refuses to claim a leftover legacy email/google row, warns, and answers not-found", async () => {
			const { client } = createClient(() => {
				throw conditionFailed({
					checkoutSessionId: { S: SESSION_ID },
					method: { S: "email" },
					email: { S: "a@b.com" },
				});
			});
			const warnings: string[] = [];
			const logger: Logger = {
				...noopLogger,
				warn: (...args: unknown[]) => {
					warnings.push(args.map(String).join(" "));
				},
			};
			const { claimPendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger,
			});

			const result = await claimPendingSignup(CLAIM);

			expect(result).toEqual({ outcome: "not-found" });
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toMatch(/refused to claim legacy 'email' row/);
		});
	});

	describe("deleteByUser", () => {
		const SCRUB_PROJECTION = "checkoutSessionId, email, userId";

		it("scans every page and deletes rows matching the userId or the normalized email", async () => {
			const pages = [
				{
					Items: [
						{ checkoutSessionId: "cs_by_user", email: "someone@b.com", userId: USER_ID },
						{ checkoutSessionId: "cs_other", email: "keep@b.com", userId: "user-other" },
					],
					LastEvaluatedKey: { checkoutSessionId: "cs_other" },
				},
				{
					// Legacy pre-userId row: no userId, raw mixed-case email that
					// normalizes to the target — reachable only by the email match.
					Items: [{ checkoutSessionId: "cs_legacy", email: "Target@B.com" }],
				},
			];
			let scanCall = 0;
			// The impl is invoked for every command; a DeleteCommand carries a Key,
			// a ScanCommand does not — so return {} for deletes and the next page otherwise.
			const { client, inputs } = createClient((input) =>
				input.Key ? {} : pages[scanCall++],
			);
			const { deleteByUser } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			await deleteByUser({ userId: USER_ID, email: "target@b.com" });

			const scans = inputs.filter((i) => i.ProjectionExpression === SCRUB_PROJECTION);
			expect(scans).toHaveLength(2);
			// No server-side FilterExpression: the full table is scanned and matched
			// client-side, so legacy rows and raw-cased emails are both reached.
			expect(scans[0]?.FilterExpression).toBeUndefined();
			expect(scans[1]?.ExclusiveStartKey).toEqual({ checkoutSessionId: "cs_other" });

			const deletes = inputs.filter((i) => i.Key);
			expect(deletes.map((d) => d.Key)).toEqual([
				{ checkoutSessionId: "cs_by_user" },
				{ checkoutSessionId: "cs_legacy" },
			]);
		});

		it("matches only by userId when the email is already gone (null)", async () => {
			const pages = [
				{
					Items: [
						{ checkoutSessionId: "cs_by_user", email: "a@b.com", userId: USER_ID },
						// Legacy row with the same email but no userId is NOT deleted when
						// there is no email to match on.
						{ checkoutSessionId: "cs_legacy", email: "a@b.com" },
					],
				},
			];
			let scanCall = 0;
			const { client, inputs } = createClient((input) =>
				input.Key ? {} : pages[scanCall++],
			);
			const { deleteByUser } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			await deleteByUser({ userId: USER_ID, email: null });

			const deletes = inputs.filter((i) => i.Key);
			expect(deletes.map((d) => d.Key)).toEqual([{ checkoutSessionId: "cs_by_user" }]);
		});

		it("issues no deletes when nothing matches the user", async () => {
			const { client, inputs } = createClient(() => ({ Items: [] }));
			const { deleteByUser } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			await deleteByUser({ userId: USER_ID, email: "nobody@b.com" });

			expect(inputs.filter((i) => i.ProjectionExpression === SCRUB_PROJECTION)).toHaveLength(1);
			expect(inputs.filter((i) => i.Key)).toHaveLength(0);
		});
	});
});
