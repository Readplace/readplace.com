export function buildAccountUrl(params?: { cancelling?: boolean }): string {
	if (params?.cancelling) {
		return "/account?cancelling=1";
	}
	return "/account";
}

export const ACCOUNT_CANCEL_URL = "/account/cancel";
export const ACCOUNT_REACTIVATE_URL = "/account/reactivate";
export const ACCOUNT_SUBSCRIBE_URL = "/account/subscribe";
export const ACCOUNT_ERROR_PAYMENT_METHOD_URL = "/account?error=payment_method";
