import type { HutchLogger } from "@packages/hutch-logger";
import type {
	ClaimMeteredLeg,
	MeteredLeg,
	PaidLegPermit,
	ReleaseMeteredLeg,
	SettleMeteredLeg,
} from "@packages/provider-contracts/metered-leg-ledger";
import { legInputHash } from "./leg-input-hash";

type MeteredLegRunResult = { kind: "succeeded"; outcome: string } | { kind: "unsucceeded" };

type RunMeteredLegOutcome =
	| { kind: "ran"; outcome: string }
	| { kind: "ran-unsucceeded" }
	| { kind: "deferred" }
	| { kind: "settled"; outcome: string }
	| { kind: "in-flight" };

export type RunMeteredLeg = (p: {
	url: string;
	leg: MeteredLeg;
	inputs: readonly string[];
	claimId: string;
	claimTtlMs: number;
	run: (permit: PaidLegPermit) => Promise<MeteredLegRunResult>;
}) => Promise<RunMeteredLegOutcome>;

type MeteredLegAction = "claimed" | "settled" | "released" | "deferred" | "skipped-settled" | "skipped-in-flight";

export function initRunMeteredLeg(deps: {
	claimMeteredLeg: ClaimMeteredLeg;
	settleMeteredLeg: SettleMeteredLeg;
	releaseMeteredLeg: ReleaseMeteredLeg;
	logger: HutchLogger;
	now: () => Date;
}): RunMeteredLeg {
	return async ({ url, leg, inputs, claimId, claimTtlMs, run }) => {
		const log = (action: MeteredLegAction) => deps.logger.info("[metered-leg]", { url, leg, action });
		const claim = await deps.claimMeteredLeg({
			url,
			leg,
			inputHash: legInputHash({ url, leg, inputs }),
			claimId,
			expiresAt: new Date(deps.now().getTime() + claimTtlMs).toISOString(),
		});
		if (claim.kind === "deferred") {
			log("deferred");
			return { kind: "deferred" };
		}
		if (claim.kind === "settled") {
			log("skipped-settled");
			return { kind: "settled", outcome: claim.outcome };
		}
		if (claim.kind === "in-flight") {
			log("skipped-in-flight");
			return { kind: "in-flight" };
		}
		log("claimed");
		const { permit } = claim;
		let succeeded = false;
		try {
			const result = await run(permit);
			if (result.kind === "unsucceeded") return { kind: "ran-unsucceeded" };
			await deps.settleMeteredLeg({
				url,
				permit,
				outcome: result.outcome,
				settledAt: deps.now().toISOString(),
			});
			succeeded = true;
			log("settled");
			return { kind: "ran", outcome: result.outcome };
		} finally {
			if (!succeeded) {
				await deps.releaseMeteredLeg({ url, permit });
				log("released");
			}
		}
	};
}
