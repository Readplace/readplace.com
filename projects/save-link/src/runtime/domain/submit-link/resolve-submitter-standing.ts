import type { UserId } from "@packages/domain/user";
import type { IsAccountLive } from "@packages/provider-contracts/auth";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { resolveWriteAccess } from "@packages/subscription-access";

export type SubmitterStanding = "may-save" | "account-gone" | "read-only";

export type ResolveSubmitterStanding = (userId: UserId) => Promise<SubmitterStanding>;

export function initResolveSubmitterStanding(deps: {
	isAccountLive: IsAccountLive;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	now: () => Date;
}): ResolveSubmitterStanding {
	return async (userId) => {
		if (!(await deps.isAccountLive(userId))) return "account-gone";
		const access = resolveWriteAccess(await deps.findSubscriptionByUserId(userId), deps.now());
		return access === "full" ? "may-save" : "read-only";
	};
}
