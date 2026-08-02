import type { HutchLogger } from "@packages/hutch-logger";
import type { LogCrawlOutcome } from "@packages/hutch-infra-components";
import type { ReadTierSnapshot, TierSnapshot } from "./read-tier-snapshot";

export type EmitTier1FailureOutcome = (params: { url: string }) => Promise<void>;

export function initEmitTier1FailureOutcome(deps: {
	readTierSnapshot: ReadTierSnapshot;
	logCrawlOutcome: LogCrawlOutcome;
	logger: HutchLogger;
	logPrefix: string;
}): { emitTier1FailureOutcome: EmitTier1FailureOutcome } {
	const emitTier1FailureOutcome: EmitTier1FailureOutcome = async ({ url }) => {
		const snapshot = await deps.readTierSnapshot({ url }).catch((error: unknown): TierSnapshot => {
			deps.logger.warn(
				`${deps.logPrefix} tier snapshot read failed — emitting tier-1 failure outcome without cross-tier fields`,
				{ url, error: String(error) },
			);
			return { tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" };
		});
		deps.logCrawlOutcome({
			url,
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: snapshot.tier0Status,
			pickedTier: snapshot.pickedTier,
		});
	};
	return { emitTier1FailureOutcome };
}
