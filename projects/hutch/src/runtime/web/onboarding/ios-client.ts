import type { Request } from "express";

/** Header the iOS app sets on every authenticated Siren request. Safari on the
 * same phone can't read the app's cookies, so the server tells an app request
 * apart from Safari by this header and tracks onboarding completion per-user
 * server-side instead of via cookies. */
export const IOS_CLIENT_HEADER = "x-readplace-client";
export const IOS_CLIENT_VALUE = "ios";

/** True when the request came from the iOS app. An absent header reads as
 * non-iOS, so older shipped app builds and the browser extension — which never
 * send it — are tolerated as non-iOS. */
export function isIosClient(req: Request): boolean {
	return req.get(IOS_CLIENT_HEADER) === IOS_CLIENT_VALUE;
}
