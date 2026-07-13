import { CheckoutSessionIdSchema } from "@packages/provider-contracts/hosted-checkout";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { type HutchLogger, noopLogger } from "@packages/hutch-logger";
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
				variant: "cancelled_resubscribe",
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
			});
		});
	});

	describe("consumePendingSignup", () => {
		it("returns null when no row was deleted", async () => {
			const { client } = createClient(() => ({}));
			const { consumePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await consumePendingSignup(SESSION_ID);

			expect(result).toBeNull();
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
			const { consumePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await consumePendingSignup(SESSION_ID);

			expect(result).toEqual({
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
				returnUrl: "/account",
			});
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
			const { consumePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await consumePendingSignup(SESSION_ID);

			expect(result).toEqual({
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
			});
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
			const { consumePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await consumePendingSignup(SESSION_ID);

			expect(result).toEqual({
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
				trialEndsAt: "2026-07-24T00:00:00.000Z",
			});
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
			const { consumePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await consumePendingSignup(SESSION_ID);

			expect(result).toEqual({
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
				variant: "trial_checkout",
			});
		});

		it("drops an unrecognised variant instead of throwing — the row is already deleted by then, so a parse failure would destroy a paying customer's signup", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "existing-user-subscribe",
					email: "e@b.com",
					userId: USER_ID,
					variant: "a_variant_from_the_future",
				},
			}));
			const { consumePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await consumePendingSignup(SESSION_ID);

			expect(result).toEqual({
				method: "existing-user-subscribe",
				email: "e@b.com",
				userId: USER_ID,
			});
		});

		it("returns null for an existing-user-subscribe row missing its userId", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "existing-user-subscribe",
					email: "e@b.com",
				},
			}));
			const { consumePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await consumePendingSignup(SESSION_ID);

			expect(result).toBeNull();
		});

		it("discards a leftover legacy email/google row, warns, and returns null", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "email",
					email: "a@b.com",
				},
			}));
			const warnings: string[] = [];
			const logger: HutchLogger = {
				...noopLogger,
				warn: (...args: unknown[]) => {
					warnings.push(args.map(String).join(" "));
				},
			};
			const { consumePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger,
			});

			const result = await consumePendingSignup(SESSION_ID);

			expect(result).toBeNull();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toMatch(/discarded legacy 'email' row/);
		});
	});

	describe("listAllPendingSignups", () => {
		it("paginates through every scan page and projects the summary fields", async () => {
			const pages = [
				{
					Items: [
						{
							checkoutSessionId: SESSION_ID,
							email: "a@b.com",
							createdAt: 100,
							checkoutRecoveryEmailSentAt: 150,
						},
					],
					LastEvaluatedKey: { checkoutSessionId: SESSION_ID },
				},
				{
					Items: [{ checkoutSessionId: SESSION_ID, email: "c@b.com" }],
				},
			];
			let call = 0;
			const { client, inputs } = createClient(() => pages[call++]);
			const { listAllPendingSignups } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			const result = await listAllPendingSignups();

			expect(result).toEqual([
				{
					checkoutSessionId: SESSION_ID,
					email: "a@b.com",
					createdAt: 100,
					checkoutRecoveryEmailSentAt: 150,
				},
				{ checkoutSessionId: SESSION_ID, email: "c@b.com" },
			]);
			expect(inputs[1]?.ExclusiveStartKey).toEqual({
				checkoutSessionId: SESSION_ID,
			});
		});
	});

	describe("markCheckoutRecoveryEmailSent", () => {
		it("issues an update that sets checkoutRecoveryEmailSentAt", async () => {
			const { client, inputs } = createClient(() => ({}));
			const { markCheckoutRecoveryEmailSent } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			await markCheckoutRecoveryEmailSent({
				checkoutSessionId: SESSION_ID,
				sentAt: 999,
			});

			expect(inputs[0]?.UpdateExpression).toBe(
				"SET checkoutRecoveryEmailSentAt = :sentAt",
			);
			expect(inputs[0]?.ExpressionAttributeValues?.[":sentAt"]).toBe(999);
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
