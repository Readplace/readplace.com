import type { UserId } from "@packages/domain/user";
import type { FindUserById } from "@packages/provider-contracts/auth";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { resolveWriteAccess } from "@packages/subscription-access";
import { VERIFICATION_CONTACT_EMAIL } from "@packages/web-shell";
import { computeVerificationStatus } from "../../domain/access/verification-deadline";

/**
 * Whether an authenticated agent may save a new link right now. A save over MCP
 * has to clear the same two gates the hypermedia `/queue` save and `/import`
 * enforce — `requireNotLocked` (email unverified past its 7-day window) and
 * `requireWriteAccess` (subscription not `full`) — so an agent save and a
 * browser-extension save are the identical write rather than a back door around
 * the lockout and the paywall.
 *
 * Those gates are Express middleware keyed off `req`, but an MCP request only
 * has a `userId` after the bearer is validated inside the transport, so the
 * status is resolved here from the bearer-derived id instead. The refusal
 * carries an agent-facing sentence (the transport renders it as a tool error)
 * in place of the web's locked screen or the API's bare `subscription_inactive`.
 * Listing stays open while locked, so this gates only `save_link`.
 */
type SaveAccess =
	| { readonly allowed: true }
	| { readonly allowed: false; readonly message: string };

export type ResolveSaveAccess = (userId: UserId) => Promise<SaveAccess>;

export function initResolveSaveAccess(deps: {
	findUserById: FindUserById;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	now: () => Date;
}): ResolveSaveAccess {
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

		const subscription = await deps.findSubscriptionByUserId(userId);
		if (resolveWriteAccess(subscription, deps.now()) !== "full") {
			return {
				allowed: false,
				message:
					"Saving is disabled because the Readplace subscription is not active. " +
					"Reactivate it from the account page to save links again.",
			};
		}

		return { allowed: true };
	};
}
