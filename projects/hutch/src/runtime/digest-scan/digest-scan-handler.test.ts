import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { noopLogger } from "@packages/hutch-logger";
import { UserIdSchema } from "@packages/domain/user";
import { initDigestScanHandler, type DigestScanDeps } from "./digest-scan-handler";

const TRIGGER = JSON.stringify({ trigger: "digest-flush" });

function createHandler(overrides: Partial<DigestScanDeps> = {}) {
	const deps: DigestScanDeps = {
		scanPendingDigestUsers: jest.fn().mockResolvedValue([]),
		dispatchSendUserDigest: jest.fn().mockResolvedValue(undefined),
		logger: noopLogger,
		...overrides,
	};
	return { handler: initDigestScanHandler(deps), deps };
}

describe("initDigestScanHandler", () => {
	it("dispatches one SendUserDigestCommand per distinct pending user", async () => {
		const { handler, deps } = createHandler({
			scanPendingDigestUsers: jest.fn().mockResolvedValue([
				UserIdSchema.parse("user-1"),
				UserIdSchema.parse("user-2"),
			]),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "tick-1", body: TRIGGER }]),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(deps.dispatchSendUserDigest).toHaveBeenCalledTimes(2);
		expect(deps.dispatchSendUserDigest).toHaveBeenCalledWith({ userId: "user-1" });
		expect(deps.dispatchSendUserDigest).toHaveBeenCalledWith({ userId: "user-2" });
	});

	it("dispatches nothing when no user has a pending article", async () => {
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
			scanPendingDigestUsers: jest.fn().mockResolvedValue([
				UserIdSchema.parse("user-1"),
				UserIdSchema.parse("user-2"),
			]),
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

	it("reports a batch item failure when the scan throws so SQS redrives the tick", async () => {
		const { handler } = createHandler({
			scanPendingDigestUsers: jest.fn().mockRejectedValue(new Error("scan down")),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "tick-1", body: TRIGGER }]),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "tick-1" }] });
	});
});
