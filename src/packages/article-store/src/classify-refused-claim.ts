import type { MeteredLeg } from "@packages/provider-contracts/metered-leg-ledger";
import { z } from "zod";

const LedgerEntryAttribute = z.object({
	M: z.object({
		inputHash: z.object({ S: z.string() }),
		outcome: z.object({ S: z.string() }),
	}),
});

type RefusedClaim =
	| { kind: "deferred" }
	| { kind: "settled"; outcome: string }
	| { kind: "in-flight" };

export function classifyRefusedClaim(
	oldItem: Record<string, unknown> | undefined,
	claim: { leg: MeteredLeg; hash: string },
): RefusedClaim {
	if (oldItem?.meteredLegsDeferredSince !== undefined) return { kind: "deferred" };
	const entry = LedgerEntryAttribute.safeParse(oldItem?.[`ledger_${claim.leg}`]);
	if (entry.success && entry.data.M.inputHash.S === claim.hash) {
		return { kind: "settled", outcome: entry.data.M.outcome.S };
	}
	return { kind: "in-flight" };
}
