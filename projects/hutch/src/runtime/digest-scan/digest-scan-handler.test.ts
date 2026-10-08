import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { noopLogger } from "@packages/hutch-logger";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import type { SubscriptionStatus } from "@packages/provider-contracts/subscription-providers";
import { initDigestScanHandler, type DigestScanDeps } from "./digest-scan-handler";

const TRIGGER = JSON.stringify({ trigger: "digest-flush" });
const NOW = new Date("2026-09-30T00:00:00.000Z");

function createHandler(overrides: Partial<DigestScanDeps> = {}) {
	const deps: DigestScanDeps = {
		prepareStarterSnapshot: async () => {},
		logStarterReport: async () => {},
		listUserIdsByStatus: jest.fn().mockResolvedValue([]),
		dispatchSendUserDigest: jest.fn().mockResolvedValue(undefined),
		logger: noopLogger,
		...overrides,
	};
	return { handler: initDigestScanHandler(deps), deps };
}

async function seedOneUserPerStatus() {
	const subscriptions = initInMemorySubscriptionProviders({ now: () => NOW });
	const trialist = UserIdSchema.parse("user-trialing");
	const payer = UserIdSchema.parse("user-active");
	const leaving = UserIdSchema.parse("user-pending-cancellation");
	const lapsed = UserIdSchema.parse("user-cancelled");
	await subscriptions.upsertTrialing({ userId: trialist, trialEndsAt: "2026-10-10T00:00:00.000Z" });
	await subscriptions.upsertActive({ userId: payer, subscriptionId: "sub_payer", customerId: "cus_payer" });
	await subscriptions.upsertActive({ userId: leaving, subscriptionId: "sub_leaving", customerId: "cus_leaving" });
	await subscriptions.markPendingCancellation({
		userId: leaving,
		cancellationEffectiveAt: "2026-10-20T00:00:00.000Z",
	});
	await subscriptions.upsertActive({ userId: lapsed, subscriptionId: "sub_lapsed", customerId: "cus_lapsed" });
	await subscriptions.markCancelledByUserId({ userId: lapsed });
	return { listUserIdsByStatus: jest.fn(subscriptions.listUserIdsByStatus), trialist, payer, leaving };
}

