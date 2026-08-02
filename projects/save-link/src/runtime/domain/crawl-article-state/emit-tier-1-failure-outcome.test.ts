import { noopLogger } from "@packages/hutch-logger";
import { initEmitTier1FailureOutcome } from "./emit-tier-1-failure-outcome";
import type { ReadTierSnapshot } from "./read-tier-snapshot";

describe("emitTier1FailureOutcome", () => {
	it("carries the snapshot's cross-tier fields onto the tier-1 failure record", async () => {
		const logCrawlOutcome = jest.fn();
		const readTierSnapshot: ReadTierSnapshot = async () => ({
			tier0Status: "success",
			tier1Status: "not_attempted",
			pickedTier: "tier-0",
		});

		const { emitTier1FailureOutcome } = initEmitTier1FailureOutcome({
			readTierSnapshot,
			logCrawlOutcome,
			logger: noopLogger,
			logPrefix: "[emit-tier-1-failure-outcome.test]",
		});

		await emitTier1FailureOutcome({ url: "https://example.com/article" });

		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/article",
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: "success",
			pickedTier: "tier-0",
		});
	});

	it("still emits a degraded outcome record when the snapshot read throws, warning about the missing cross-tier fields — the storage failure that broke the read is exactly when the dashboard needs the record", async () => {
		const logCrawlOutcome = jest.fn();
		const warn = jest.fn();
		const readTierSnapshot: ReadTierSnapshot = async () => {
			throw new Error("KeyTooLongError: Your key is too long");
		};

		const { emitTier1FailureOutcome } = initEmitTier1FailureOutcome({
			readTierSnapshot,
			logCrawlOutcome,
			logger: { ...noopLogger, warn },
			logPrefix: "[emit-tier-1-failure-outcome.test]",
		});

		await expect(emitTier1FailureOutcome({ url: "https://example.com/presigned.pdf" })).resolves.toBeUndefined();

		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/presigned.pdf",
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: "not_attempted",
			pickedTier: "none",
		});
		expect(warn).toHaveBeenCalledWith(
			"[emit-tier-1-failure-outcome.test] tier snapshot read failed — emitting tier-1 failure outcome without cross-tier fields",
			{
				url: "https://example.com/presigned.pdf",
				error: "Error: KeyTooLongError: Your key is too long",
			},
		);
	});
});
