import type { UserId } from "@packages/domain/user";
import type { FindUserById } from "@packages/provider-contracts/auth";
import { VERIFICATION_CONTACT_EMAIL } from "@packages/web-shell";
import { computeVerificationStatus } from "../../domain/access/verification-deadline";

/**
 * Whether an authenticated agent's account is unlocked enough to save a new
 * link. A save over MCP has to clear the same lockout the hypermedia `/queue`
 * save and `/import` enforce — `requireNotLocked` (email unverified past its
 * 7-day window) — so an agent save and a browser-extension save are the
 * identical write rather than a back door around the lockout. A locked account
 * can still co-occur with a full subscription, and listing stays open while
 * locked, so this gates only `save_link`.
 *
 * The subscription paywall (`requireWriteAccess`) is NOT re-decided here: the
 * tool-access gate refuses a new save for a read-only subscription before
 * `save_link` ever runs, so the single subscription decision lives there. This
 * resolver owns only the lockout.
 */
type SaveAccess =
	| { readonly allowed: true }
	| { readonly allowed: false; readonly message: string };

export function initResolveSaveAccess(deps: {
	findUserById: FindUserById;
	now: () => Date;
}): (userId: UserId) => Promise<SaveAccess> {
	return async (userId) => {
		const user = await deps.findUserById(userId);
		if (user && !user.emailVerified) {
			const status = computeVerificationStatus({
				registeredAt: user.registeredAt,
				now: deps.now(),
			});
			if (status.state === "locked") {
				return {
					allowed: false,
					message:
						"Your Readplace account is locked because its email was never verified. " +
						`Email ${VERIFICATION_CONTACT_EMAIL} to restore access.`,
				};
			}
		}

		return { allowed: true };
	};
}