describe("initDigestScanHandler", () => {
	it("prepares the starter snapshot and logs the starter report once per tick before dispatching digests", async () => {
		const calls: string[] = [];
		const { handler } = createHandler({
			prepareStarterSnapshot: async () => {
				calls.push("prepare");
			},
			logStarterReport: async () => {
				calls.push("report");
			},
			listUserIdsByStatus: jest.fn().mockResolvedValue([UserIdSchema.parse("reader")]),
			dispatchSendUserDigest: async ({ userId }) => {
				calls.push(`dispatch:${userId}`);
			},
		});

		await handler(buildSqsEvent([{ messageId: "tick", body: TRIGGER }]), buildLambdaContext(), () => {});

		expect(calls).toEqual(["prepare", "report", "dispatch:reader"]);
	});
	it("continues existing digests when the starter report cannot be computed", async () => {
		const { handler, deps } = createHandler({
			logStarterReport: async () => {
				throw new Error("onboarding table throttled");
			},
			listUserIdsByStatus: jest.fn().mockResolvedValue([UserIdSchema.parse("reader")]),
		});
		expect(
			await handler(
				buildSqsEvent([{ messageId: "tick", body: TRIGGER }]),
				buildLambdaContext(),
				() => {},
			),
		).toEqual({ batchItemFailures: [] });
		expect(deps.dispatchSendUserDigest).toHaveBeenCalledWith({ userId: "reader" });
	});
	it("continues existing digests when HN preparation is temporarily unavailable", async () => {
		const { handler, deps } = createHandler({
			prepareStarterSnapshot: async () => {
				throw new Error("HN unavailable");
			},
			listUserIdsByStatus: jest.fn().mockResolvedValue([UserIdSchema.parse("reader")]),
		});
		expect(
			await handler(
				buildSqsEvent([{ messageId: "tick", body: TRIGGER }]),
				buildLambdaContext(),
				() => {},
			),
		).toEqual({ batchItemFailures: [] });
		expect(deps.dispatchSendUserDigest).toHaveBeenCalledWith({ userId: "reader" });
	});
	it("dispatches one SendUserDigestCommand per trialing, active and pending-cancellation user", async () => {
		const { listUserIdsByStatus, trialist, payer, leaving } = await seedOneUserPerStatus();
		const { handler, deps } = createHandler({ listUserIdsByStatus });

		const result = await handler(
			buildSqsEvent([{ messageId: "tick-1", body: TRIGGER }]),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(deps.dispatchSendUserDigest).toHaveBeenCalledTimes(3);
		expect(deps.dispatchSendUserDigest).toHaveBeenCalledWith({ userId: trialist });
		expect(deps.dispatchSendUserDigest).toHaveBeenCalledWith({ userId: payer });
		expect(deps.dispatchSendUserDigest).toHaveBeenCalledWith({ userId: leaving });
	});

	it("queries only the trialing, active and pending-cancellation statuses, never cancelled", async () => {
		const { listUserIdsByStatus } = await seedOneUserPerStatus();
		const { handler } = createHandler({ listUserIdsByStatus });

		await handler(buildSqsEvent([{ messageId: "tick-1", body: TRIGGER }]), buildLambdaContext(), () => {});

		const queriedStatuses: SubscriptionStatus[] = listUserIdsByStatus.mock.calls.map(([status]) => status);
		expect(queriedStatuses).toEqual(["trialing", "active", "pending_cancellation"]);
	});

	it("dispatches a user once when the index lists them under more than one status", async () => {
		const changingStatus = UserIdSchema.parse("user-changing-status");
		const { handler, deps } = createHandler({
			listUserIdsByStatus: jest.fn().mockResolvedValue([changingStatus]),
		});

		await handler(buildSqsEvent([{ messageId: "tick-1", body: TRIGGER }]), buildLambdaContext(), () => {});

		expect(deps.dispatchSendUserDigest).toHaveBeenCalledTimes(1);
		expect(deps.dispatchSendUserDigest).toHaveBeenCalledWith({ userId: changingStatus });
	});

	it("dispatches nothing when no row has an eligible status", async () => {
		const { handler, deps } = createHandler();

		const result = await handler(
			buildSqsEvent([{ messageId: "tick-1", body: TRIGGER }]),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(deps.dispatchSendUserDigest).not.toHaveBeenCalled();
	});

	it("acks the tick when a single dispatch fails, so the next tick retries instead of re-fanning-out to everyone", async () => {
		const dispatchSendUserDigest = jest
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("sqs throttled"));
		const { handler, deps } = createHandler({
			listUserIdsByStatus: jest
				.fn()
				.mockResolvedValueOnce([UserIdSchema.parse("user-1")])
				.mockResolvedValueOnce([UserIdSchema.parse("user-2")])
				.mockResolvedValueOnce([]),
			dispatchSendUserDigest,
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "tick-1", body: TRIGGER }]),
			buildLambdaContext(),
			() => {},
		);

		// The rejected dispatch does not redrive the whole scan.
		expect(result).toEqual({ batchItemFailures: [] });
		expect(deps.dispatchSendUserDigest).toHaveBeenCalledTimes(2);
	});

	it("reports a batch item failure and dispatches nothing when a status query throws, so SQS redrives the tick", async () => {
		const { handler, deps } = createHandler({
			listUserIdsByStatus: jest
				.fn()
				.mockResolvedValueOnce([UserIdSchema.parse("user-1")])
				.mockResolvedValueOnce([UserIdSchema.parse("user-2")])
				.mockRejectedValueOnce(new Error("query down")),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "tick-1", body: TRIGGER }]),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "tick-1" }] });
		expect(deps.dispatchSendUserDigest).not.toHaveBeenCalled();
	});
});
