import type { UserId } from "@packages/domain/user";
import type { IsAccountLive } from "@packages/provider-contracts/auth";

export type SubmitterStanding = "may-save" | "account-gone";

export type ResolveSubmitterStanding = (userId: UserId) => Promise<SubmitterStanding>;

export function initResolveSubmitterStanding(deps: { isAccountLive: IsAccountLive }): ResolveSubmitterStanding {
	return async (userId) => ((await deps.isAccountLive(userId)) ? "may-save" : "account-gone");
}
