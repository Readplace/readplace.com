import { render } from "../../render";
import type { BannerState } from "../../banner-state";
import { VERIFY_BANNER_TEMPLATE } from "./verify-banner.template";

/** Concierge inbox that restores access once an account has locked. */
export const VERIFICATION_CONTACT_EMAIL = "readplace+verification@readplace.com";

/**
 * The banner is always emitted; visibility and copy are governed by a state
 * class and `data-verification-state`, so a test looks the element up and then
 * asserts on its metadata rather than on its absence. The state machine
 * (which of verified / pending / counting-down / locked applies) is decided
 * here in TypeScript and the template renders one shape per branch — mirroring
 * the extension-suggestion banner.
 */
export function renderVerifyBanner(state: BannerState): string {
	const visible = state.isAuthenticated && state.emailVerified === false;
	const status = visible ? state.verification : undefined;
	const stateName = !visible ? "verified" : (status?.state ?? "pending");
	const daysLeft = status?.state === "counting-down" ? status.daysLeft : undefined;

	return render(VERIFY_BANNER_TEMPLATE, {
		visible,
		isLocked: stateName === "locked",
		isCountingDown: stateName === "counting-down",
		stateName,
		daysLeft,
		dayWord: daysLeft === 1 ? "day" : "days",
		contactEmail: VERIFICATION_CONTACT_EMAIL,
	});
}
