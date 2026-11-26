import assert from "node:assert";
import {
	type DynamoDBDocumentClient,
	type TransactWriteCommand,
	defineDynamoTable,
	transactWithConflictRetry,
} from "@packages/storage-client";
import { fixedWindowStartSeconds } from "@packages/domain/rate-limit";
import type { UserId } from "@packages/domain/user";
import { z } from "zod";
import type {
	BudgetReservation,
	BudgetWindow,
	RecommendationBudget,
	ReleaseRecommendationBudget,
	ReserveRecommendationBudget,
	SettleRecommendationBudget,
} from "../../domain/related-articles/recommendation-budget";

const CounterRow = z.object({ consumed: z.number().optional() });

const MAX_TRANSACTION_ATTEMPTS = 6;

type TransactItems = NonNullable<
	ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]
>;

function counterKey(input: { userId: UserId; windowStartSeconds: number }) {
	return { pk: `recommendation-budget#user#${input.userId}#${input.windowStartSeconds}` };
}

function reservationKey(id: string) {
	return { pk: `recommendation-budget#reservation#${id}` };
}

export function initDynamoDbRecommendationBudget(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	limitNanodollars: number;
	windowSeconds: number;
	now: () => Date;
	delay: (milliseconds: number) => Promise<void>;
}): RecommendationBudget {
	const counters = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: CounterRow,
	});

	const currentWindow = (): BudgetWindow => {
		const startSeconds = fixedWindowStartSeconds({
			nowMs: deps.now().getTime(),
			windowSeconds: deps.windowSeconds,
		});
		return {
			startSeconds,
			startsAt: new Date(startSeconds * 1000),
			resetsAt: new Date((startSeconds + deps.windowSeconds) * 1000),
		};
	};

	const transact = async <T>(input: {
		items: TransactItems;
		onCancelled: (codes: (string | undefined)[]) => Promise<{ handled: true; value: T } | { handled: false }>;
		onSuccess: T;
	}): Promise<T> => {
		const outcome = await transactWithConflictRetry({
			client: deps.client,
			delay: deps.delay,
			maxAttempts: MAX_TRANSACTION_ATTEMPTS,
			input: { TransactItems: input.items },
			onCancelled: (reasons) => input.onCancelled(reasons.map((reason) => reason.Code)),
		});
		return outcome.kind === "written" ? input.onSuccess : outcome.value;
	};

	const reserveRecommendationBudget: ReserveRecommendationBudget = async ({ userId, reservations }) => {
		const total = reservations.reduce((sum, reservation) => sum + reservation.nanodollars, 0);
		assert(
			total <= deps.limitNanodollars,
			`A recommendation request reserved ${total} nanodollars, more than the ${deps.limitNanodollars} daily limit`,
		);
		const window = currentWindow();
		const expiresAt = window.startSeconds + 2 * deps.windowSeconds;
		const budgetReservations: BudgetReservation[] = reservations.map((reservation) => ({
			id: reservation.id,
			userId,
			windowStartSeconds: window.startSeconds,
			nanodollars: reservation.nanodollars,
		}));
		const counter = counterKey({ userId, windowStartSeconds: window.startSeconds });
		const items: TransactItems = [
			...budgetReservations.map((reservation) => ({
				Put: {
					TableName: deps.tableName,
					Item: {
						...reservationKey(reservation.id),
						userId,
						windowStartSeconds: reservation.windowStartSeconds,
						nanodollars: reservation.nanodollars,
						state: "reserved",
						expiresAt,
					},
					ConditionExpression: "attribute_not_exists(pk)",
				},
			})),
			{
				Update: {
					TableName: deps.tableName,
					Key: counter,
					UpdateExpression: "ADD #consumed :total SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
					ConditionExpression: "attribute_not_exists(#consumed) OR #consumed <= :headroom",
					ExpressionAttributeNames: { "#consumed": "consumed" },
					ExpressionAttributeValues: {
						":total": total,
						":headroom": deps.limitNanodollars - total,
						":expiresAt": expiresAt,
					},
				},
			},
		];
		return transact<Awaited<ReturnType<ReserveRecommendationBudget>>>({
			items,
			onSuccess: { allowed: true, window, reservations: budgetReservations },
			onCancelled: async (codes) => {
				assert(
					!codes.slice(0, -1).includes("ConditionalCheckFailed"),
					"A recommendation budget reservation id was already taken",
				);
				if (codes.at(-1) !== "ConditionalCheckFailed") return { handled: false };
				const row = await counters.get(counter, { consistentRead: true });
				return {
					handled: true,
					value: { allowed: false, window, consumedNanodollars: row?.consumed ?? 0 },
				};
			},
		});
	};

	const finishReservation = (input: {
		reservation: BudgetReservation;
		setExpression: string;
		values: Record<string, unknown>;
		deltaNanodollars: number;
	}): Promise<void> =>
		transact({
			items: [
				{
					Update: {
						TableName: deps.tableName,
						Key: reservationKey(input.reservation.id),
						UpdateExpression: input.setExpression,
						ConditionExpression: "#state = :reserved",
						ExpressionAttributeNames: { "#state": "state" },
						ExpressionAttributeValues: { ...input.values, ":reserved": "reserved" },
					},
				},
				{
					Update: {
						TableName: deps.tableName,
						Key: counterKey({
							userId: input.reservation.userId,
							windowStartSeconds: input.reservation.windowStartSeconds,
						}),
						UpdateExpression: "ADD #consumed :delta",
						ExpressionAttributeNames: { "#consumed": "consumed" },
						ExpressionAttributeValues: { ":delta": input.deltaNanodollars },
					},
				},
			],
			onSuccess: undefined,
			onCancelled: async (codes) =>
				codes[0] === "ConditionalCheckFailed" ? { handled: true, value: undefined } : { handled: false },
		});

	const settleRecommendationBudget: SettleRecommendationBudget = ({ reservation, actualNanodollars }) =>
		finishReservation({
			reservation,
			setExpression: "SET #state = :settled, actualNanodollars = :actual",
			values: { ":settled": "settled", ":actual": actualNanodollars },
			deltaNanodollars: actualNanodollars - reservation.nanodollars,
		});

	const releaseRecommendationBudget: ReleaseRecommendationBudget = ({ reservation }) =>
		finishReservation({
			reservation,
			setExpression: "SET #state = :released",
			values: { ":released": "released" },
			deltaNanodollars: -reservation.nanodollars,
		});

	return { reserveRecommendationBudget, settleRecommendationBudget, releaseRecommendationBudget };
}
