import type { RateLimitRule } from "@packages/domain/rate-limit";
import { BOOK } from "@packages/media-contracts";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import { type GetEffectiveAccess, isDailyLimited } from "@packages/subscription-access";
import type { SettleReceivedUpload } from "./commit-received-upload";

export function initMeterBookUploads(deps: {
	getEffectiveAccess: GetEffectiveAccess;
	consumeRateLimit: ConsumeRateLimit;
	rule: RateLimitRule;
	now: () => Date;
	settle: SettleReceivedUpload;
}): SettleReceivedUpload {
	return async (params) => {
		if (params.kind.name !== BOOK.name) return deps.settle(params);
		const userId = params.session.userId;
		if (!isDailyLimited(await deps.getEffectiveAccess(userId))) return deps.settle(params);
		const decision = await deps.consumeRateLimit({ bucket: "book-upload", key: userId, rule: deps.rule });
		if (!decision.allowed) {
			return {
				outcome: "book-quota",
				retryAt: new Date(deps.now().getTime() + decision.retryAfterSeconds * 1000),
			};
		}
		return deps.settle(params);
	};
}
