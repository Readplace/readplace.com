import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbResendThrottle } from "./dynamodb-resend-throttle";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(
	impl: (input: unknown) => unknown,
): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	};
}

const TABLE = "test-resend-throttle";
const NOW_DATE = new Date("2026-05-30T00:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW_DATE.getTime() / 1000);
const NOW = () => NOW_DATE;
const USER_ID = UserIdSchema.parse("user-1");

describe("initDynamoDbResendThrottle", () => {
	it("issues an atomic conditional UpdateItem and returns ok when the write succeeds (default cooldown/cap/window)", async () => {
		let received: unknown;
		const client = createFakeClient((input) => {
			received = input;
			return {};
		});
		const { recordResendAttempt } = initDynamoDbResendThrottle({
			client: client as DynamoDBDocumentClient,
			tableName: TABLE,
			now: NOW,
		});

		expect(await recordResendAttempt({ userId: USER_ID })).toEqual({ ok: true });

		const command = received as {
			input: {
				Key?: Record<string, unknown>;
				ConditionExpression?: string;
				UpdateExpression?: string;
				ExpressionAttributeNames?: Record<string, string>;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		expect(command.input.Key).toEqual({ userId: USER_ID });
		expect(command.input.ConditionExpression).toContain("attribute_not_exists(userId)");
		expect(command.input.ConditionExpression).toContain("nextAllowedAt <= :now");
		expect(command.input.ConditionExpression).toContain("#count < :cap");
		expect(command.input.UpdateExpression).toContain(
			"#count = if_not_exists(#count, :zero) + :one",
		);
		expect(command.input.UpdateExpression).toContain("nextAllowedAt = :nextAllowedAt");
		expect(command.input.UpdateExpression).toContain(
			"expiresAt = if_not_exists(expiresAt, :expiresAt)",
		);
		expect(command.input.ExpressionAttributeNames?.["#count"]).toBe("count");
		expect(command.input.ExpressionAttributeValues?.[":now"]).toBe(NOW_SECONDS);
		expect(command.input.ExpressionAttributeValues?.[":cap"]).toBe(5);
		expect(command.input.ExpressionAttributeValues?.[":nextAllowedAt"]).toBe(NOW_SECONDS + 60);
		expect(command.input.ExpressionAttributeValues?.[":expiresAt"]).toBe(
			NOW_SECONDS + 24 * 60 * 60,
		);
	});

	it("returns { ok: false, reason: 'throttled' } when DynamoDB rejects the conditional write (custom cooldown/cap/window)", async () => {
		let received: unknown;
		const client = createFakeClient((input) => {
			received = input;
			throw new ConditionalCheckFailedException({
				$metadata: {},
				message: "The conditional request failed",
			});
		});
		const { recordResendAttempt } = initDynamoDbResendThrottle({
			client: client as DynamoDBDocumentClient,
			tableName: TABLE,
			now: NOW,
			cooldownSeconds: 30,
			cap: 2,
			windowSeconds: 120,
		});

		expect(await recordResendAttempt({ userId: USER_ID })).toEqual({
			ok: false,
			reason: "throttled",
		});

		const command = received as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(command.input.ExpressionAttributeValues?.[":cap"]).toBe(2);
		expect(command.input.ExpressionAttributeValues?.[":nextAllowedAt"]).toBe(NOW_SECONDS + 30);
		expect(command.input.ExpressionAttributeValues?.[":expiresAt"]).toBe(NOW_SECONDS + 120);
	});

	it("rethrows errors that are not ConditionalCheckFailedException", async () => {
		const client = createFakeClient(() => {
			throw new Error("ProvisionedThroughputExceeded");
		});
		const { recordResendAttempt } = initDynamoDbResendThrottle({
			client: client as DynamoDBDocumentClient,
			tableName: TABLE,
			now: NOW,
		});

		await expect(recordResendAttempt({ userId: USER_ID })).rejects.toThrow(
			"ProvisionedThroughputExceeded",
		);
	});
});
