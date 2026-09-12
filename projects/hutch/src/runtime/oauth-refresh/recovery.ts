import type { HutchLogger } from "@packages/hutch-logger";
import { initRefreshProof, type CredentialHistory, type CredentialFingerprint, type RefreshAttempt } from "./evidence";

export function initVerifyRefreshRecovery(deps: {
	secret: string;
	findHistory: (fingerprint: CredentialFingerprint) => Promise<CredentialHistory | undefined>;
	recover: (attempt: RefreshAttempt, recoveredAt: number) => Promise<void>;
	now: () => number;
	logger: HutchLogger;
}) {
	const proof = initRefreshProof(deps.secret);
	return async (input: { proof: string; authenticatedRefreshToken: string }) => {
		const attempt = proof.verify(input.proof);
		if (!attempt || attempt.occurredAt > deps.now() || attempt.occurredAt < deps.now() - 31 * 86_400_000) return;
		let remaining = 3;
		while (remaining > 0) {
			try {
				let descendant = await deps.findHistory(proof.fingerprint(input.authenticatedRefreshToken));
				const visited = new Set<string>();
				while (descendant?.parentFingerprint && !visited.has(descendant.fingerprint)) {
					visited.add(descendant.fingerprint);
					const parent = await deps.findHistory(descendant.parentFingerprint);
					if (!parent || parent.grantId !== descendant.grantId || parent.revocation?.cause !== "rotation") return;
					if (parent.fingerprint === attempt.fingerprint) {
						await deps.recover(attempt, deps.now());
						return;
					}
					descendant = parent;
				}
				return;
			} catch (error) {
				remaining--;
				if (remaining === 0) deps.logger.error(JSON.stringify({ level: "ERROR", event: "oauth_refresh_recovery_persistence_failed", refusalId: attempt.refusalId, error: error instanceof Error ? error.name : "unknown" }));
			}
		}
	};
}
