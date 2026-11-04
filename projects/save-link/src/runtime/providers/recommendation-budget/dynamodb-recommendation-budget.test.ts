import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import {
	type DynamoDBDocumentClient,
	TransactWriteCommand,
	TransactionCanceledException,
} from "@packages/storage-client";
import type { BudgetReservation } from "../../domain/related-articles/recommendation-budget";
import { initDynamoDbRecommendationBudget } from "./dynamodb-recommendation-budget";

type SendFn = DynamoDBDocumentClient["send"];

interface CapturedItem {
	Put?: {
		TableName?: string;
		Item?: Record<string, unknown>;
		ConditionExpression?: string;
	};
	Update?: {
		TableName?: string;
		Key?: Record<string, unknown>;
		UpdateExpression?: string;
		ConditionExpression?: string;
		ExpressionAttributeNames?: Record<string, string>;
		ExpressionAttributeValues?: Record<string, unknown>;
	};
}

interface CapturedCommand {
	input: {
		TransactItems?: CapturedItem[];
		Key?: Record<string, unknown>;
		ConsistentRead?: boolean;
	};
}

type Outcome = Error | Record<string, unknown>;

function scriptedClient(outcomes: Outcome[]) {
	const commands: CapturedCommand[] = [];
	const client: Partial<DynamoDBDocumentClient> = {
		send: (async (command: CapturedCommand) => {
			const outcome = outcomes[commands.length];
			commands.push(command);
			if (outcome instanceof Error) throw outcome;
			return outcome;
		}) as unknown as SendFn,
	};
	return { client: client as DynamoDBDocumentClient, commands };
}

function cancelled(codes: (string | undefined)[] | undefined): TransactionCanceledException {
	return new TransactionCanceledException({
		$metadata: {},
		message: "transaction cancelled",
		CancellationReasons: codes?.map((Code) => ({ Code })),
	});
}

const TABLE = "test-rate-limits";
const LIMIT = 500_000_000;
const DAY = 86_400;
const USER = UserIdSchema.parse("user-1");
const OTHER_USER = UserIdSchema.parse("user-2");
const DAY_START = Date.UTC(2026, 10, 4) / 1000;
const midDay = () => new Date((DAY_START + 3_600) * 1000);
const noDelay = async () => {};

function initBudget(deps: {
	client: DynamoDBDocumentClient;
	now?: () => Date;
	delay?: (milliseconds: number) => Promise<void>;
}) {
	return initDynamoDbRecommendationBudget({
		client: deps.client,
		tableName: TABLE,
		limitNanodollars: LIMIT,
		windowSeconds: DAY,
		now: deps.now ?? midDay,
		delay: deps.delay ?? noDelay,
	});
}

function reservation(overrides: Partial<BudgetReservation> = {}): BudgetReservation {
	return {
		id: "r-1",
		userId: USER,
		windowStartSeconds: DAY_START,
		nanodollars: 3_000_000,
		...overrides,
	};
}

