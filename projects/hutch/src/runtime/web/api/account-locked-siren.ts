import { VERIFICATION_CONTACT_EMAIL } from "../shared/verify-banner/verify-banner.component";
import { type SirenEntity, sirenError } from "./siren";

/** Siren error `code` an API client (the browser extension, iOS) matches to
 * recognise a locked-account refusal and switch from a generic "save failed"
 * into "you must unlock first". Stable contract — see the extension-api-design
 * skill; renaming it is a breaking change for those clients. */
export const ACCOUNT_LOCKED_CODE = "account-locked";

/**
 * Refusal returned to API clients when a locked account attempts a write. It
 * carries only the `code` (for the client to recognise the refusal) and a
 * human-readable `message` that itself names the address to email — restoring
 * access is something the user reads and acts on, not a transition the client
 * can invoke, so the refusal models no action. Public reads stay open, so only
 * a save (or other write) ever produces this.
 */
export function accountLockedSirenError(): SirenEntity {
	return sirenError({
		code: ACCOUNT_LOCKED_CODE,
		message:
			"Your account is locked because your email was never verified. " +
			`Email ${VERIFICATION_CONTACT_EMAIL} to restore access.`,
	});
}
