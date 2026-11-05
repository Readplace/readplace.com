import type { HutchLogger } from "@packages/hutch-logger";
import type { ClaimMeteredLeg, MeteredLeg } from "@packages/provider-contracts/metered-leg-ledger";

export type MeteredLegAction = "claimed" | "settled" | "released" | "deferred" | "skipped-settled" | "skipped-in-flight";

type RefusedClaimKind = Exclude<Awaited<ReturnType<ClaimMeteredLeg>>["kind"], "granted">;

export const REFUSED_CLAIM_ACTION: Record<RefusedClaimKind, MeteredLegAction> = {
	deferred: "deferred",
	settled: "skipped-settled",
	"in-flight": "skipped-in-flight",
};

export function logMeteredLeg(logger: HutchLogger, line: { url: string; leg: MeteredLeg; action: MeteredLegAction }): void {
	logger.info("[metered-leg]", line);
}
