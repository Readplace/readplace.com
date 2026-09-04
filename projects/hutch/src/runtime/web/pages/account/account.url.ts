import {
	APP_SHELL_QUERY,
	APP_SHELL_VALUE,
	PLATFORM_QUERY,
} from "../../onboarding/native-client";
import type { NativeClientPlatform } from "../../onboarding/native-client";

export function buildAccountUrl(params?: {
	cancelling?: boolean;
	deleteConfirmationError?: boolean;
	surfacePlatform?: NativeClientPlatform;
	appShell?: boolean;
}): string {
	const search = new URLSearchParams();
	if (params?.cancelling) search.set("cancelling", "1");
	if (params?.deleteConfirmationError) search.set("error", "delete_confirmation");
	// Both markers are preserved across a POST-Redirect-GET so the re-rendered
	// account page keeps the app's in-app surface and its chromeless shell — the
	// web view's form post carries no client header, only whatever query the
	// redirect target names.
	if (params?.surfacePlatform) search.set(PLATFORM_QUERY, params.surfacePlatform);
	if (params?.appShell) search.set(APP_SHELL_QUERY, APP_SHELL_VALUE);
	const qs = search.toString();
	return qs ? `/account?${qs}` : "/account";
}

export const ACCOUNT_APPEARANCE_URL = "/account/appearance";
export const ACCOUNT_CANCEL_URL = "/account/cancel";
export const ACCOUNT_DELETE_URL = "/account/delete";
export const ACCOUNT_REACTIVATE_URL = "/account/reactivate";
export const ACCOUNT_STATUS_URL = "/account/status";
export const ACCOUNT_EXPORT_URL = "/export";
export const ACCOUNT_SUBSCRIBE_URL = "/account/subscribe";
export const ACCOUNT_ERROR_PAYMENT_METHOD_URL = "/account?error=payment_method";

export const ACCOUNT_ERROR_SUBSCRIBE_FAILED_URL = "/account?error=subscribe_failed";

export function buildAccountStatusPollUrl(pollCount: number): string {
	return `${ACCOUNT_STATUS_URL}?cancelling=1&poll=${pollCount}`;
}

export const ACCOUNT_CARDS_NEW_URL = "/account/cards/new";
export const ACCOUNT_ERROR_CARD_LIMIT_URL = "/account?error=card_limit";
export const ACCOUNT_ERROR_CANNOT_REMOVE_PRIMARY_URL = "/account?error=cannot_remove_primary";
export const ACCOUNT_ERROR_ADD_CARD_FAILED_URL = "/account?error=add_card_failed";
export const ACCOUNT_ERROR_CARD_SETUP_FAILED_URL = "/account?error=card_setup_failed";
export const ACCOUNT_ERROR_CARD_SETUP_UNVERIFIED_URL = "/account?error=card_setup_unverified";

export function buildCardPrimaryUrl(cardId: string): string {
	return `/account/cards/${encodeURIComponent(cardId)}/primary`;
}

export function buildCardRemoveUrl(cardId: string): string {
	return `/account/cards/${encodeURIComponent(cardId)}/remove`;
}
