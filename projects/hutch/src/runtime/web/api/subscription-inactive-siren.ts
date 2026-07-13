import { type SirenEntity, sirenMessages } from "./siren";

/**
 * The refusal an inactive (read-only) subscription receives when it tries to save
 * a new link. Mirrors accountLockedSirenError: one server-authored warning the
 * client renders generically, with no code and no action. The copy is a single
 * short sentence — the iOS Share Extension's status label is tiny — and
 * commerce-neutral (no price, no reactivate link), because that surface omits
 * commerce per App Store review Guideline 3.1.1. Reads, listing, and exports stay
 * open while read-only, so only a save ever produces this.
 */
export function subscriptionInactiveSirenError(): SirenEntity {
	return sirenMessages([
		{
			type: "warning",
			content: {
				type: "text/html",
				body: "Couldn't save — your subscription isn't active.",
			},
		},
	]);
}
