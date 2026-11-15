import type { RateLimitRule } from "@packages/domain/rate-limit";
import type { UserId } from "@packages/domain/user";
import type { FindSavedUrls } from "@packages/provider-contracts/article-store";
import type { ClaimRateLimitUnits } from "@packages/provider-contracts/rate-limit";
import type { EffectiveAccess, GetEffectiveAccess } from "@packages/subscription-access";

type DailySaveClaim<U extends string> = {
	granted: U[];
	refused: U[];
	retryAfterSeconds: number | undefined;
};

export type ClaimDailySaves = <U extends string>(input: {
	userId: UserId;
	urls: readonly U[];
}) => Promise<DailySaveClaim<U>>;

export function initClaimDailySaves(deps: {
	getEffectiveAccess: GetEffectiveAccess;
	isDailyLimited: (access: EffectiveAccess) => boolean;
	findSavedUrls: FindSavedUrls;
	claimRateLimitUnits: ClaimRateLimitUnits;
	rule: RateLimitRule;
}): ClaimDailySaves {
	return async ({ userId, urls }) => {
		const access = await deps.getEffectiveAccess(userId);
		if (!deps.isDailyLimited(access)) {
			return { granted: [...urls], refused: [], retryAfterSeconds: undefined };
		}
		const saved = new Set(await deps.findSavedUrls({ userId, urls }));
		const newUrls = [...new Set(urls.filter((url) => !saved.has(url)))];
		if (newUrls.length === 0) {
			return { granted: [...urls], refused: [], retryAfterSeconds: undefined };
		}
		const claim = await deps.claimRateLimitUnits({
			bucket: "daily-saves",
			key: userId,
			requested: newUrls.length,
			rule: deps.rule,
		});
		const allowed = new Set([...saved, ...newUrls.slice(0, claim.granted)]);
		return {
			granted: urls.filter((url) => allowed.has(url)),
			refused: urls.filter((url) => !allowed.has(url)),
			retryAfterSeconds: claim.retryAfterSeconds,
		};
	};
}
