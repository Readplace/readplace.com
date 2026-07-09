export function buildAccountUrl(params?: {
	cancelling?: boolean;
	deleteConfirmationError?: boolean;
	iosSurface?: boolean;
}): string {
	const search = new URLSearchParams();
	if (params?.cancelling) search.set("cancelling", "1");
	if (params?.deleteConfirmationError) search.set("error", "delete_confirmation");
	// Preserved across a POST-Redirect-GET so the re-rendered account page keeps
	// the iOS in-app surface — the WKWebView form post carries no client header,
	// only whatever query the redirect target names.
	if (params?.iosSurface) search.set("platform", "ios");
	const qs = search.toString();
	return qs ? `/account?${qs}` : "/account";
}

export const ACCOUNT_CANCEL_URL = "/account/cancel";
export const ACCOUNT_DELETE_URL = "/account/delete";
export const ACCOUNT_REACTIVATE_URL = "/account/reactivate";
export const ACCOUNT_SUBSCRIBE_URL = "/account/subscribe";
export const ACCOUNT_ERROR_PAYMENT_METHOD_URL = "/account?error=payment_method";

export const ACCOUNT_CARDS_NEW_URL = "/account/cards/new";
export const ACCOUNT_ERROR_CARD_LIMIT_URL = "/account?error=card_limit";
export const ACCOUNT_ERROR_CANNOT_REMOVE_PRIMARY_URL = "/account?error=cannot_remove_primary";
export const ACCOUNT_ERROR_ADD_CARD_FAILED_URL = "/account?error=add_card_failed";

export function buildCardPrimaryUrl(cardId: string): string {
	return `/account/cards/${encodeURIComponent(cardId)}/primary`;
}

export function buildCardRemoveUrl(cardId: string): string {
	return `/account/cards/${encodeURIComponent(cardId)}/remove`;
}
