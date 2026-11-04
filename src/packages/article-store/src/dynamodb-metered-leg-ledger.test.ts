import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/storage-client";
import { PaidLegPermitSchema } from "@packages/provider-contracts/metered-leg-ledger";
import { initDynamoDbMeteredLegLedger } from "./dynamodb-metered-leg-ledger";

type SendFn = DynamoDBDocumentClient["send"];

interface UpdateInput {
	TableName?: string;
	Key?: Record<string, unknown>;
	UpdateExpression?: string;
	ConditionExpression?: string;
	ExpressionAttributeNames?: Record<string, string>;
	ExpressionAttributeValues?: Record<string, unknown>;
	ReturnValuesOnConditionCheckFailure?: string;
}

function createFakeClient(impl: (input: { input: UpdateInput }) => unknown): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (command: { input: UpdateInput }) => impl(command)) as unknown as SendFn,
	};
}

function capturingClient() {
	const commands: UpdateInput[] = [];
	const client = createFakeClient((command) => {
		commands.push(command.input);
		return {};
	});
	return { client: client as DynamoDBDocumentClient, commands };
}

type RefusedItem = ConstructorParameters<typeof ConditionalCheckFailedException>[0]["Item"];

function refusingClient(item: RefusedItem) {
	return createFakeClient(() => {
		throw new ConditionalCheckFailedException({ $metadata: {}, message: "condition failed", Item: item });
	}) as DynamoDBDocumentClient;
}

function failingClient() {
	return createFakeClient(() => {
		throw new Error("throttled");
	}) as DynamoDBDocumentClient;
}

const TABLE = "test-table";
const URL = "https://example.com/article";
const FROZEN_NOW = new Date("2026-11-04T10:00:00.000Z");
const now = () => FROZEN_NOW;
const CLAIM = {
	url: URL,
	leg: "render-web-unlocker-fetch" as const,
	inputHash: "hash-a",
	claimId: "message-1",
	expiresAt: "2026-11-04T10:15:00.000Z",
};
const PERMIT = PaidLegPermitSchema.parse({ leg: "render-web-unlocker-fetch", claimId: "message-1", inputHash: "hash-a" });

