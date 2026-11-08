import assert from "node:assert";
import type { Request } from "express";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { isAccountLocked } from "./require-not-locked.middleware";
import { hasFullWriteAccess } from "./require-write-access.middleware";

export type CanSaveContent = (req: Pick<Request, "userId" | "verificationStatus">) => Promise<boolean>;

export function initCanSaveContent(deps: {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	now: () => Date;
}): CanSaveContent {
	return async (req) => {
		if (isAccountLocked(req)) return false;
		assert(req.userId, "canSaveContent must run after an authentication middleware");
		const subscription = await deps.findSubscriptionByUserId(req.userId);
		return hasFullWriteAccess({ subscription, now: deps.now() });
	};
}
