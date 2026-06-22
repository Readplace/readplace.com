import { CheckoutSessionIdSchema } from "@packages/provider-contracts/stripe-checkout";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
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
		it("persists an email signup with passwordHash and returnUrl", async () => {
			const { client, inputs } = createClient(() => ({}));
			const { storePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
			});

			await storePendingSignup({
				checkoutSessionId: SESSION_ID,
				signup: {
					method: "email",
					email: "a@b.com",
					passwordHash: "hash-1",
					returnUrl: "/queue",
				},
				createdAt: 100,
			});

			expect(inputs[0]?.Item).toEqual({
				checkoutSessionId: SESSION_ID,
				method: "email",
				email: "a@b.com",
				createdAt: 100,
				passwordHash: "hash-1",
				returnUrl: "/queue",
			});
		});

		it("persists a google signup with userId and omits returnUrl when absent", async () => {
			const { client, inputs } = createClient(() => ({}));
			const { storePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
			});

			await storePendingSignup({
				checkoutSessionId: SESSION_ID,
				signup: { method: "google", email: "g@b.com", userId: USER_ID },
				createdAt: 200,
			});

			expect(inputs[0]?.Item).toEqual({
				checkoutSessionId: SESSION_ID,
				method: "google",
				email: "g@b.com",
				createdAt: 200,
				userId: USER_ID,
			});
		});

		it("persists an existing-user-subscribe signup with userId", async () => {
			const { client, inputs } = createClient(() => ({}));
			const { storePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
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
			});

			const result = await consumePendingSignup(SESSION_ID);

			expect(result).toBeNull();
		});

		it("reconstructs an email signup including returnUrl", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "email",
					email: "a@b.com",
					passwordHash: "hash-1",
					returnUrl: "/queue",
				},
			}));
			const { consumePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
			});

			const result = await consumePendingSignup(SESSION_ID);

			expect(result).toEqual({
				method: "email",
				email: "a@b.com",
				passwordHash: "hash-1",
				returnUrl: "/queue",
			});
		});

		it("returns null for an email row missing its passwordHash", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "email",
					email: "a@b.com",
				},
			}));
			const { consumePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
			});

			const result = await consumePendingSignup(SESSION_ID);

			expect(result).toBeNull();
		});

		it("reconstructs an existing-user-subscribe signup", async () => {
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
			});

			const result = await consumePendingSignup(SESSION_ID);

			expect(result).toBeNull();
		});

		it("reconstructs a google signup with returnUrl", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "google",
					email: "g@b.com",
					userId: USER_ID,
					returnUrl: "/account",
				},
			}));
			const { consumePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
			});

			const result = await consumePendingSignup(SESSION_ID);

			expect(result).toEqual({
				method: "google",
				email: "g@b.com",
				userId: USER_ID,
				returnUrl: "/account",
			});
		});

		it("returns null for a google row missing its userId", async () => {
			const { client } = createClient(() => ({
				Attributes: {
					checkoutSessionId: SESSION_ID,
					method: "google",
					email: "g@b.com",
				},
			}));
			const { consumePendingSignup } = initDynamoDbPendingSignup({
				client,
				tableName: TABLE,
			});

			const result = await consumePendingSignup(SESSION_ID);

			expect(result).toBeNull();
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
});
