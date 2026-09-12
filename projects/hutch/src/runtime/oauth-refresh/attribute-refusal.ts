import type { CredentialFingerprint, CredentialHistory } from "./evidence";
import type { RefreshRefusal } from "./outcomes";

export function initAttributeRefreshRefusal(deps: {
	findHistory: (fingerprint: CredentialFingerprint) => Promise<CredentialHistory | undefined>;
	record: (refusal: RefreshRefusal) => Promise<void>;
}) {
	return async (refusal: RefreshRefusal) => {
		const credential = refusal.grantId === undefined ? await deps.findHistory(refusal.fingerprint) : undefined;
		await deps.record(credential ? { ...refusal, grantId: credential.grantId } : refusal);
	};
}
