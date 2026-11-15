import type { UserId } from "@packages/domain/user";
import type { ReadOcrPagesLeft } from "@packages/provider-contracts/rate-limit";
import type { EffectiveAccess, GetEffectiveAccess } from "@packages/subscription-access";

export type HasNoOcrPagesLeft = (params: { userId: UserId }) => Promise<boolean>;

export function initHasNoOcrPagesLeft(deps: {
	getEffectiveAccess: GetEffectiveAccess;
	isDailyLimited: (access: EffectiveAccess) => boolean;
	readOcrPagesLeft: ReadOcrPagesLeft;
}): HasNoOcrPagesLeft {
	return async ({ userId }) => {
		if (!deps.isDailyLimited(await deps.getEffectiveAccess(userId))) return false;
		return (await deps.readOcrPagesLeft({ userId })) === 0;
	};
}
