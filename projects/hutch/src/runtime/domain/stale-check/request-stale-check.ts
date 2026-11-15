import type { RateLimitRule } from "@packages/domain/rate-limit";
import type { Logger } from "@packages/logger";
import type { PublishStaleCheckRequested, RequestStaleCheck, StaleCheckRequester } from "@packages/provider-contracts/events";
import type { ConsumeRateLimit, RateLimitBucket } from "@packages/provider-contracts/rate-limit";
import { type GetEffectiveAccess, isDailyLimited } from "@packages/subscription-access";

export function initRequestStaleCheck(deps: {
	consumeRateLimit: ConsumeRateLimit;
	rule: RateLimitRule;
	publishStaleCheckRequested: PublishStaleCheckRequested;
	getEffectiveAccess: GetEffectiveAccess;
	logger: Logger;
}): { requestStaleCheck: RequestStaleCheck } {
	const counterOf = async (requester: StaleCheckRequester): Promise<{ bucket: RateLimitBucket; key: string } | undefined> => {
		if ("ip" in requester) return { bucket: "stale-check-ip", key: requester.ip };
		if (!isDailyLimited(await deps.getEffectiveAccess(requester.account))) return undefined;
		return { bucket: "stale-check-account", key: requester.account };
	};

	const requestStaleCheck: RequestStaleCheck = async ({ url, requester }) => {
		const counter = await counterOf(requester);
		if (counter) {
			const decision = await deps.consumeRateLimit({ ...counter, rule: deps.rule });
			if (!decision.allowed) {
				deps.logger.info("[stale-check] allowance spent", { bucket: counter.bucket, retryAfterSeconds: decision.retryAfterSeconds });
				return;
			}
		}
		await deps.publishStaleCheckRequested({ url });
	};

	return { requestStaleCheck };
}
