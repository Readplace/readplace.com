import { VERIFICATION_CONTACT_EMAIL } from "../shared/verify-banner/verify-banner.component";
import { type SirenEntity, sirenError } from "./siren";

/** Siren error `code` an API client (the browser extension, iOS) matches to
 * recognise a locked-account refusal and switch from a generic "save failed"
 * into "you must unlock first". Stable contract — see the extension-api-design
 * skill; renaming it is a breaking change for those clients. */
export const ACCOUNT_LOCKED_CODE = "account-locked";

/** Capability name of the unlock action carried on the locked-account error.
 * Clients key off it to find the destination the user must follow. */
export const UNLOCK_ACTION_NAME = "unlock-account";

/**
 * Refusal returned to API clients when a locked account attempts a write. The
 * message is the user-facing copy; the single action is the destination the
 * client renders as a button — following it opens the concierge inbox that
 * restores access (the same address the web locked screen advertises). Public
 * reads stay open, so only a save (or other write) ever produces this.
 */
export function accountLockedSirenError(): SirenEntity {
	return sirenError({
		code: ACCOUNT_LOCKED_CODE,
		message:
			"Your account is locked because your email was never verified. " +
			`Email ${VERIFICATION_CONTACT_EMAIL} to restore access.`,
		actions: [
			{
				name: UNLOCK_ACTION_NAME,
				title: "Email support to unlock",
				href: `mailto:${VERIFICATION_CONTACT_EMAIL}`,
				method: "GET",
			},
		],
	});
}