describe("initDynamoDbRecommendationBudget", () => {
	describe("reserveRecommendationBudget", () => {
		it("puts every reservation and adds their total to the user's daily counter in one transaction", async () => {
			const { client, commands } = scriptedClient([{}]);
			const budget = initBudget({ client });

			const result = await budget.reserveRecommendationBudget({
				userId: USER,
				reservations: [
					{ id: "r-1", nanodollars: 3_000_000 },
					{ id: "r-2", nanodollars: 2_000_000 },
				],
			});

			assert.deepEqual(result, {
				allowed: true,
				window: {
					startSeconds: DAY_START,
					startsAt: new Date(DAY_START * 1000),
					resetsAt: new Date((DAY_START + DAY) * 1000),
				},
				reservations: [
					{ id: "r-1", userId: USER, windowStartSeconds: DAY_START, nanodollars: 3_000_000 },
					{ id: "r-2", userId: USER, windowStartSeconds: DAY_START, nanodollars: 2_000_000 },
				],
			});
			assert.equal(commands.length, 1);
			assert.ok(commands[0] instanceof TransactWriteCommand);
			const [first, second, counter] = commands[0]?.input.TransactItems ?? [];
			assert.deepEqual(first?.Put, {
				TableName: TABLE,
				Item: {
					pk: "recommendation-budget#reservation#r-1",
					userId: USER,
					windowStartSeconds: DAY_START,
					nanodollars: 3_000_000,
					state: "reserved",
					expiresAt: DAY_START + 2 * DAY,
				},
				ConditionExpression: "attribute_not_exists(pk)",
			});
			assert.equal(second?.Put?.Item?.pk, "recommendation-budget#reservation#r-2");
			assert.deepEqual(counter?.Update, {
				TableName: TABLE,
				Key: { pk: `recommendation-budget#user#user-1#${DAY_START}` },
				UpdateExpression: "ADD consumed :total SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
				ConditionExpression: "attribute_not_exists(consumed) OR consumed <= :headroom",
				ExpressionAttributeValues: {
					":total": 5_000_000,
					":headroom": LIMIT - 5_000_000,
					":expiresAt": DAY_START + 2 * DAY,
				},
			});
		});

		it("keeps each user's spend on its own counter", async () => {
			const { client, commands } = scriptedClient([{}, {}]);
			const budget = initBudget({ client });

			await budget.reserveRecommendationBudget({ userId: USER, reservations: [{ id: "a", nanodollars: 1 }] });
			await budget.reserveRecommendationBudget({ userId: OTHER_USER, reservations: [{ id: "b", nanodollars: 1 }] });

			const counterKeys = commands.map((command) => command.input.TransactItems?.at(-1)?.Update?.Key?.pk);
			assert.deepEqual(counterKeys, [
				`recommendation-budget#user#user-1#${DAY_START}`,
				`recommendation-budget#user#user-2#${DAY_START}`,
			]);
		});

		it("starts a new window at UTC midnight", async () => {
			const { client, commands } = scriptedClient([{}, {}]);
			let nowMs = (DAY_START + DAY - 1) * 1000;
			const budget = initBudget({ client, now: () => new Date(nowMs) });

			const before = await budget.reserveRecommendationBudget({ userId: USER, reservations: [{ id: "a", nanodollars: 1 }] });
			nowMs = (DAY_START + DAY) * 1000;
			const after = await budget.reserveRecommendationBudget({ userId: USER, reservations: [{ id: "b", nanodollars: 1 }] });

			assert.equal(before.window.startSeconds, DAY_START);
			assert.equal(after.window.startSeconds, DAY_START + DAY);
			assert.deepEqual(after.window.resetsAt, new Date((DAY_START + 2 * DAY) * 1000));
			assert.equal(
				commands[1]?.input.TransactItems?.at(-1)?.Update?.Key?.pk,
				`recommendation-budget#user#user-1#${DAY_START + DAY}`,
			);
		});

		it("denies with the counter's consumed amount and the window when the counter has no headroom", async () => {
			const { client, commands } = scriptedClient([
				cancelled(["None", "ConditionalCheckFailed"]),
				{ Item: { pk: "x", consumed: 499_000_000 } },
			]);
			const budget = initBudget({ client });

			const result = await budget.reserveRecommendationBudget({
				userId: USER,
				reservations: [{ id: "r-1", nanodollars: 3_000_000 }],
			});

			assert.deepEqual(result, {
				allowed: false,
				window: {
					startSeconds: DAY_START,
					startsAt: new Date(DAY_START * 1000),
					resetsAt: new Date((DAY_START + DAY) * 1000),
				},
				consumedNanodollars: 499_000_000,
			});
			assert.deepEqual(commands[1]?.input.Key, { pk: `recommendation-budget#user#user-1#${DAY_START}` });
			assert.equal(commands[1]?.input.ConsistentRead, true);
		});

		it("reports zero consumed when the denied counter cannot be read back", async () => {
			const { client } = scriptedClient([cancelled(["None", "ConditionalCheckFailed"]), {}]);
			const budget = initBudget({ client });

			const result = await budget.reserveRecommendationBudget({
				userId: USER,
				reservations: [{ id: "r-1", nanodollars: 1 }],
			});

			assert.equal(result.allowed, false);
			assert.equal(result.allowed === false && result.consumedNanodollars, 0);
		});

		it("throws when a reservation id is already taken", async () => {
			const { client } = scriptedClient([cancelled(["ConditionalCheckFailed", "None"])]);
			const budget = initBudget({ client });

			await expect(
				budget.reserveRecommendationBudget({ userId: USER, reservations: [{ id: "r-1", nanodollars: 1 }] }),
			).rejects.toThrow("reservation id was already taken");
		});

		it("retries a transaction conflict after a jittered backoff and then reserves", async () => {
			const delays: number[] = [];
			const { client, commands } = scriptedClient([
				cancelled(["None", "TransactionConflict"]),
				cancelled(["TransactionConflict", "None"]),
				{},
			]);
			const random = jest.spyOn(Math, "random").mockReturnValue(0.5);
			const budget = initBudget({ client, delay: async (ms) => { delays.push(ms); } });

			const result = await budget.reserveRecommendationBudget({
				userId: USER,
				reservations: [{ id: "r-1", nanodollars: 1 }],
			});
			random.mockRestore();

			assert.equal(result.allowed, true);
			assert.equal(commands.length, 3);
			assert.deepEqual(delays, [25, 50]);
		});

		it("gives up after six conflicted attempts", async () => {
			const conflict = cancelled(["None", "TransactionConflict"]);
			const { client, commands } = scriptedClient(Array.from({ length: 6 }, () => conflict));
			const budget = initBudget({ client });

			await expect(
				budget.reserveRecommendationBudget({ userId: USER, reservations: [{ id: "r-1", nanodollars: 1 }] }),
			).rejects.toBe(conflict);
			assert.equal(commands.length, 6);
		});

		it("rethrows a cancellation that is neither a denial nor a conflict", async () => {
			const throttled = cancelled(["None", "ThrottlingError"]);
			const { client } = scriptedClient([throttled]);
			const budget = initBudget({ client });

			await expect(
				budget.reserveRecommendationBudget({ userId: USER, reservations: [{ id: "r-1", nanodollars: 1 }] }),
			).rejects.toBe(throttled);
		});

		it("rethrows a cancellation without reasons", async () => {
			const bare = cancelled(undefined);
			const { client } = scriptedClient([bare]);
			const budget = initBudget({ client });

			await expect(
				budget.reserveRecommendationBudget({ userId: USER, reservations: [{ id: "r-1", nanodollars: 1 }] }),
			).rejects.toBe(bare);
		});

		it("rethrows a storage failure", async () => {
			const failure = new Error("network down");
			const { client } = scriptedClient([failure]);
			const budget = initBudget({ client });

			await expect(
				budget.reserveRecommendationBudget({ userId: USER, reservations: [{ id: "r-1", nanodollars: 1 }] }),
			).rejects.toBe(failure);
		});

		it("refuses a single request larger than the daily limit", async () => {
			const { client, commands } = scriptedClient([]);
			const budget = initBudget({ client });

			await expect(
				budget.reserveRecommendationBudget({
					userId: USER,
					reservations: [{ id: "r-1", nanodollars: LIMIT + 1 }],
				}),
			).rejects.toThrow("more than the 500000000 daily limit");
			assert.equal(commands.length, 0);
		});
	});

	describe("settleRecommendationBudget", () => {
		it("marks the reservation settled and applies the difference to the reservation's own window after midnight", async () => {
			const { client, commands } = scriptedClient([{}]);
			const budget = initBudget({ client, now: () => new Date((DAY_START + DAY + 60) * 1000) });

			await budget.settleRecommendationBudget({ reservation: reservation(), actualNanodollars: 1_000_000 });

			const [reservationItem, counter] = commands[0]?.input.TransactItems ?? [];
			assert.deepEqual(reservationItem?.Update, {
				TableName: TABLE,
				Key: { pk: "recommendation-budget#reservation#r-1" },
				UpdateExpression: "SET #state = :settled, actualNanodollars = :actual",
				ConditionExpression: "#state = :reserved",
				ExpressionAttributeNames: { "#state": "state" },
				ExpressionAttributeValues: { ":settled": "settled", ":actual": 1_000_000, ":reserved": "reserved" },
			});
			assert.deepEqual(counter?.Update, {
				TableName: TABLE,
				Key: { pk: `recommendation-budget#user#user-1#${DAY_START}` },
				UpdateExpression: "ADD consumed :delta",
				ExpressionAttributeValues: { ":delta": -2_000_000 },
			});
		});

		it("adds a positive difference when the call cost more than reserved", async () => {
			const { client, commands } = scriptedClient([{}]);
			const budget = initBudget({ client });

			await budget.settleRecommendationBudget({ reservation: reservation(), actualNanodollars: 4_500_000 });

			assert.equal(commands[0]?.input.TransactItems?.[1]?.Update?.ExpressionAttributeValues?.[":delta"], 1_500_000);
		});

		it("ignores a second settle of a reservation that is no longer reserved", async () => {
			const { client, commands } = scriptedClient([{}, cancelled(["ConditionalCheckFailed", "None"])]);
			const budget = initBudget({ client });

			await budget.settleRecommendationBudget({ reservation: reservation(), actualNanodollars: 1 });
			await budget.settleRecommendationBudget({ reservation: reservation(), actualNanodollars: 1 });

			assert.equal(commands.length, 2);
		});

		it("retries a transaction conflict and gives up after six attempts", async () => {
			const conflict = cancelled(["TransactionConflict", "None"]);
			const delays: number[] = [];
			const { client, commands } = scriptedClient(Array.from({ length: 6 }, () => conflict));
			const budget = initBudget({ client, delay: async (ms) => { delays.push(ms); } });

			await expect(
				budget.settleRecommendationBudget({ reservation: reservation(), actualNanodollars: 1 }),
			).rejects.toBe(conflict);
			assert.equal(commands.length, 6);
			assert.equal(delays.length, 5);
		});
	});

	describe("releaseRecommendationBudget", () => {
		it("marks the reservation released and returns its whole amount to its window", async () => {
			const { client, commands } = scriptedClient([{}]);
			const budget = initBudget({ client });

			await budget.releaseRecommendationBudget({ reservation: reservation() });

			const [reservationItem, counter] = commands[0]?.input.TransactItems ?? [];
			assert.equal(reservationItem?.Update?.UpdateExpression, "SET #state = :released");
			assert.deepEqual(reservationItem?.Update?.ExpressionAttributeValues, {
				":released": "released",
				":reserved": "reserved",
			});
			assert.equal(counter?.Update?.ExpressionAttributeValues?.[":delta"], -3_000_000);
		});

		it("ignores a release of a reservation that is no longer reserved", async () => {
			const { client } = scriptedClient([cancelled(["ConditionalCheckFailed", "None"])]);
			const budget = initBudget({ client });

			await budget.releaseRecommendationBudget({ reservation: reservation() });
		});

		it("rethrows a storage failure", async () => {
			const failure = new Error("network down");
			const { client } = scriptedClient([failure]);
			const budget = initBudget({ client });

			await expect(budget.releaseRecommendationBudget({ reservation: reservation() })).rejects.toBe(failure);
		});
	});
});
