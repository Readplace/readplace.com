import { isCurrentGrant, type RefreshExemption } from "./current-grant";
import type { OAuthGrantId } from "./oauth.schema";
import type { RefreshGrant, RefreshStore } from "./refresh";

export type AdvanceEpochKeeping = (input: {
	userId: string;
	exemption: RefreshExemption;
	expectedGrant: RefreshGrant;
}) => Promise<"committed" | "conflict">;

export function initKeepCurrentGrant(deps: {
	store: Pick<RefreshStore, "readAccount" | "readGrant">;
	advanceEpochKeeping: AdvanceEpochKeeping;
}): (input: { userId: string; grantId: OAuthGrantId }) => Promise<boolean> {
	return async input => {
		for (let attempt = 0; attempt < 4; attempt++) {
			const account = await deps.store.readAccount(input.userId);
			const grant = await deps.store.readGrant(input.grantId);
			if (!grant || grant.userId !== input.userId || grant.state !== "active" || !grant.keyThumbprint) return false;
			if (!isCurrentGrant({ account, credential: { grantId: grant.id, epoch: grant.epoch } })) return false;
			const result = await deps.advanceEpochKeeping({
				userId: input.userId,
				exemption: { atEpoch: account.epoch + 1, grantId: input.grantId, grantEpoch: grant.epoch },
				expectedGrant: grant,
			});
			if (result === "committed") return true;
		}
		return false;
	};
}
