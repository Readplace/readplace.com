import { CheckoutSessionIdSchema } from "@packages/provider-contracts/stripe-checkout";
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

	describe("deleteByUserId", () => {
		it("scans by userId across pages and deletes each abandoned row by its checkoutSessionId", async () => {
			const pages = [
				{
					Items: [{ checkoutSessionId: "cs_1" }, { checkoutSessionId: "cs_2" }],
					LastEvaluatedKey: { checkoutSessionId: "cs_2" },
				},
				{ Items: [{ checkoutSessionId: "cs_3" }] },
			];
			let scanCall = 0;
			// The impl is invoked for every command; a DeleteCommand carries a Key,
			// a ScanCommand does not — so return {} for deletes and the next page otherwise.
			const { client, inputs } = createClient((input) =>
				input.Key ? {} : pages[scanCall++],
			);
			const { deleteByUserId } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			await deleteByUserId(USER_ID);

			const scans = inputs.filter((i) => i.ProjectionExpression === "checkoutSessionId");
			expect(scans).toHaveLength(2);
			expect(scans[0]?.ExpressionAttributeValues).toEqual({ ":u": USER_ID });
			expect(scans[1]?.ExclusiveStartKey).toEqual({ checkoutSessionId: "cs_2" });

			const deletes = inputs.filter((i) => i.Key);
			expect(deletes.map((d) => d.Key)).toEqual([
				{ checkoutSessionId: "cs_1" },
				{ checkoutSessionId: "cs_2" },
				{ checkoutSessionId: "cs_3" },
			]);
		});

		it("issues no deletes when the user has no pending signups", async () => {
			const { client, inputs } = createClient(() => ({ Items: [] }));
			const { deleteByUserId } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
				logger: noopLogger,
			});

			await deleteByUserId(USER_ID);

			expect(inputs.filter((i) => i.ProjectionExpression === "checkoutSessionId")).toHaveLength(1);
			expect(inputs.filter((i) => i.Key)).toHaveLength(0);
		});
	});
});
