import { VERIFICATION_CONTACT_EMAIL } from "@packages/web-shell";
import { type SirenEntity, sirenMessages } from "./siren";

/**
 * The refusal a locked account receives. The
 * server authors a single warning message; the client renders it generically
 * (the refusal carries no feature-specific code and no action). The HTML body
 * names the address to email — restoring access is something the user reads and
 * acts on, not a transition the client invokes.
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
