import { VERIFICATION_CONTACT_EMAIL } from "../shared/verify-banner/verify-banner.component";
import { type SirenEntity, sirenMessages } from "./siren";

/**
 * The refusal a locked account receives when it tries to save a new link. The
 * server authors a single warning message; the client renders it generically
 * (the refusal carries no feature-specific code and no action). The HTML body
 * names the address to email — restoring access is something the user reads and
 * acts on, not a transition the client invokes. Reads, listing, and deletes
 * stay open while locked, so only a save ever produces this.
 */
export function accountLockedSirenError(): SirenEntity {
	return sirenMessages([
		{
			type: "warning",
			content: {
				type: "text/html",
				body:
					"Your account is locked because your email was never verified. " +
					`Email <a href="mailto:${VERIFICATION_CONTACT_EMAIL}">${VERIFICATION_CONTACT_EMAIL}</a> to restore access.`,
			},
		},
	]);
}
