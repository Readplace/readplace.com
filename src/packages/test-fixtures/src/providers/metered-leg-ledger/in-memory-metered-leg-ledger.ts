import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	type ClaimMeteredLeg,
	type MeteredLeg,
	PaidLegPermitSchema,
	type ReleaseMeteredLeg,
	type SettleMeteredLeg,
} from "@packages/provider-contracts/metered-leg-ledger";

type LegKey = `${string}#${MeteredLeg}`;

function legKey(p: { url: string; leg: MeteredLeg }): LegKey {
	return `${ArticleResourceUniqueId.parse(p.url).value}#${p.leg}`;
}

export function initInMemoryMeteredLegLedger(deps: {
	isMeteredLegsDeferred: (url: string) => boolean;
	now: () => Date;
}): {
	claimMeteredLeg: ClaimMeteredLeg;
	settleMeteredLeg: SettleMeteredLeg;
	releaseMeteredLeg: ReleaseMeteredLeg;
} {
	const claims = new Map<LegKey, { claimId: string; expiresAt: string }>();
	const ledger = new Map<LegKey, { inputHash: string; outcome: string; settledAt: string }>();

	const claimMeteredLeg: ClaimMeteredLeg = async ({ url, leg, inputHash, claimId, expiresAt }) => {
		if (deps.isMeteredLegsDeferred(url)) return { kind: "deferred" };
		const key = legKey({ url, leg });
		const entry = ledger.get(key);
		if (entry?.inputHash === inputHash) return { kind: "settled", outcome: entry.outcome };
		const claim = claims.get(key);
		if (claim && claim.expiresAt >= deps.now().toISOString() && claim.claimId !== claimId) {
			return { kind: "in-flight" };
		}
		claims.set(key, { claimId, expiresAt });
		return { kind: "granted", permit: PaidLegPermitSchema.parse({ leg, claimId, inputHash }) };
	};

	const settleMeteredLeg: SettleMeteredLeg = async ({ url, permit, outcome, settledAt }) => {
		const key = legKey({ url, leg: permit.leg });
		if (claims.get(key)?.claimId !== permit.claimId) {
			throw new Error(`settle refused: ${permit.leg} claim on ${url} is not held by ${permit.claimId}`);
		}
		ledger.set(key, { inputHash: permit.inputHash, outcome, settledAt });
		claims.delete(key);
	};

	const releaseMeteredLeg: ReleaseMeteredLeg = async ({ url, permit }) => {
		const key = legKey({ url, leg: permit.leg });
		if (claims.get(key)?.claimId === permit.claimId) claims.delete(key);
	};

	return { claimMeteredLeg, settleMeteredLeg, releaseMeteredLeg };
}