describe("initDynamoDbMeteredLegLedger", () => {
	describe("claimMeteredLeg", () => {
		it("grants a permit for the claimed leg when the conditional write succeeds", async () => {
			const { client } = capturingClient();
			const { claimMeteredLeg } = initDynamoDbMeteredLegLedger({ client, tableName: TABLE, now });

			const result = await claimMeteredLeg(CLAIM);

			assert.deepEqual(result, {
				kind: "granted",
				permit: { leg: "render-web-unlocker-fetch", claimId: "message-1", inputHash: "hash-a" },
			});
		});

		it("writes the claim on the article row only when no marker, live foreign claim or settled entry for the same input exists", async () => {
			const { client, commands } = capturingClient();
			const { claimMeteredLeg } = initDynamoDbMeteredLegLedger({ client, tableName: TABLE, now });

			await claimMeteredLeg(CLAIM);

			const [command] = commands;
			assert.ok(command);
			expect(command.TableName).toBe(TABLE);
			expect(command.Key).toEqual({ url: "example.com/article" });
			expect(command.UpdateExpression).toContain("SET #claim = :claim");
			expect(command.ConditionExpression).toContain("attribute_not_exists(meteredLegsDeferredSince)");
			expect(command.ConditionExpression).toContain(
				"(attribute_not_exists(#claim) OR #claim.expiresAt < :now OR #claim.claimId = :claimId)",
			);
			expect(command.ConditionExpression).toContain("(attribute_not_exists(#ledger) OR #ledger.inputHash <> :hash)");
			expect(command.ExpressionAttributeNames).toEqual({
				"#claim": "claim_render-web-unlocker-fetch",
				"#ledger": "ledger_render-web-unlocker-fetch",
			});
			expect(command.ExpressionAttributeValues).toEqual({
				":claim": { claimId: "message-1", expiresAt: "2026-11-04T10:15:00.000Z" },
				":now": FROZEN_NOW.toISOString(),
				":claimId": "message-1",
				":hash": "hash-a",
			});
			expect(command.ReturnValuesOnConditionCheckFailure).toBe("ALL_OLD");
		});

		it("answers deferred when the refused row carries the deferral marker", async () => {
			const { claimMeteredLeg } = initDynamoDbMeteredLegLedger({
				client: refusingClient({ meteredLegsDeferredSince: { S: "2026-11-04T09:00:00.000Z" } }),
				tableName: TABLE,
				now,
			});

			assert.deepEqual(await claimMeteredLeg(CLAIM), { kind: "deferred" });
		});

		it("answers settled with the recorded outcome when the leg already settled the same input", async () => {
			const { claimMeteredLeg } = initDynamoDbMeteredLegLedger({
				client: refusingClient({
					"ledger_render-web-unlocker-fetch": {
						M: { inputHash: { S: "hash-a" }, outcome: { S: "outcome-1" }, settledAt: { S: "2026-11-04T09:00:00.000Z" } },
					},
				}),
				tableName: TABLE,
				now,
			});

			assert.deepEqual(await claimMeteredLeg(CLAIM), { kind: "settled", outcome: "outcome-1" });
		});

		it("answers in-flight when another holder's claim refused the write", async () => {
			const { claimMeteredLeg } = initDynamoDbMeteredLegLedger({
				client: refusingClient({
					"claim_render-web-unlocker-fetch": { M: { claimId: { S: "message-2" }, expiresAt: { S: "2026-11-04T10:10:00.000Z" } } },
				}),
				tableName: TABLE,
				now,
			});

			assert.deepEqual(await claimMeteredLeg(CLAIM), { kind: "in-flight" });
		});

		it("rethrows errors that are not a refused condition", async () => {
			const { claimMeteredLeg } = initDynamoDbMeteredLegLedger({ client: failingClient(), tableName: TABLE, now });

			await expect(claimMeteredLeg(CLAIM)).rejects.toThrow("throttled");
		});
	});

	describe("settleMeteredLeg", () => {
		it("records the ledger entry and drops the claim held by the permit", async () => {
			const { client, commands } = capturingClient();
			const { settleMeteredLeg } = initDynamoDbMeteredLegLedger({ client, tableName: TABLE, now });

			await settleMeteredLeg({ url: URL, permit: PERMIT, outcome: "outcome-1", settledAt: "2026-11-04T10:05:00.000Z" });

			const [command] = commands;
			assert.ok(command);
			expect(command.Key).toEqual({ url: "example.com/article" });
			expect(command.UpdateExpression).toContain("SET #ledger = :entry REMOVE #claim");
			expect(command.ConditionExpression).toContain("#claim.claimId = :claimId");
			expect(command.ExpressionAttributeNames).toEqual({
				"#claim": "claim_render-web-unlocker-fetch",
				"#ledger": "ledger_render-web-unlocker-fetch",
			});
			expect(command.ExpressionAttributeValues).toEqual({
				":entry": { inputHash: "hash-a", outcome: "outcome-1", settledAt: "2026-11-04T10:05:00.000Z" },
				":claimId": "message-1",
			});
		});
	});

	describe("releaseMeteredLeg", () => {
		it("drops the claim held by the permit", async () => {
			const { client, commands } = capturingClient();
			const { releaseMeteredLeg } = initDynamoDbMeteredLegLedger({ client, tableName: TABLE, now });

			await releaseMeteredLeg({ url: URL, permit: PERMIT });

			const [command] = commands;
			assert.ok(command);
			expect(command.Key).toEqual({ url: "example.com/article" });
			expect(command.UpdateExpression).toContain("REMOVE #claim");
			expect(command.ConditionExpression).toContain("#claim.claimId = :claimId");
			expect(command.ExpressionAttributeNames).toEqual({ "#claim": "claim_render-web-unlocker-fetch" });
			expect(command.ExpressionAttributeValues).toEqual({ ":claimId": "message-1" });
		});

		it("resolves when the claim is no longer held by the permit", async () => {
			const { releaseMeteredLeg } = initDynamoDbMeteredLegLedger({
				client: refusingClient(undefined),
				tableName: TABLE,
				now,
			});

			await expect(releaseMeteredLeg({ url: URL, permit: PERMIT })).resolves.toBeUndefined();
		});

		it("rethrows errors that are not a refused condition", async () => {
			const { releaseMeteredLeg } = initDynamoDbMeteredLegLedger({ client: failingClient(), tableName: TABLE, now });

			await expect(releaseMeteredLeg({ url: URL, permit: PERMIT })).rejects.toThrow("throttled");
		});
	});
});
